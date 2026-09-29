import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ENTRY_TYPE_DEFS, FULL_NUMBER_ERROR, isEntryType, validateEntry } from "./entry-fields";

/**
 * QA's HTTP corpora for PR #6, copied verbatim into fixtures/qa. Each row is
 * one input sent to one field of one entry type. The row's `accepted` column
 * is what the build QA tested did, not the expectation. The expectation
 * comes from QA's input lists (inputs*.json, keyed by `input`):
 *
 * - a `reject` input must get the full-number error, in every field;
 * - an `allow` input must never get a privacy error. It is stored unless the
 *   field's own format rules it out: Last 4 takes only "1234", Email takes
 *   none of them, and Phone takes only the inputs written as phone numbers.
 */
type Row = { type: string; field: string; kind: string; input: string; value: string; accepted: boolean };
type Inputs = { reject: Record<string, string>; allow: Record<string, string> };

const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/qa/${name}`, import.meta.url), "utf8"));

const PHONE_INPUTS = new Set(["phone-paren", "phone-intl", "uk", "cn", "us-phone-1"]);
const FORMAT_ALLOWS: Record<string, (input: string) => boolean> = {
  last4: (input) => input === "last4",
  email: () => false,
  phone: (input) => PHONE_INPUTS.has(input),
};

function expectation(row: Row, inputs: Inputs): "reject-privacy" | "reject-format" | "accept" {
  if (row.input in inputs.reject) return "reject-privacy";
  assert.ok(row.input in inputs.allow, `unknown input ${row.input}`);
  const format = FORMAT_ALLOWS[row.kind];
  return format && !format(row.input) ? "reject-format" : "accept";
}

function outcome(row: Row) {
  assert.ok(isEntryType(row.type), row.type);
  const payload = row.field === "label" ? { label: row.value } : { label: "QA case", [row.field]: row.value };
  const res = validateEntry(row.type, payload);
  if (res.ok) return res.payload[row.field as keyof typeof res.payload] === row.value || res.label === row.value ? "accept" : "dropped";
  const error = res.fieldErrors[row.field];
  if (error === undefined) return `other field: ${JSON.stringify(res.fieldErrors)}`;
  return error === FULL_NUMBER_ERROR ? "reject-privacy" : "reject-format";
}

for (const [corpus, inputsFile, rowCount] of [
  ["break-http.json", "inputs-break.json", 1508],
  ["validate-http.json", "inputs.json", 667],
] as const) {
  describe(`QA corpus ${corpus} through validateEntry`, () => {
    const rows = load<Row[]>(corpus);
    const inputs = load<Inputs>(inputsFile);

    it("covers every row, field kind, and entry type", () => {
      assert.equal(rows.length, rowCount);
      for (const row of rows) {
        const def = ENTRY_TYPE_DEFS[row.type as keyof typeof ENTRY_TYPE_DEFS];
        const kind = row.field === "label" ? "text" : def.fields.find((f) => f.name === row.field)?.kind;
        assert.equal(kind, row.kind, `${row.type}.${row.field}`);
        assert.equal(row.value, inputs.reject[row.input] ?? inputs.allow[row.input], row.input);
      }
    });

    it("matches the expected outcome for every row", () => {
      const wrong = rows
        .map((row) => ({ row, want: expectation(row, inputs), got: outcome(row) }))
        .filter(({ want, got }) => want !== got)
        .map(({ row, want, got }) => `${row.type}.${row.field} ${row.input}: want ${want}, got ${got}`);
      assert.deepEqual(wrong, []);
    });

    it("rejects every reject input and never raises a privacy error on an allow input", () => {
      const tally = { reject: 0, allow: 0 };
      for (const row of rows) {
        const got = outcome(row);
        if (row.input in inputs.reject) {
          assert.equal(got, "reject-privacy", `${row.type}.${row.field} ${row.input}`);
          tally.reject++;
        } else {
          assert.notEqual(got, "reject-privacy", `${row.type}.${row.field} ${row.input}`);
          tally.allow++;
        }
      }
      assert.equal(tally.reject + tally.allow, rowCount);
    });
  });
}
