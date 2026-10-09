import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { falsePositives, generateContactNotes, PATTERNS } from "../test/contact-notes";

/**
 * Realistic contact notes (src/test/contact-notes.ts, default seed, 600 rows
 * per pattern) must pass. The one known exception: a bare 5-digit number right
 * after a phone ("(404) 683-5510, 30301") reads exactly like a phone and a
 * 5-digit extension, so it is blocked whenever the joined digits pass Luhn
 * (about 1 in 10 without "+1", 2 in 10 with it). Re-run the table with
 *   npx tsx src/test/contact-notes.ts
 */
const EXPECTED_BLOCKED: Record<(typeof PATTERNS)[number], number> = {
  "address-then-phone": 0,
  "date-then-phone": 0,
  "zip-then-phone": 0,
  "street-number-then-phone": 0,
  "phone-then-address": 0,
  "phone-then-bare-zip": 102,
  "two-phones": 0,
  "phone-short-extension": 0,
  "street-number-phone-short-extension": 0,
};

describe("realistic contact notes (seeded)", () => {
  const rows = generateContactNotes();

  it("generates the same rows for the same seed, and others for another", () => {
    assert.equal(rows.length, 600 * PATTERNS.length);
    assert.deepEqual(generateContactNotes(), rows);
    assert.notDeepEqual(generateContactNotes(5, 1), generateContactNotes(5));
  });

  it("blocks none of them except the known phone-then-bare-ZIP rows", () => {
    const fp = falsePositives(rows);
    const blocked = Object.fromEntries(Object.entries(fp).map(([pattern, { blocked: n }]) => [pattern, n]));
    assert.deepEqual(blocked, EXPECTED_BLOCKED);
    for (const { rows: n } of Object.values(fp)) assert.equal(n, 600);
  });
});
