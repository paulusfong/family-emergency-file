import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-auth-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;
process.env.BETTER_AUTH_SECRET = "0123456789abcdef0123456789abcdef-e2e";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
(process.env as { NODE_ENV?: string }).NODE_ENV = "test";
delete process.env.RESEND_API_KEY;

/** Capture dev-mail console output and pull the confirm URL out of it. */
async function captureMagicLink(run: () => Promise<unknown>) {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await run();
  } finally {
    console.log = orig;
  }
  const match = logs.join("\n").match(/http:\/\/localhost:3000\/sign-in\/confirm\?token=[^\s]+/);
  assert.ok(match, "magic link was logged by the dev mail sink");
  return new URL(match[0]);
}

describe("better-auth magic link end to end (real adapter, local sqlite)", async () => {
  const { client, db } = await import("./db");
  const { applySchema } = await import("../test/apply-schema");
  const schema = await import("./schema");
  const { auth } = await import("./auth");

  before(async () => {
    await applySchema(client);
  });

  it("requests, verifies, and resolves a session without an account/password row", async () => {
    const link = await captureMagicLink(() =>
      auth.api.signInMagicLink({
        body: { email: "e2e@ex.com", callbackURL: "/app" },
        headers: new Headers(),
      }),
    );
    assert.equal(link.pathname, "/sign-in/confirm");
    const token = link.searchParams.get("token")!;
    assert.ok(token.length >= 16);

    const verified = await auth.api.magicLinkVerify({
      query: { token },
      headers: new Headers(),
      returnHeaders: true,
    });
    const cookie = verified.headers.get("set-cookie") ?? "";
    assert.match(cookie, /better-auth\.session_token=/);
    assert.equal(verified.response.user.email, "e2e@ex.com");

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie.split(";")[0] }),
    });
    assert.equal(session?.user.email, "e2e@ex.com");

    // Magic link never creates an account row...
    assert.equal((await db.select().from(schema.account)).length, 0);
    // ...but better-auth 1.7 validates the Drizzle schema at startup and fails
    // with SCHEMA_MISMATCH (missing-column account.password) if the column is
    // dropped, so it stays as an always-null column. No UI ever sets it.
    const cols = await client.execute("select name from pragma_table_info('account')");
    assert.equal(cols.rows.some((r) => r.name === "password"), true);
  });

  it("rejects a reused token", async () => {
    const link = await captureMagicLink(() =>
      auth.api.signInMagicLink({
        body: { email: "reuse@ex.com", callbackURL: "/app" },
        headers: new Headers(),
      }),
    );
    const token = link.searchParams.get("token")!;
    await auth.api.magicLinkVerify({ query: { token }, headers: new Headers() });
    await assert.rejects(() => auth.api.magicLinkVerify({ query: { token }, headers: new Headers() }));
  });

  it("returns no session without a cookie", async () => {
    assert.equal(await auth.api.getSession({ headers: new Headers() }), null);
  });
});

describe("auth-client", () => {
  it("creates the browser auth client with the magic-link plugin", async () => {
    const { authClient } = await import("./auth-client");
    assert.equal(typeof authClient.signIn.magicLink, "function");
  });
});
