import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-export-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;

const T0 = new Date("2026-09-29T10:00:00.000Z");

describe("export", async () => {
  const { client, db } = await import("./db");
  const { applySchema } = await import("../test/apply-schema");
  const schema = await import("./schema");
  const { ensureHouseholdFile } = await import("./household");
  const { createEntry, findSection, listChecklist, setChecklistStatus } = await import("./entries");
  const ex = await import("./export");

  async function makeUser(email: string) {
    const userId = crypto.randomUUID();
    await db.insert(schema.user).values({ id: userId, email, name: "", emailVerified: true });
    return ensureHouseholdFile(userId);
  }

  before(async () => {
    await applySchema(client);
  });

  describe("buildExportData", () => {
    const rows = {
      title: "Family Emergency File",
      sections: [
        { id: "s1", sectionKey: "S1", title: "Household snapshot" },
        { id: "s2", sectionKey: "S2", title: "Key contacts" },
        { id: "s3", sectionKey: "S3", title: "Banking & cash" },
      ],
      checklist: [
        { sectionId: "s1", label: "Who lives here", status: "open" as const },
        { sectionId: "s2", label: "Executor", status: "done" as const },
        { sectionId: "s2", label: "Attorney", status: "skipped" as const },
        { sectionId: "s3", label: "Checking", status: "open" as const },
      ],
      entries: [
        {
          sectionId: "s3",
          entryType: "account" as const,
          label: "Joint checking",
          payloadJson: JSON.stringify({ institution: "Example Bank", last4: "0000", accessPlan: "password: hunter2", extra: "x" }),
          updatedAt: T0,
        },
        {
          sectionId: "s3",
          entryType: "note" as const,
          label: "PIN=4821",
          payloadJson: "{}",
          updatedAt: T0,
        },
      ],
    };

    it("derives each section's status and the overall progress from checklist and entries", () => {
      const data = ex.buildExportData(rows, T0);
      assert.deepEqual(
        data.sections.map((s) => [s.key, s.status, s.statusLabel]),
        [
          ["S1", "not_started", "Not started"],
          ["S2", "complete", "Complete"],
          ["S3", "in_progress", "In progress"],
        ],
      );
      assert.deepEqual(data.progress, { total: 3, complete: 1, inProgress: 1, percent: 33 });
      assert.equal(data.kind, "family-emergency-file");
      assert.equal(data.version, 1);
      assert.equal(data.exportedAt, "2026-09-29T10:00:00.000Z");
      assert.equal(data.title, "Family Emergency File");
      assert.equal(data.notice, "Store this somewhere safe; it contains no passwords.");
    });

    it("keeps checklist labels and statuses in order, per section", () => {
      const data = ex.buildExportData(rows, T0);
      assert.deepEqual(data.sections[1].checklist, [
        { label: "Executor", status: "done" },
        { label: "Attorney", status: "skipped" },
      ]);
      assert.deepEqual(data.sections[0].entries, []);
    });

    it("exports known, non-empty fields with readable labels and redacts blocked values", () => {
      const [account, note] = ex.buildExportData(rows, T0).sections[2].entries;
      assert.deepEqual(account, {
        type: "account",
        typeTitle: "Account",
        label: "Joint checking",
        fields: [
          { name: "institution", label: "Institution", value: "Example Bank" },
          { name: "last4", label: "Last 4 digits", value: "0000" },
          { name: "accessPlan", label: "Access plan", value: "[removed: looked like a password or full number]" },
        ],
        updatedAt: "2026-09-29T10:00:00.000Z",
      });
      assert.deepEqual(note, { type: "note", typeTitle: "Note", label: ex.REDACTED, fields: [], updatedAt: T0.toISOString() });
    });
  });

  it("loads only the owner's file, in section, checklist, and entry order", async () => {
    const file = await makeUser("owner@ex.com");
    const other = await makeUser("other@ex.com");
    const s3 = (await findSection(file.id, "S3"))!;
    const [first] = await listChecklist(s3.id);
    await setChecklistStatus(s3.id, first.id, "done");
    await createEntry(s3.id, "account", "B account", { institution: "Example Bank" });
    await createEntry(s3.id, "note", "A note", { notes: "Safe deposit box key in the kitchen drawer" });
    const o3 = (await findSection(other.id, "S3"))!;
    await createEntry(o3.id, "note", "Not yours", {});

    const data = await ex.loadExportData(file, T0);
    assert.equal(data.title, file.title);
    assert.deepEqual(
      data.sections.map((s) => s.key),
      ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"],
    );
    const s3Out = data.sections[2];
    assert.equal(s3Out.status, "in_progress");
    assert.deepEqual(s3Out.checklist[0], { label: first.label, status: "done" });
    assert.deepEqual(
      s3Out.checklist.map((c) => c.label),
      (await listChecklist(s3.id)).map((c) => c.label),
    );
    assert.deepEqual(s3Out.entries.map((e) => e.label).sort(), ["A note", "B account"]);
    assert.equal(JSON.stringify(data).includes("Not yours"), false);
    assert.equal(data.sections.filter((s) => s.key !== "S3").every((s) => s.entries.length === 0), true);
  });

  it("orders entries by creation time, then label", async () => {
    const file = await makeUser("order@ex.com");
    const s1 = (await findSection(file.id, "S1"))!;
    await db.insert(schema.entries).values([
      { id: "e-late", sectionId: s1.id, entryType: "note", label: "Aaa late", createdAt: new Date(T0.getTime() + 5000) },
      { id: "e-b", sectionId: s1.id, entryType: "note", label: "Bbb", createdAt: T0 },
      { id: "e-a", sectionId: s1.id, entryType: "note", label: "Aaa", createdAt: T0 },
    ]);
    const data = await ex.loadExportData(file, T0);
    assert.deepEqual(data.sections[0].entries.map((e) => e.label), ["Aaa", "Bbb", "Aaa late"]);
  });

  it("records export events without content and reports the latest", async () => {
    const file = await makeUser("events@ex.com");
    assert.equal(await ex.lastExport(file.id), null);
    await ex.recordExport(file.id, "json", new Date("2026-09-01T00:00:00Z"));
    await ex.recordExport(file.id, "pdf", new Date("2026-09-02T00:00:00Z"));
    await ex.recordExport(file.id, "json_age", new Date("2026-08-01T00:00:00Z"));
    assert.deepEqual(await ex.lastExport(file.id), { format: "pdf", createdAt: new Date("2026-09-02T00:00:00Z") });
    const cols = await client.execute("select name from pragma_table_info('export_events')");
    assert.deepEqual(
      cols.rows.map((r) => r.name),
      ["id", "household_file_id", "format", "created_at"],
    );
    await ex.recordExport(file.id, "json");
    const rows = await db.select().from(schema.exportEvents);
    assert.equal(rows.filter((r) => r.householdFileId === file.id).length, 4);
  });

  it("breaks same-second ties by insert order", async () => {
    const file = await makeUser("ties@ex.com");
    const at = new Date("2026-09-03T00:00:00Z");
    for (const format of ["json_age", "pdf", "json"] as const) {
      await ex.recordExport(file.id, format, at);
      assert.equal((await ex.lastExport(file.id))?.format, format);
    }
  });

  it("names files by export date and labels formats", () => {
    assert.equal(ex.exportFileName("2026-09-29T23:59:59.000Z", "pdf"), "family-emergency-file-2026-09-29.pdf");
    assert.deepEqual(ex.EXPORT_FORMAT_LABEL, { pdf: "PDF", json: "JSON", json_age: "encrypted JSON" });
  });

  it("builds no-store attachment responses", async () => {
    const res = ex.downloadResponse("{}", "application/json", "f.json");
    assert.deepEqual(Object.fromEntries(res.headers), {
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="f.json"',
    });
    assert.equal(await res.text(), "{}");
  });
});
