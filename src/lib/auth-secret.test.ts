import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAuthSecret } from "./auth-secret";

describe("resolveAuthSecret", () => {
  it("throws outside development when secret is missing", () => {
    assert.throws(
      () => resolveAuthSecret({ NODE_ENV: "production" }),
      /BETTER_AUTH_SECRET must be set/,
    );
  });

  it("throws outside development when secret is too short", () => {
    assert.throws(
      () =>
        resolveAuthSecret({
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: "too-short",
        }),
      /at least 32 characters/,
    );
  });

  it("throws in development when secret is missing (no hardcoded fallback)", () => {
    assert.throws(
      () => resolveAuthSecret({ NODE_ENV: "development" }),
      /Set it in \.env\.local/,
    );
  });

  it("accepts a long enough secret", () => {
    const secret = "a".repeat(32);
    assert.equal(
      resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: secret }),
      secret,
    );
  });

  it("treats empty secret like missing", () => {
    assert.throws(
      () => resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: "" }),
      /BETTER_AUTH_SECRET must be set/,
    );
  });
});
