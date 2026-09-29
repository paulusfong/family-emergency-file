import { asc, count, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { id } from "./ids";
import { householdFiles, SECTION_DEFS, sections } from "./schema";

async function findFile(userId: string) {
  const [file] = await db
    .select()
    .from(householdFiles)
    .where(eq(householdFiles.userId, userId))
    .limit(1);
  return file;
}

async function sectionCount(householdFileId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(sections)
    .where(eq(sections.householdFileId, householdFileId));
  return row.n;
}

/**
 * Insert every S1–S12 row for the user's file, skipping keys that already exist.
 * Resolves the file id in SQL so it works whichever request created the file.
 */
function seedSectionsSql(userId: string) {
  const rows = SECTION_DEFS.map(
    (d) => sql`(${id()}, ${d.key}, ${d.title}, ${d.sortOrder})`,
  );
  return sql`INSERT INTO ${sections}
    (id, household_file_id, section_key, title, status, sort_order, created_at, updated_at)
    SELECT v.column1, hf.id, v.column2, v.column3, 'not_started', v.column4, unixepoch(), unixepoch()
    FROM ${householdFiles} hf, (VALUES ${sql.join(rows, sql`, `)}) v
    WHERE hf.user_id = ${userId}
    ON CONFLICT (household_file_id, section_key) DO NOTHING`;
}

/**
 * Ensure the user has exactly one household_file with all twelve sections.
 *
 * Race-safe: concurrent first logins each run one atomic batch (a single libSQL
 * transaction) of "insert file ON CONFLICT DO NOTHING" + "insert missing
 * sections ON CONFLICT DO NOTHING", then re-select the winning row. The same
 * batch backfills a file that is missing sections. Steady state is read-only.
 */
export async function ensureHouseholdFile(userId: string) {
  const existing = await findFile(userId);
  if (existing && (await sectionCount(existing.id)) >= SECTION_DEFS.length) {
    return existing;
  }

  const now = new Date();
  await db.batch([
    db
      .insert(householdFiles)
      .values({
        id: id(),
        userId,
        title: "Family Emergency File",
        createdAt: now,
        updatedAt: now,
        lastReviewedAt: null,
      })
      .onConflictDoNothing({ target: householdFiles.userId }),
    db.run(seedSectionsSql(userId)),
  ]);

  return (await findFile(userId))!;
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
