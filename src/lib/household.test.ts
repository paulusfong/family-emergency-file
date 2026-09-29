import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-hh-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;
process.env.BETTER_AUTH_SECRET = "s".repeat(32);

describe("ensureHouseholdFile", async () => {
  const { client, db } = await import("./db");
  const schema = await import("./schema");
  const { applySchema } = await import("../test/apply-schema");
  const { id } = await import("./ids");
  const { ensureHouseholdFile, listSections, progressPercent } = await import("./household");

  const userId = id();
  const partialUserId = id();

  before(async () => {
    await applySchema(client);
    const now = new Date();
    await db.insert(schema.user).values([
      {
        id: userId,
        name: "Owner",
        email: "owner@ex.com",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: partialUserId,
        name: "Partial",
        email: "partial@ex.com",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  it("creates exactly one household_file and twelve sections", async () => {
    const file = await ensureHouseholdFile(userId);
    assert.ok(file.id);
    assert.equal(file.userId, userId);
    assert.equal(file.title, "Family Emergency File");

    const files = await db
      .select()
      .from(schema.householdFiles)
      .where(eq(schema.householdFiles.userId, userId));
    assert.equal(files.length, 1);

    const secs = await listSections(file.id);
    assert.equal(secs.length, 12);
    assert.ok(secs.every((s) => s.status === "not_started"));
    assert.equal(secs[0].sectionKey, "S1");
    assert.equal(secs[11].sectionKey, "S12");
  });

  it("is idempotent on a second call", async () => {
    const first = await ensureHouseholdFile(userId);
    const second = await ensureHouseholdFile(userId);
    assert.equal(first.id, second.id);

    const files = await db
      .select()
      .from(schema.householdFiles)
      .where(eq(schema.householdFiles.userId, userId));
    assert.equal(files.length, 1);

    const secs = await listSections(first.id);
    assert.equal(secs.length, 12);
  });

  it("backfills missing sections on an existing sparse file", async () => {
    const fileId = id();
    const now = new Date();
    await db.insert(schema.householdFiles).values({
      id: fileId,
      userId: partialUserId,
      title: "Family Emergency File",
      createdAt: now,
      updatedAt: now,
      lastReviewedAt: null,
    });
    await db.insert(schema.sections).values({
      id: id(),
      householdFileId: fileId,
      sectionKey: "S1",
      title: "Household snapshot",
      status: "not_started",
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    });

    const file = await ensureHouseholdFile(partialUserId);
    assert.equal(file.id, fileId);
    const secs = await listSections(fileId);
    assert.equal(secs.length, 12);
  });

  it("progressPercent is 0 when all not_started", () => {
    assert.equal(
      progressPercent([{ status: "not_started" }, { status: "not_started" }]),
      0,
    );
    assert.equal(progressPercent([]), 0);
    assert.equal(
      progressPercent([{ status: "complete" }, { status: "not_started" }]),
      50,
    );
    assert.equal(
      progressPercent([
        { status: "complete" },
        { status: "complete" },
        { status: "complete" },
        { status: "complete" },
      ]),
      100,
    );
  });
});
