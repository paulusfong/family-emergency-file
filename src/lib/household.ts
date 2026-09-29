import { asc, eq } from "drizzle-orm";
import { db } from "./db";
import { id } from "./ids";
import { householdFiles, SECTION_DEFS, sections } from "./schema";

/**
 * Ensure the user has exactly one household_file and twelve empty section rows.
 * Idempotent: a second call returns the existing file without duplicating rows.
 */
export async function ensureHouseholdFile(userId: string) {
  const existing = await db
    .select()
    .from(householdFiles)
    .where(eq(householdFiles.userId, userId))
    .limit(1);

  if (existing[0]) {
    await ensureSections(existing[0].id);
    return existing[0];
  }

  const fileId = id();
  const now = new Date();
  await db.insert(householdFiles).values({
    id: fileId,
    userId,
    title: "Family Emergency File",
    createdAt: now,
    updatedAt: now,
    lastReviewedAt: null,
  });

  await seedSections(fileId);

  const created = await db
    .select()
    .from(householdFiles)
    .where(eq(householdFiles.id, fileId))
    .limit(1);

  return created[0]!;
}

async function seedSections(householdFileId: string) {
  const now = new Date();
  await db.insert(sections).values(
    SECTION_DEFS.map((def) => ({
      id: id(),
      householdFileId,
      sectionKey: def.key,
      title: def.title,
      status: "not_started" as const,
      sortOrder: def.sortOrder,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

/** Backfill missing section rows if a file was created without them. */
async function ensureSections(householdFileId: string) {
  const existing = await db
    .select()
    .from(sections)
    .where(eq(sections.householdFileId, householdFileId));

  if (existing.length >= SECTION_DEFS.length) return;

  const have = new Set(existing.map((s) => s.sectionKey));
  const missing = SECTION_DEFS.filter((d) => !have.has(d.key));

  const now = new Date();
  await db.insert(sections).values(
    missing.map((def) => ({
      id: id(),
      householdFileId,
      sectionKey: def.key,
      title: def.title,
      status: "not_started" as const,
      sortOrder: def.sortOrder,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

export async function listSections(householdFileId: string) {
  return db
    .select()
    .from(sections)
    .where(eq(sections.householdFileId, householdFileId))
    .orderBy(asc(sections.sortOrder));
}

/** Progress percent from section statuses (0 when all not_started). */
export function progressPercent(rows: { status: string }[]): number {
  if (rows.length === 0) return 0;
  const complete = rows.filter((r) => r.status === "complete").length;
  return Math.round((complete / rows.length) * 100);
}
