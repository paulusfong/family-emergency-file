import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-hh-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;

describe("ensureHouseholdFile", async () => {
  const { client, db } = await import("./db");
  const schema = await import("./schema");
  const { applySchema } = await import("../test/apply-schema");
  const { id } = await import("./ids");
  const { ensureHouseholdFile, listSections, progressPercent } = await import("./household");

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
  });

  it("is read-only in steady state and writes only when sections are missing", async () => {
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
    } finally {
      (db as { batch: unknown }).batch = origBatch;
    }
  });

  it("progressPercent rounds complete/total and is 0 for empty or untouched", () => {
    assert.equal(progressPercent([]), 0);
    assert.equal(progressPercent([{ status: "not_started" }, { status: "in_progress" }]), 0);
    assert.equal(progressPercent([{ status: "complete" }, { status: "not_started" }]), 50);
    assert.equal(
      progressPercent([{ status: "complete" }, { status: "not_started" }, { status: "not_started" }]),
      33,
    );
    assert.equal(progressPercent([{ status: "complete" }, { status: "complete" }]), 100);
  });
});
