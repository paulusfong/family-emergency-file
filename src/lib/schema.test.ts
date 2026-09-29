import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import {
  CHECKLIST_STATUS,
  ENTRY_TYPES,
  SECTION_DEFS,
  SECTION_STATUS,
  account,
  checklistItems,
  entries,
  exportEvents,
  householdFiles,
  sections,
  session,
  user,
  verification,
} from "./schema";

function fkTargets(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      from: ref.columns.map((c) => c.name).join(","),
      to: `${getTableConfig(ref.foreignTable).name}.${ref.foreignColumns.map((c) => c.name).join(",")}`,
      onDelete: fk.onDelete,
    };
  });
}

describe("schema", () => {
  it("names the tables better-auth and the domain expect", () => {
    assert.deepEqual(
      [user, session, account, verification, householdFiles, sections, entries, checklistItems, exportEvents].map(
        (t) => getTableConfig(t).name,
      ),
      [
        "user",
        "session",
        "account",
        "verification",
        "household_files",
        "sections",
        "entries",
        "checklist_items",
        "export_events",
      ],
    );
  });

  it("cascades every foreign key to its parent", () => {
    assert.deepEqual(fkTargets(session), [{ from: "user_id", to: "user.id", onDelete: "cascade" }]);
    assert.deepEqual(fkTargets(account), [{ from: "user_id", to: "user.id", onDelete: "cascade" }]);
    assert.deepEqual(fkTargets(householdFiles), [
      { from: "user_id", to: "user.id", onDelete: "cascade" },
    ]);
    assert.deepEqual(fkTargets(sections), [
      { from: "household_file_id", to: "household_files.id", onDelete: "cascade" },
    ]);
    assert.deepEqual(fkTargets(entries), [
      { from: "section_id", to: "sections.id", onDelete: "cascade" },
    ]);
    assert.deepEqual(fkTargets(checklistItems), [
      { from: "section_id", to: "sections.id", onDelete: "cascade" },
    ]);
    assert.deepEqual(fkTargets(exportEvents), [
      { from: "household_file_id", to: "household_files.id", onDelete: "cascade" },
    ]);
  });

  it("indexes entries by section and keeps checklist item keys unique per section", () => {
    const ent = getTableConfig(entries).indexes.map((i) => i.config);
    assert.ok(ent.some((i) => !i.unique && i.name === "entries_section_id"));
    const items = getTableConfig(checklistItems).indexes.map((i) => i.config);
    assert.ok(items.some((i) => i.unique && i.name === "checklist_items_section_key"));
    assert.deepEqual([...CHECKLIST_STATUS], ["open", "done", "skipped"]);
  });

  it("enforces one household file per user and unique section keys per file", () => {
    const hf = getTableConfig(householdFiles).indexes.map((i) => i.config);
    assert.ok(hf.some((i) => i.unique && i.name === "household_files_userId"));
    const sec = getTableConfig(sections).indexes.map((i) => i.config);
    assert.ok(sec.some((i) => i.unique && i.name === "sections_file_key"));
  });

  it("defines twelve section keys S1–S12 and the status/entry enums", () => {
    assert.equal(SECTION_DEFS.length, 12);
    assert.deepEqual(
      SECTION_DEFS.map((d) => d.key),
      ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"],
    );
    assert.deepEqual([...SECTION_STATUS], ["not_started", "in_progress", "complete"]);
    assert.deepEqual([...ENTRY_TYPES], ["contact", "account", "policy", "document_location", "access_plan", "note"]);
  });
});
