import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { id } from "./ids";
import { checklistItems, householdFiles, SECTION_DEFS, sections, type SectionStatus } from "./schema";
import { sectionStatus, type SectionCounts } from "./progress";
import { CHECKLIST_SEED_TOTAL, checklistSeedRows } from "./sections";

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

async function checklistCount(householdFileId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(checklistItems)
    .innerJoin(sections, eq(sections.id, checklistItems.sectionId))
    .where(eq(sections.householdFileId, householdFileId));
  return row.n;
}

/**
 * Insert every starter checklist item for the user's sections, skipping items
 * that already exist. Resolves section ids in SQL, like seedSectionsSql.
 */
function seedChecklistSql(userId: string) {
  const rows = checklistSeedRows().map(
    (r) => sql`(${id()}, ${r.sectionKey}, ${r.itemKey}, ${r.label}, ${r.sortOrder})`,
  );
  return sql`INSERT INTO ${checklistItems}
    (id, section_id, item_key, label, status, sort_order, created_at, updated_at)
    SELECT v.column1, s.id, v.column3, v.column4, 'open', v.column5, unixepoch(), unixepoch()
    FROM ${sections} s
    JOIN ${householdFiles} hf ON hf.id = s.household_file_id
    JOIN (VALUES ${sql.join(rows, sql`, `)}) v ON v.column2 = s.section_key
    WHERE hf.user_id = ${userId}
    ON CONFLICT (section_id, item_key) DO NOTHING`;
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
 * Ensure the user has exactly one household_file with all twelve sections and
 * their starter checklist items.
 *
 * Race-safe: concurrent first logins each run one atomic batch (a single libSQL
 * transaction) of "insert file ON CONFLICT DO NOTHING" + "insert missing
 * sections ON CONFLICT DO NOTHING" + "insert missing checklist items ON
 * CONFLICT DO NOTHING", then re-select the winning row. The same batch
 * backfills a file created before a section or item existed. Steady state is
 * read-only.
 */
export async function ensureHouseholdFile(userId: string) {
  const existing = await findFile(userId);
  if (
    existing &&
    (await sectionCount(existing.id)) >= SECTION_DEFS.length &&
    (await checklistCount(existing.id)) >= CHECKLIST_SEED_TOTAL
  ) {
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
    db.run(seedChecklistSql(userId)),
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

export type SectionProgress = {
  id: string;
  sectionKey: string;
  title: string;
  status: SectionStatus;
} & SectionCounts;

/**
 * Every section of the file with its checklist and entry counts and the
 * derived status, in one query. Status is computed on read, never stored, so
 * it cannot drift from the checklist and entries it is based on.
 */
export async function listSectionProgress(householdFileId: string): Promise<SectionProgress[]> {
  const rows = await db
    .select({
      id: sections.id,
      sectionKey: sections.sectionKey,
      title: sections.title,
      // Correlated subqueries use explicit aliases: drizzle renders column
      // refs in select fields unqualified, which would bind to the inner table.
      items: sql<number>`(select count(*) from checklist_items ci where ci.section_id = "sections"."id")`.mapWith(Number),
      resolved: sql<number>`(select count(*) from checklist_items ci where ci.section_id = "sections"."id" and ci.status <> 'open')`.mapWith(Number),
      entries: sql<number>`(select count(*) from entries e where e.section_id = "sections"."id")`.mapWith(Number),
    })
    .from(sections)
    .where(eq(sections.householdFileId, householdFileId))
    .orderBy(asc(sections.sortOrder));
  return rows.map((r) => ({ ...r, status: sectionStatus(r) }));
}

/** Record that the owner dismissed the first-run privacy sheet (idempotent). */
export async function acknowledgePrivacy(householdFileId: string, at = new Date()) {
  await db
    .update(householdFiles)
    .set({ privacyAckAt: at })
    .where(and(eq(householdFiles.id, householdFileId), isNull(householdFiles.privacyAckAt)));
}
