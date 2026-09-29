import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applySchema } from "../test/apply-schema";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-auth-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;
process.env.BETTER_AUTH_SECRET = "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3000";
(process.env as { NODE_ENV?: string }).NODE_ENV = "test";

describe("auth module wiring", async () => {
  const { client } = await import("./db");
  await applySchema(client);

  it("constructs betterAuth and exercises sendMagicLink mailer", async () => {
    const { auth } = await import("./auth");
    assert.ok(auth?.api);

    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      await auth.api.signInMagicLink({
        body: { email: "mailer@ex.com", callbackURL: "/app" },
        headers: new Headers(),
      });
    } finally {
      console.log = orig;
    }
    assert.ok(logs.length >= 1 || fs.existsSync(path.join(process.cwd(), "tmp", "last-magic-link.txt")));
  });
});

describe("auth-client", () => {
  it("creates the browser auth client", async () => {
    const mod = await import("./auth-client");
    assert.ok(mod.authClient);
  });
});
