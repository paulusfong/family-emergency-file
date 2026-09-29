import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_BASE_URL, resolveBaseURL } from "./base-url";

describe("resolveBaseURL", () => {
  it("uses BETTER_AUTH_URL when set, in any environment", () => {
    assert.equal(resolveBaseURL({ BETTER_AUTH_URL: "https://fef.example" }), "https://fef.example");
    assert.equal(
      resolveBaseURL({ BETTER_AUTH_URL: "https://fef.example", NODE_ENV: "production" }),
      "https://fef.example",
    );
  });

  it("falls back to localhost:3000 outside production", () => {
    assert.equal(DEFAULT_BASE_URL, "http://localhost:3000");
    assert.equal(resolveBaseURL({}), "http://localhost:3000");
    assert.equal(resolveBaseURL({ NODE_ENV: "development" }), "http://localhost:3000");
    assert.equal(resolveBaseURL({ NODE_ENV: "test", VERCEL: "0" }), "http://localhost:3000");
  });

  it("fails closed in production and on Vercel", () => {
    assert.throws(() => resolveBaseURL({ NODE_ENV: "production" }), /BETTER_AUTH_URL must be set in production/);
    assert.throws(() => resolveBaseURL({ VERCEL: "1" }), /BETTER_AUTH_URL must be set in production/);
    assert.throws(() => resolveBaseURL({ NODE_ENV: "production", BETTER_AUTH_URL: "" }), /must be set/);
  });
});
