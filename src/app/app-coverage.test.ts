import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { before, describe, it, mock } from "node:test";
import React from "react";
import {
  NextNotFound,
  NextRedirect,
  installNextMocks,
  renderElement,
  resetHarness,
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

const authApi = {
  getSession: async () => (sessionUser ? { user: sessionUser } : null),
  signInMagicLink: async () => ({}),
  magicLinkVerify: async () => ({ user: fakeUser }),
  signOut: async () => ({}),
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
    assert.match(sent, /Check your email/);
    const err = await renderElement(
      await SignIn({ searchParams: Promise.resolve({ error: "invalid" }) }),
    );
    assert.match(err, /invalid or expired/i);
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
    assert.match(html, /S1/);
    assert.match(html, /S12/);
    assert.ok(fileId);
  });

  it("renders settings stub", async () => {
    resetHarness();
    sessionUser = fakeUser;
    const { default: Settings } = await import("@/app/app/settings/page");
    const html = await renderElement(await Settings());
    assert.match(html, /Settings/);
    assert.match(html, /Sign out/);
  });

  it("renders section stub and 404s unknown key", async () => {
    resetHarness();
    sessionUser = fakeUser;
    const { default: Section } = await import("@/app/app/sections/[key]/page");
    const html = await renderElement(
      await Section({ params: Promise.resolve({ key: "S3" }) }),
    );
    assert.match(html, /Banking/);
    assert.match(html, /Coming in the next PR/);

    await assert.rejects(
      () => Section({ params: Promise.resolve({ key: "S99" }) }),
      (e: unknown) => e instanceof NextNotFound,
    );
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

  it("exercises server actions", async () => {
    resetHarness();
    sessionUser = null;
    const actions = await import("@/app/actions");

    await assert.rejects(
      () => actions.requestMagicLink(new FormData()),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/sign-in");
        return true;
      },
    );

    const fd = new FormData();
    fd.set("email", "new@ex.com");
    await assert.rejects(
      () => actions.requestMagicLink(fd),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/sign-in?sent=1");
        return true;
      },
    );

    // signInMagicLink throws path
    const orig = authApi.signInMagicLink;
    authApi.signInMagicLink = async () => {
      throw new Error("boom");
    };
    const fd2 = new FormData();
    fd2.set("email", "err@ex.com");
    await assert.rejects(
      () => actions.requestMagicLink(fd2),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/sign-in?sent=1");
        return true;
      },
    );
    authApi.signInMagicLink = orig;

    await assert.rejects(
      () => actions.confirmMagicLink(new FormData()),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/sign-in");
        return true;
      },
    );

    const ok = new FormData();
    ok.set("token", "good");
    await assert.rejects(
      () => actions.confirmMagicLink(ok),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/app");
        return true;
      },
    );

    const badVerify = authApi.magicLinkVerify;
    authApi.magicLinkVerify = async () => {
      throw new Error("bad");
    };
    const bad = new FormData();
    bad.set("token", "bad");
    await assert.rejects(
      () => actions.confirmMagicLink(bad),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/sign-in?error=invalid");
        return true;
      },
    );
    authApi.magicLinkVerify = badVerify;

    // verify returns no user id
    authApi.magicLinkVerify = async () => ({}) as { user: typeof fakeUser };
    const noUser = new FormData();
    noUser.set("token", "nouser");
    await assert.rejects(
      () => actions.confirmMagicLink(noUser),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/app");
        return true;
      },
    );
    authApi.magicLinkVerify = badVerify;

    await assert.rejects(
      () => actions.signOut(),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/");
        return true;
      },
    );
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
