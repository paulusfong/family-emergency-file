import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { NextRedirect, installNextMocks, resetHarness } from "../test/next-harness";
import { unauthenticatedRedirect } from "./session-gate";

process.env.BETTER_AUTH_SECRET = "s".repeat(32);
process.env.DATABASE_URL = "file:./data/fef-session-test.sqlite";

installNextMocks();

let sessionUser: { id: string; email: string; name: string } | null = null;

mock.module("./auth", {
  namedExports: {
    auth: {
      api: {
        getSession: async () => (sessionUser ? { user: sessionUser } : null),
      },
    },
  },
});

mock.module("./household", {
  namedExports: {
    ensureHouseholdFile: async (userId: string) => ({
      id: "file-1",
      userId,
      title: "Family Emergency File",
    }),
  },
});

describe("session gate pure", () => {
  it("rejects missing / unauthenticated user with /sign-in", () => {
    assert.equal(unauthenticatedRedirect(null), "/sign-in");
    assert.equal(unauthenticatedRedirect(undefined), "/sign-in");
  });

  it("allows an authenticated user through", () => {
    assert.equal(unauthenticatedRedirect({ id: "u1" }), null);
  });
});

describe("session helpers", async () => {
  const session = await import("./session");

  it("requireUser redirects to /sign-in when unauthenticated", async () => {
    resetHarness();
    sessionUser = null;
    await assert.rejects(
      () => session.requireUser(),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/sign-in");
        return true;
      },
    );
  });

  it("requireUser returns the user when authenticated", async () => {
    resetHarness();
    sessionUser = { id: "u1", email: "a@ex.com", name: "A" };
    const user = await session.requireUser();
    assert.equal(user.id, "u1");
  });

  it("getSessionUser returns null without a session", async () => {
    resetHarness();
    sessionUser = null;
    assert.equal(await session.getSessionUser(), null);
  });

  it("requireHousehold ensures a file for the signed-in user", async () => {
    resetHarness();
    sessionUser = { id: "u2", email: "b@ex.com", name: "B" };
    const { user, file } = await session.requireHousehold();
    assert.equal(user.id, "u2");
    assert.equal(file.id, "file-1");
  });

  it("requireHousehold redirects when logged out", async () => {
    resetHarness();
    sessionUser = null;
    await assert.rejects(
      () => session.requireHousehold(),
      (e: unknown) => {
        assert.ok(e instanceof NextRedirect);
        assert.equal((e as NextRedirect).url, "/sign-in");
        return true;
      },
    );
  });
});
