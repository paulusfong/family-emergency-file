import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-entries-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;

describe("entries data layer", async () => {
  const { client, db } = await import("./db");
  const schema = await import("./schema");
  const { applySchema } = await import("../test/apply-schema");
  const { id } = await import("./ids");
  const { ensureHouseholdFile } = await import("./household");
  const entries = await import("./entries");

  async function owner(label: string) {
    const userId = id();
    const now = new Date();
    await db.insert(schema.user).values({
      id: userId,
      name: label,
      email: `${label}-${userId}@ex.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    const file = await ensureHouseholdFile(userId);
    return { userId, file };
  }

  let a: Awaited<ReturnType<typeof owner>>;
  let b: Awaited<ReturnType<typeof owner>>;

  before(async () => {
    await applySchema(client);
    a = await owner("alice");
    b = await owner("bob");
  });

  it("finds a section only inside the given file", async () => {
    const s3 = await entries.findSection(a.file.id, "S3");
    assert.ok(s3);
    assert.equal(s3.sectionKey, "S3");
    assert.equal(s3.householdFileId, a.file.id);
    const other = await entries.findSection(b.file.id, "S3");
    assert.notEqual(other!.id, s3.id);
    assert.equal(await entries.findSection(a.file.id, "S99"), null);
    assert.equal(await entries.findSection("no-such-file", "S3"), null);
  });

  it("round-trips create, read, update, delete", async () => {
    const s3 = (await entries.findSection(a.file.id, "S3"))!;
    const created = await entries.createEntry(s3.id, "account", "Joint checking", {
      institution: "Example Bank",
      last4: "0000",
    });
    assert.equal(created.sectionId, s3.id);
    assert.equal(created.entryType, "account");
    assert.equal(created.label, "Joint checking");
    assert.deepEqual(JSON.parse(created.payloadJson), { institution: "Example Bank", last4: "0000" });
    assert.ok(created.createdAt instanceof Date);

    const got = await entries.getEntry(s3.id, created.id);
    assert.deepEqual(got, created);

    const beforeUpdate = created.updatedAt.getTime();
    assert.equal(
      await entries.updateEntry(s3.id, created.id, "account", "Joint checking (renamed)", { institution: "Example CU" }),
      true,
    );
    const updated = (await entries.getEntry(s3.id, created.id))!;
    assert.equal(updated.label, "Joint checking (renamed)");
    assert.deepEqual(JSON.parse(updated.payloadJson), { institution: "Example CU" });
    assert.ok(updated.updatedAt.getTime() >= beforeUpdate);
    assert.equal(updated.createdAt.getTime(), created.createdAt.getTime());

    assert.equal(await entries.deleteEntry(s3.id, created.id), true);
    assert.equal(await entries.getEntry(s3.id, created.id), null);
    assert.equal(await entries.deleteEntry(s3.id, created.id), false);
  });

  it("refuses to change an entry's type on update", async () => {
    const s6 = (await entries.findSection(a.file.id, "S6"))!;
    const row = await entries.createEntry(s6.id, "policy", "Term life", {});
    assert.equal(await entries.updateEntry(s6.id, row.id, "account", "Changed", {}), false);
    assert.equal((await entries.getEntry(s6.id, row.id))!.label, "Term life");
  });

  it("isolates entries between users and between sections", async () => {
    const aS3 = (await entries.findSection(a.file.id, "S3"))!;
    const aS4 = (await entries.findSection(a.file.id, "S4"))!;
    const bS3 = (await entries.findSection(b.file.id, "S3"))!;
    const mine = await entries.createEntry(aS3.id, "account", "Alice savings", { last4: "0000" });

    assert.equal(await entries.getEntry(bS3.id, mine.id), null);
    assert.equal(await entries.getEntry(aS4.id, mine.id), null);
    assert.equal(await entries.updateEntry(bS3.id, mine.id, "account", "Hijacked", {}), false);
    assert.equal(await entries.deleteEntry(bS3.id, mine.id), false);
    assert.deepEqual(await entries.listEntries(bS3.id), []);

    const still = (await entries.getEntry(aS3.id, mine.id))!;
    assert.equal(still.label, "Alice savings");
  });

  it("lists a section's entries oldest first, then by label", async () => {
    const s11 = (await entries.findSection(a.file.id, "S11"))!;
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-02-01T00:00:00Z");
    const rows = [
      { id: id(), label: "Will", createdAt: t1 },
      { id: id(), label: "Deed", createdAt: t0 },
      { id: id(), label: "Birth certificate", createdAt: t1 },
    ];
    for (const r of rows) {
      await db.insert(schema.entries).values({
        ...r,
        sectionId: s11.id,
        entryType: "document_location",
        payloadJson: "{}",
        updatedAt: r.createdAt,
      });
    }
    const listed = await entries.listEntries(s11.id);
    assert.deepEqual(listed.map((r) => r.label), ["Deed", "Birth certificate", "Will"]);
  });

  it("orders entries with identical time and label by id", async () => {
    const s12 = (await entries.findSection(a.file.id, "S12"))!;
    const t = new Date("2026-03-01T00:00:00Z");
    const ids = ["b-id", "a-id", "c-id"];
    for (const rowId of ids) {
      await db.insert(schema.entries).values({
        id: rowId,
        sectionId: s12.id,
        entryType: "note",
        label: "Same",
        payloadJson: "{}",
        createdAt: t,
        updatedAt: t,
      });
    }
    assert.deepEqual((await entries.listEntries(s12.id)).map((r) => r.id), ["a-id", "b-id", "c-id"]);
  });

  it("lists checklist items in seed order and updates status within the section only", async () => {
    const aS3 = (await entries.findSection(a.file.id, "S3"))!;
    const bS3 = (await entries.findSection(b.file.id, "S3"))!;
    const items = await entries.listChecklist(aS3.id);
    assert.deepEqual(items.map((i) => i.sortOrder), items.map((_, i) => i + 1));
    assert.equal(items[0].itemKey, "checking-savings");
    assert.ok(items.every((i) => i.status === "open"));

    assert.equal(await entries.setChecklistStatus(aS3.id, items[0].id, "done"), true);
    assert.equal(await entries.setChecklistStatus(bS3.id, items[1].id, "done"), false);
    assert.equal(await entries.setChecklistStatus(aS3.id, "missing", "done"), false);

    const [row] = await db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.id, items[0].id));
    assert.equal(row.status, "done");
    assert.ok(row.updatedAt.getTime() >= items[0].updatedAt.getTime());
    const after = await entries.listChecklist(aS3.id);
    assert.equal(after[1].status, "open");
  });

  it("orders checklist items with equal sort order by key", async () => {
    const s9 = (await entries.findSection(a.file.id, "S9"))!;
    await db.update(schema.checklistItems).set({ sortOrder: 1 }).where(eq(schema.checklistItems.sectionId, s9.id));
    const keys = (await entries.listChecklist(s9.id)).map((i) => i.itemKey);
    assert.deepEqual(keys, [...keys].sort());
  });

  it("cascades entries and checklist items when a section is deleted", async () => {
    const s7 = (await entries.findSection(b.file.id, "S7"))!;
    await entries.createEntry(s7.id, "note", "Pension notes", { notes: "Example" });
    await db.delete(schema.sections).where(eq(schema.sections.id, s7.id));
    assert.deepEqual(await entries.listEntries(s7.id), []);
    assert.deepEqual(await entries.listChecklist(s7.id), []);
  });
});
