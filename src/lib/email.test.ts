import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims and lowercases valid addresses", () => {
    assert.equal(normalizeEmail("  New@Ex.COM "), "new@ex.com");
  });

  it("rejects empty, missing, and malformed values", () => {
    for (const bad of [null, undefined, "", "   ", "no-at.example", "a@b", "a b@c.d", "@c.d", "a@.d x", "x a@b.co", "a@b.co y"]) {
      assert.equal(normalizeEmail(bad), null, String(bad));
    }
  });
});
