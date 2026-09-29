import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENTRY_TYPES,
  SECTION_DEFS,
  SECTION_STATUS,
  account,
  entries,
  householdFiles,
  sections,
  session,
  user,
  verification,
} from "./schema";

describe("schema", () => {
  it("exports better-auth and domain tables", () => {
    assert.ok(user);
    assert.ok(session);
    assert.ok(account);
    assert.ok(verification);
    assert.ok(householdFiles);
    assert.ok(sections);
    assert.ok(entries);
  });

  it("defines twelve section keys S1–S12", () => {
    assert.equal(SECTION_DEFS.length, 12);
    assert.equal(SECTION_DEFS[0].key, "S1");
    assert.equal(SECTION_DEFS[11].key, "S12");
    assert.deepEqual([...SECTION_STATUS], ["not_started", "in_progress", "complete"]);
    assert.ok(ENTRY_TYPES.includes("contact"));
  });
});
