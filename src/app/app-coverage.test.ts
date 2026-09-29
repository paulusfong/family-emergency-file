import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { before, describe, it, mock } from "node:test";
import React from "react";
import {
  NextRedirect,
  installNextMocks,
  renderElement,
  resetHarness,
  setHeaders,
} from "../test/next-harness";
import { applySchema } from "../test/apply-schema";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-app-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;
process.env.BETTER_AUTH_SECRET = "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3000";
(process.env as { NODE_ENV?: string }).NODE_ENV = "test";

installNextMocks();
mock.module(pathToFileURL(path.resolve("src/app/globals.css")).href, {
  defaultExport: {},
});

const fakeUser = {
  id: "user-1",
  email: "owner@ex.com",
  name: "Owner",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let sessionUser: typeof fakeUser | null = fakeUser;

const calls: { name: string; args: unknown }[] = [];

const authApi = {
  getSession: async () => (sessionUser ? { user: sessionUser } : null),
  signInMagicLink: async (args: unknown): Promise<unknown> => {
    calls.push({ name: "signInMagicLink", args });
    return {};
  },
  magicLinkVerify: async (args: unknown): Promise<unknown> => {
    calls.push({ name: "magicLinkVerify", args });
    return { user: fakeUser };
  },
  signOut: async (args: unknown) => {
    calls.push({ name: "signOut", args });
    return {};
  },
  handler: async (req?: Request) => new Response(req ? "auth-ok" : "auth-ok", { status: 200 }),
};

mock.module("@/lib/auth", {
  namedExports: {
    auth: { api: authApi, handler: authApi.handler },
  },
});

mock.module("better-auth/next-js", {
  namedExports: {
    toNextJsHandler: () => ({
      GET: async (req: Request) => authApi.handler(req),
      POST: async (req: Request) => authApi.handler(req),
    }),
    nextCookies: () => ({}),
  },
});

describe("app coverage", async () => {
  const { client, db } = await import("@/lib/db");
  const schema = await import("@/lib/schema");
  const { id } = await import("@/lib/ids");
  const { ensureHouseholdFile } = await import("@/lib/household");

  let fileId = "";

  before(async () => {
    resetHarness();
    await applySchema(client);
    const ownerId = id();
    fakeUser.id = ownerId;
    await db.insert(schema.user).values({
      id: ownerId,
      name: "Owner",
      email: "owner@ex.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const file = await ensureHouseholdFile(ownerId);
    fileId = file.id;
    sessionUser = fakeUser;
  });

  it("renders marketing home when logged out", async () => {
    resetHarness();
    sessionUser = null;
    const { default: Home } = await import("@/app/page");
    const el = await Home();
    const html = await renderElement(el);
    assert.match(html, /Sign in with email/);
  });

  it("home redirects signed-in users to /app", async () => {
    resetHarness();
    sessionUser = fakeUser;
    const { default: Home } = await import("@/app/page");
    await assert.rejects(() => Home(), (e: unknown) => {
      assert.ok(e instanceof NextRedirect);
      assert.equal((e as NextRedirect).url, "/app");
      return true;
    });
  });

  it("renders sign-in page when logged out", async () => {
    resetHarness();
    sessionUser = null;
    const { default: SignIn } = await import("@/app/sign-in/page");
    const el = await SignIn({ searchParams: Promise.resolve({}) });
    const html = await renderElement(el);
    assert.match(html, /Send magic link/);
    assert.doesNotMatch(html, /type=["']password["']/);
  });

  it("sign-in shows sent and error flashes", async () => {
    resetHarness();
    sessionUser = null;
    const { default: SignIn } = await import("@/app/sign-in/page");
    const sent = await renderElement(
      await SignIn({ searchParams: Promise.resolve({ sent: "1" }) }),
    );
    assert.match(sent, /If that address can receive email/);
    const render = async (error: string) =>
      renderElement(await SignIn({ searchParams: Promise.resolve({ error }) }));
    assert.match(await render("invalid"), /invalid or expired/i);
    assert.match(await render("email"), /Enter a valid email address/);
    assert.match(await render("send"), /couldn&#x27;t send the sign-in email/);
    assert.match(await render("unknown-code"), /invalid or expired/i);
  });

  it("sign-in redirects when already signed in", async () => {
    resetHarness();
    sessionUser = fakeUser;
    const { default: SignIn } = await import("@/app/sign-in/page");
    await assert.rejects(
      () => SignIn({ searchParams: Promise.resolve({}) }),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/app");
        return true;
      },
    );
  });

  it("confirm page requires token", async () => {
    resetHarness();
    const { default: Confirm } = await import("@/app/sign-in/confirm/page");
    await assert.rejects(
      () => Confirm({ searchParams: Promise.resolve({}) }),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/sign-in");
        return true;
      },
    );
  });

  it("renders confirm page with token", async () => {
    resetHarness();
    const { default: Confirm } = await import("@/app/sign-in/confirm/page");
    const html = await renderElement(
      await Confirm({ searchParams: Promise.resolve({ token: "tok" }) }),
    );
    assert.match(html, /Continue to dashboard/);
  });

  it("renders dashboard at 0% with twelve sections", async () => {
    resetHarness();
    sessionUser = fakeUser;
    const { default: Dash } = await import("@/app/app/page");
    const html = await renderElement(await Dash());
    assert.match(html, /0%/);
    assert.match(html, /nothing filled in yet/);
    assert.match(html, /S1/);
    assert.match(html, /S12/);
    assert.ok(fileId);
  });

  it("dashboard drops the empty-state copy once a section is complete", async () => {
    resetHarness();
    sessionUser = fakeUser;
    const { eq, and } = await import("drizzle-orm");
    await db
      .update(schema.sections)
      .set({ status: "complete" })
      .where(and(eq(schema.sections.householdFileId, fileId), eq(schema.sections.sectionKey, "S1")));
    const { default: Dash } = await import("@/app/app/page");
    const html = await renderElement(await Dash());
    assert.match(html, /8%/);
    assert.doesNotMatch(html, /nothing filled in yet/);
    await db
      .update(schema.sections)
      .set({ status: "not_started" })
      .where(and(eq(schema.sections.householdFileId, fileId), eq(schema.sections.sectionKey, "S1")));
  });

  it("renders settings stub", async () => {
    resetHarness();
    sessionUser = fakeUser;
    const { default: Settings } = await import("@/app/app/settings/page");
    const html = await renderElement(await Settings());
    assert.match(html, /Settings/);
    assert.match(html, /Sign out/);
  });

  it("renders privacy and terms", async () => {
    resetHarness();
    sessionUser = null;
    const { default: Privacy } = await import("@/app/privacy/page");
    const { default: Terms } = await import("@/app/terms/page");
    assert.match(await renderElement(await Privacy()), /Privacy/);
    assert.match(await renderElement(await Terms()), /Terms/);
    sessionUser = fakeUser;
    assert.match(await renderElement(await Privacy()), /Privacy/);
  });

  it("renders root layout", async () => {
    resetHarness();
    const layoutMod = await import("@/app/layout");
    assert.ok(layoutMod.metadata);
    assert.ok((layoutMod.metadata as { title: unknown }).title);
    const html = await renderElement(
      await layoutMod.default({ children: React.createElement("div", null, "child") }),
    );
    assert.match(html, /child/);
  });

  async function redirectOf(run: () => Promise<unknown>) {
    try {
      await run();
    } catch (e) {
      if (e instanceof NextRedirect) return e.url;
      throw e;
    }
    throw new Error("expected a redirect");
  }

  function form(entries: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  }

  it("requestMagicLink rejects missing or malformed email without calling auth", async () => {
    resetHarness();
    calls.length = 0;
    const actions = await import("@/app/actions");
    assert.equal(await redirectOf(() => actions.requestMagicLink(new FormData())), "/sign-in?error=email");
    assert.equal(await redirectOf(() => actions.requestMagicLink(form({ email: "nope" }))), "/sign-in?error=email");
    assert.deepEqual(calls, []);
  });

  it("requestMagicLink sends a normalized address and shows the neutral sent message", async () => {
    resetHarness();
    setHeaders({ "x-test": "1" });
    calls.length = 0;
    const actions = await import("@/app/actions");
    const url = await redirectOf(() => actions.requestMagicLink(form({ email: "  New@Ex.COM " })));
    assert.equal(url, "/sign-in?sent=1");
    assert.equal(calls.length, 1);
    const args = calls[0].args as { body: unknown; headers: Headers };
    assert.equal(calls[0].name, "signInMagicLink");
    assert.deepEqual(args.body, { email: "new@ex.com", callbackURL: "/app" });
    assert.equal(args.headers.get("x-test"), "1");
  });

  it("requestMagicLink reports a delivery failure instead of 'sent'", async () => {
    resetHarness();
    const actions = await import("@/app/actions");
    const orig = authApi.signInMagicLink;
    const boom = new Error("Resend failed with status 500");
    authApi.signInMagicLink = async () => {
      throw boom;
    };
    const errors: unknown[][] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => {
      errors.push(a);
    };
    try {
      const url = await redirectOf(() => actions.requestMagicLink(form({ email: "err@ex.com" })));
      assert.equal(url, "/sign-in?error=send");
    } finally {
      console.error = origErr;
      authApi.signInMagicLink = orig;
    }
    assert.deepEqual(errors, [["magic-link send failed", boom]]);
  });

  it("confirmMagicLink requires a token", async () => {
    resetHarness();
    calls.length = 0;
    const actions = await import("@/app/actions");
    assert.equal(await redirectOf(() => actions.confirmMagicLink(new FormData())), "/sign-in");
    assert.equal(await redirectOf(() => actions.confirmMagicLink(form({ token: "   " }))), "/sign-in");
    assert.deepEqual(calls, []);
  });

  it("confirmMagicLink verifies the trimmed token and creates the household file", async () => {
    resetHarness();
    calls.length = 0;
    const actions = await import("@/app/actions");
    const newUserId = id();
    await db.insert(schema.user).values({
      id: newUserId,
      name: "New",
      email: "confirm-new@ex.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const orig = authApi.magicLinkVerify;
    authApi.magicLinkVerify = async (args: unknown) => {
      calls.push({ name: "magicLinkVerify", args });
      return { user: { ...fakeUser, id: newUserId } };
    };
    try {
      assert.equal(await redirectOf(() => actions.confirmMagicLink(form({ token: "  good  " }))), "/app");
    } finally {
      authApi.magicLinkVerify = orig;
    }
    assert.deepEqual((calls[0].args as { query: unknown }).query, { token: "good" });
    const { eq } = await import("drizzle-orm");
    const files = await db
      .select()
      .from(schema.householdFiles)
      .where(eq(schema.householdFiles.userId, newUserId));
    assert.equal(files.length, 1);
  });

  it("confirmMagicLink tolerates a verify result without a user", async () => {
    resetHarness();
    const actions = await import("@/app/actions");
    const orig = authApi.magicLinkVerify;
    for (const result of [undefined, null, {}, { user: {} }]) {
      authApi.magicLinkVerify = async () => result;
      assert.equal(await redirectOf(() => actions.confirmMagicLink(form({ token: "x" }))), "/app");
    }
    authApi.magicLinkVerify = orig;
  });

  it("confirmMagicLink sends invalid/expired tokens back with an error", async () => {
    resetHarness();
    const actions = await import("@/app/actions");
    const orig = authApi.magicLinkVerify;
    authApi.magicLinkVerify = async () => {
      throw new Error("INVALID_TOKEN");
    };
    try {
      assert.equal(await redirectOf(() => actions.confirmMagicLink(form({ token: "bad" }))), "/sign-in?error=invalid");
    } finally {
      authApi.magicLinkVerify = orig;
    }
  });

  it("signOut revokes via auth and returns home", async () => {
    resetHarness();
    calls.length = 0;
    const actions = await import("@/app/actions");
    assert.equal(await redirectOf(() => actions.signOut()), "/");
    assert.equal(calls[0].name, "signOut");
    assert.ok((calls[0].args as { headers: Headers }).headers instanceof Headers);
  });

  it("/app layout redirects logged-out users and renders children when signed in", async () => {
    resetHarness();
    const { default: AppLayout } = await import("@/app/app/layout");
    sessionUser = null;
    assert.equal(await redirectOf(() => AppLayout({ children: "secret" })), "/sign-in");
    sessionUser = fakeUser;
    // The lost-save notice renders nothing until a save is lost.
    assert.equal(await renderElement(await AppLayout({ children: "secret" })), "secret");
  });

  it("auth API route handlers respond", async () => {
    const route = await import("@/app/api/auth/[...all]/route");
    const getRes = await (route.GET as (req: Request) => Promise<Response>)(
      new Request("http://localhost:3000/api/auth/ok"),
    );
    assert.equal(await getRes.text(), "auth-ok");
    const postRes = await (route.POST as (req: Request) => Promise<Response>)(
      new Request("http://localhost:3000/api/auth/ok", { method: "POST" }),
    );
    assert.equal(await postRes.text(), "auth-ok");
  });

  it("shell renders signed-in and signed-out nav", async () => {
    const { Shell } = await import("@/components/shell");
    const out = await renderElement(
      React.createElement(Shell, { signedIn: true }, "body"),
    );
    assert.match(out, /Dashboard/);
    assert.match(out, /Settings/);
    const guest = await renderElement(
      React.createElement(Shell, null, "body"),
    );
    assert.match(guest, /Sign in/);
    assert.match(guest, /not a password manager/i);
  });
});
