import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-hh-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;

describe("ensureHouseholdFile", async () => {
  const { client, db } = await import("./db");
  const schema = await import("./schema");
  const { applySchema } = await import("../test/apply-schema");
  const { id } = await import("./ids");
  const { acknowledgePrivacy, ensureHouseholdFile, listSectionProgress, listSections } = await import("./household");
  const { CHECKLIST_SEED_TOTAL, SECTION_CHECKLISTS } = await import("./sections");

  async function makeUser(label: string) {
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
    return userId;
  }

  async function filesFor(userId: string) {
    return db.select().from(schema.householdFiles).where(eq(schema.householdFiles.userId, userId));
  }

  async function itemsFor(fileId: string) {
    return db
      .select({
        id: schema.checklistItems.id,
        sectionKey: schema.sections.sectionKey,
        itemKey: schema.checklistItems.itemKey,
        label: schema.checklistItems.label,
        status: schema.checklistItems.status,
        sortOrder: schema.checklistItems.sortOrder,
      })
      .from(schema.checklistItems)
      .innerJoin(schema.sections, eq(schema.sections.id, schema.checklistItems.sectionId))
      .where(eq(schema.sections.householdFileId, fileId))
      .orderBy(schema.sections.sortOrder, schema.checklistItems.sortOrder);
  }

  function expectedItems() {
    return schema.SECTION_DEFS.flatMap((d) =>
      SECTION_CHECKLISTS[d.key].map((item, i) => [d.key, item.key, item.label, "open", i + 1]),
    );
  }

  before(async () => {
    await applySchema(client);
  });

  it("creates exactly one household_file and twelve not_started sections", async () => {
    const userId = await makeUser("owner");
    const file = await ensureHouseholdFile(userId);
    assert.equal(file.userId, userId);
    assert.equal(file.title, "Family Emergency File");
    assert.equal(file.lastReviewedAt, null);
    assert.equal((await filesFor(userId)).length, 1);

    const secs = await listSections(file.id);
    assert.deepEqual(
      secs.map((s) => [s.sectionKey, s.title, s.status, s.sortOrder]),
      schema.SECTION_DEFS.map((d) => [d.key, d.title, "not_started", d.sortOrder]),
    );
    assert.equal(new Set(secs.map((s) => s.id)).size, 12);
    assert.ok(secs.every((s) => s.createdAt instanceof Date && s.createdAt.getTime() > 0));
  });

  it("seeds every section's starter checklist items, open and in order", async () => {
    const userId = await makeUser("items");
    const file = await ensureHouseholdFile(userId);
    const items = await itemsFor(file.id);
    assert.deepEqual(
      items.map((r) => [r.sectionKey, r.itemKey, r.label, r.status, r.sortOrder]),
      expectedItems(),
    );
    assert.equal(items.length, CHECKLIST_SEED_TOTAL);
    assert.equal(new Set(items.map((r) => r.id)).size, CHECKLIST_SEED_TOTAL);
  });

  it("backfills checklist items for a file created before checklists existed", async () => {
    const userId = await makeUser("pre-checklist");
    const file = await ensureHouseholdFile(userId);
    const secs = await listSections(file.id);
    const [s3] = secs.filter((s) => s.sectionKey === "S3");
    await db
      .delete(schema.checklistItems)
      .where(inArray(schema.checklistItems.sectionId, secs.map((s) => s.id)));
    const now = new Date();
    const keptId = id();
    await db.insert(schema.checklistItems).values({
      id: keptId,
      sectionId: s3.id,
      itemKey: "checking-savings",
      label: "Checking and savings accounts",
      status: "done",
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    });

    await ensureHouseholdFile(userId);
    const items = await itemsFor(file.id);
    assert.equal(items.length, CHECKLIST_SEED_TOTAL);
    const kept = items.find((r) => r.id === keptId)!;
    assert.equal(kept.status, "done");
    assert.equal(items.filter((r) => r.sectionKey === "S3" && r.itemKey === "checking-savings").length, 1);
  });

  it("is idempotent on a second call and does not touch sections", async () => {
    const userId = await makeUser("again");
    const first = await ensureHouseholdFile(userId);
    const before = await listSections(first.id);
    const second = await ensureHouseholdFile(userId);
    assert.equal(second.id, first.id);
    assert.equal((await filesFor(userId)).length, 1);
    assert.deepEqual(
      (await listSections(first.id)).map((s) => s.id),
      before.map((s) => s.id),
    );
  });

  it("backfills missing sections on a sparse file without duplicating", async () => {
    const userId = await makeUser("sparse");
    const fileId = id();
    const now = new Date();
    await db.insert(schema.householdFiles).values({ id: fileId, userId, createdAt: now, updatedAt: now });
    const keepId = id();
    await db.insert(schema.sections).values({
      id: keepId,
      householdFileId: fileId,
      sectionKey: "S1",
      title: "Household snapshot",
      status: "in_progress",
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    });

    const file = await ensureHouseholdFile(userId);
    assert.equal(file.id, fileId);
    const secs = await listSections(fileId);
    assert.equal(secs.length, 12);
    assert.equal(secs[0].id, keepId);
    assert.equal(secs[0].status, "in_progress");
  });

  it("restores a missing section even when extra checklist rows keep the item count high", async () => {
    const userId = await makeUser("extra-items");
    const file = await ensureHouseholdFile(userId);
    const secs = await listSections(file.id);
    const s12 = secs.find((s) => s.sectionKey === "S12")!;
    await db.delete(schema.checklistItems).where(eq(schema.checklistItems.sectionId, s12.id));
    await db.delete(schema.sections).where(eq(schema.sections.id, s12.id));
    const now = new Date();
    await db.insert(schema.checklistItems).values(
      Array.from({ length: CHECKLIST_SEED_TOTAL }, (_, i) => ({
        id: id(),
        sectionId: secs[0].id,
        itemKey: `extra-${i}`,
        label: `Extra ${i}`,
        sortOrder: 100 + i,
        createdAt: now,
        updatedAt: now,
      })),
    );
    assert.equal((await listSections(file.id)).length, 11);

    await ensureHouseholdFile(userId);
    const after = await listSections(file.id);
    assert.equal(after.length, 12);
    assert.ok(after.some((s) => s.sectionKey === "S12"));
  });

  it("survives five concurrent first logins: one file, twelve sections, no errors", async () => {
    const userId = await makeUser("race");
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => ensureHouseholdFile(userId)),
    );
    const rejected = results.filter((r) => r.status === "rejected");
    assert.deepEqual(rejected, []);
    const ids = new Set(
      results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id),
    );
    assert.equal(ids.size, 1);
    const files = await filesFor(userId);
    assert.equal(files.length, 1);
    assert.equal((await listSections(files[0].id)).length, 12);
    assert.equal((await itemsFor(files[0].id)).length, CHECKLIST_SEED_TOTAL);
  });

  it("survives concurrent backfills of the same sparse file", async () => {
    const userId = await makeUser("race-sparse");
    const fileId = id();
    const now = new Date();
    await db.insert(schema.householdFiles).values({ id: fileId, userId, createdAt: now, updatedAt: now });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => ensureHouseholdFile(userId)),
    );
    assert.deepEqual(results.filter((r) => r.status === "rejected"), []);
    assert.equal((await listSections(fileId)).length, 12);
    assert.equal((await itemsFor(fileId)).length, CHECKLIST_SEED_TOTAL);
  });

  it("survives concurrent checklist backfills of a pre-checklist file", async () => {
    const userId = await makeUser("race-items");
    const file = await ensureHouseholdFile(userId);
    const sectionIds = (await listSections(file.id)).map((s) => s.id);
    await db.delete(schema.checklistItems).where(inArray(schema.checklistItems.sectionId, sectionIds));
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => ensureHouseholdFile(userId)),
    );
    assert.deepEqual(results.filter((r) => r.status === "rejected"), []);
    assert.equal((await itemsFor(file.id)).length, CHECKLIST_SEED_TOTAL);
  });

  it("is read-only in steady state and writes only when sections or items are missing", async () => {
    const userId = await makeUser("steady");
    await ensureHouseholdFile(userId);
    const origBatch = db.batch.bind(db);
    let batches = 0;
    (db as { batch: unknown }).batch = (...args: Parameters<typeof db.batch>) => {
      batches++;
      return origBatch(...args);
    };
    try {
      await ensureHouseholdFile(userId);
      assert.equal(batches, 0);
      const [file] = await filesFor(userId);
      await db
        .delete(schema.sections)
        .where(eq(schema.sections.householdFileId, file.id));
      await ensureHouseholdFile(userId);
      assert.equal(batches, 1);
      assert.equal((await listSections(file.id)).length, 12);

      const [anyItem] = await itemsFor(file.id);
      await db.delete(schema.checklistItems).where(eq(schema.checklistItems.id, anyItem.id));
      await ensureHouseholdFile(userId);
      assert.equal(batches, 2);
      assert.equal((await itemsFor(file.id)).length, CHECKLIST_SEED_TOTAL);
      await ensureHouseholdFile(userId);
      assert.equal(batches, 2);
    } finally {
      (db as { batch: unknown }).batch = origBatch;
    }
  });

  it("derives each section's status from its checklist and entries, in order", async () => {
    const userId = await makeUser("progress");
    const file = await ensureHouseholdFile(userId);
    const secs = await listSections(file.id);
    const byKey = Object.fromEntries(secs.map((s) => [s.sectionKey, s.id]));
    const now = new Date();
    // S2: every item resolved (mix of done and skipped) -> complete.
    await db.update(schema.checklistItems).set({ status: "done" }).where(eq(schema.checklistItems.sectionId, byKey.S2));
    const [firstS2] = await db
      .select({ id: schema.checklistItems.id })
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.sectionId, byKey.S2))
      .limit(1);
    await db.update(schema.checklistItems).set({ status: "skipped" }).where(eq(schema.checklistItems.id, firstS2.id));
    // S3: one item done -> in progress. S5: one entry, nothing checked -> in progress.
    const [firstS3] = await db
      .select({ id: schema.checklistItems.id })
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.sectionId, byKey.S3))
      .limit(1);
    await db.update(schema.checklistItems).set({ status: "done" }).where(eq(schema.checklistItems.id, firstS3.id));
    await db.insert(schema.entries).values([
      { id: id(), sectionId: byKey.S5, entryType: "account", label: "Example 401(k)", createdAt: now, updatedAt: now },
      { id: id(), sectionId: byKey.S5, entryType: "note", label: "Rollover note", createdAt: now, updatedAt: now },
    ]);

    const rows = await listSectionProgress(file.id);
    assert.deepEqual(
      rows.map((r) => r.sectionKey),
      secs.map((s) => s.sectionKey),
    );
    const got = Object.fromEntries(rows.map((r) => [r.sectionKey, r]));
    const s2Items = SECTION_CHECKLISTS.S2.length;
    assert.deepEqual(
      { ...got.S2, id: undefined },
      { id: undefined, sectionKey: "S2", title: "Key contacts", items: s2Items, resolved: s2Items, entries: 0, status: "complete" },
    );
    assert.deepEqual([got.S3.resolved, got.S3.entries, got.S3.status], [1, 0, "in_progress"]);
    assert.deepEqual([got.S5.resolved, got.S5.entries, got.S5.status], [0, 2, "in_progress"]);
    assert.deepEqual([got.S1.items, got.S1.resolved, got.S1.entries, got.S1.status], [
      SECTION_CHECKLISTS.S1.length,
      0,
      0,
      "not_started",
    ]);
    assert.equal(typeof got.S1.items, "number");
    assert.equal(rows.filter((r) => r.status === "complete").length, 1);
  });

  it("counts only the file's own sections", async () => {
    const a = await ensureHouseholdFile(await makeUser("progress-a"));
    const b = await ensureHouseholdFile(await makeUser("progress-b"));
    const [bS1] = (await listSections(b.id)).filter((s) => s.sectionKey === "S1");
    await db.update(schema.checklistItems).set({ status: "done" }).where(eq(schema.checklistItems.sectionId, bS1.id));
    const rowsA = await listSectionProgress(a.id);
    assert.equal(rowsA.length, 12);
    assert.ok(rowsA.every((r) => r.status === "not_started"));
    assert.equal((await listSectionProgress(b.id))[0].status, "complete");
  });

  it("acknowledgePrivacy stamps the file once and keeps the first time", async () => {
    const file = await ensureHouseholdFile(await makeUser("ack"));
    assert.equal(file.privacyAckAt, null);
    const first = new Date("2026-09-29T09:00:00Z");
    await acknowledgePrivacy(file.id, first);
    await acknowledgePrivacy(file.id, new Date("2026-10-01T09:00:00Z"));
    const [row] = await filesFor(file.userId);
    assert.equal(row.privacyAckAt?.toISOString(), first.toISOString());
  });

  it("acknowledgePrivacy defaults to now and leaves other files alone", async () => {
    const mine = await ensureHouseholdFile(await makeUser("ack-now"));
    const other = await ensureHouseholdFile(await makeUser("ack-other"));
    const before = Date.now() - 1000;
    await acknowledgePrivacy(mine.id);
    const [row] = await filesFor(mine.userId);
    assert.ok(row.privacyAckAt!.getTime() >= before);
    assert.equal((await filesFor(other.userId))[0].privacyAckAt, null);
  });
});
