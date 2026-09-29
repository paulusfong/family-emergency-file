import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { id } from "./ids";

describe("ids", () => {
  it("returns a UUID string", () => {
    const a = id();
    const b = id();
    assert.match(a, /^[0-9a-f-]{36}$/i);
    assert.notEqual(a, b);
  });
});
