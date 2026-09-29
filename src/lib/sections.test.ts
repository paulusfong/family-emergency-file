import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ENTRY_TYPES, SECTION_DEFS } from "./schema";
import {
  CHECKLIST_SEED_TOTAL,
  SECTION_CHECKLISTS,
  SECTION_PRIMARY_TYPE,
  checklistSeedRows,
  findSectionDef,
} from "./sections";

describe("section seed", () => {
  it("defines a starter checklist for each of the twelve sections", () => {
    assert.deepEqual(Object.keys(SECTION_CHECKLISTS), SECTION_DEFS.map((d) => d.key));
    for (const d of SECTION_DEFS) {
      const items = SECTION_CHECKLISTS[d.key];
      assert.ok(items.length >= 4, `${d.key} has at least four items`);
      assert.equal(new Set(items.map((i) => i.key)).size, items.length, `${d.key} item keys are unique`);
      for (const item of items) {
        assert.match(item.key, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${d.key}/${item.key} is a stable kebab key`);
        assert.ok(item.label.trim().length >= 3, `${d.key}/${item.key} has a label`);
        assert.doesNotMatch(item.label, /\b(enter|type) your (password|pin)\b/i);
      }
    }
  });

  it("QA-3: seeds 65 items, the count and split the README states", () => {
    const counts = SECTION_DEFS.map((d) => SECTION_CHECKLISTS[d.key].length);
    assert.deepEqual(counts, [5, 8, 5, 4, 6, 6, 4, 6, 4, 6, 7, 4]);
    assert.equal(CHECKLIST_SEED_TOTAL, 65);
    assert.equal(checklistSeedRows().length, 65);
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    assert.match(readme, new RegExp(`${CHECKLIST_SEED_TOTAL} starter items across S1–S12 \\(${counts.join(", ")};`));
  });

  it("covers the Clark checklist staples", () => {
    const labels = (key: keyof typeof SECTION_CHECKLISTS) =>
      SECTION_CHECKLISTS[key].map((i) => i.label).join(" | ");
    assert.match(labels("S3"), /Checking and savings accounts/);
    assert.match(labels("S3"), /Safe deposit box/);
    assert.match(labels("S5"), /Beneficiary designations/);
    assert.match(labels("S6"), /Life insurance/);
    assert.match(labels("S8"), /How each bill is paid/);
    assert.match(labels("S10"), /Password manager name/);
    assert.match(labels("S11"), /Will/);
    assert.match(labels("S1"), /never the full number/);
  });

  it("flattens seeds into ordered rows with 1-based sort order", () => {
    const rows = checklistSeedRows();
    assert.equal(rows.length, CHECKLIST_SEED_TOTAL);
    assert.equal(
      CHECKLIST_SEED_TOTAL,
      SECTION_DEFS.reduce((n, d) => n + SECTION_CHECKLISTS[d.key].length, 0),
    );
    assert.deepEqual(rows[0], {
      sectionKey: "S1",
      itemKey: SECTION_CHECKLISTS.S1[0].key,
      label: SECTION_CHECKLISTS.S1[0].label,
      sortOrder: 1,
    });
    for (const d of SECTION_DEFS) {
      const mine = rows.filter((r) => r.sectionKey === d.key);
      assert.deepEqual(mine.map((r) => r.sortOrder), mine.map((_, i) => i + 1));
      assert.deepEqual(mine.map((r) => r.itemKey), SECTION_CHECKLISTS[d.key].map((i) => i.key));
      assert.deepEqual(mine.map((r) => r.label), SECTION_CHECKLISTS[d.key].map((i) => i.label));
    }
  });

  it("suggests a valid primary entry type per section", () => {
    assert.deepEqual(Object.keys(SECTION_PRIMARY_TYPE), SECTION_DEFS.map((d) => d.key));
    for (const t of Object.values(SECTION_PRIMARY_TYPE)) assert.ok(ENTRY_TYPES.includes(t));
    assert.equal(SECTION_PRIMARY_TYPE.S2, "contact");
    assert.equal(SECTION_PRIMARY_TYPE.S3, "account");
    assert.equal(SECTION_PRIMARY_TYPE.S6, "policy");
    assert.equal(SECTION_PRIMARY_TYPE.S11, "document_location");
    assert.equal(SECTION_PRIMARY_TYPE.S12, "note");
  });

  it("finds section definitions by key", () => {
    assert.equal(findSectionDef("S3")?.title, "Banking & cash");
    assert.equal(findSectionDef("S99"), undefined);
    assert.equal(findSectionDef("s3"), undefined);
  });
});
