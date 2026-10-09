import { eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
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

export const CONFIRM_WORD = "DELETE";

/**
 * Hard-delete a user and everything they own in one batch (one transaction):
 * children before parents, so it does not depend on foreign-key cascades.
 * Pending magic-link rows are matched by the email inside their JSON value.
 */
export async function deleteUserData(userId: string) {
  const files = db.select({ id: householdFiles.id }).from(householdFiles).where(eq(householdFiles.userId, userId));
  const fileSections = db.select({ id: sections.id }).from(sections).where(inArray(sections.householdFileId, files));
  await db.batch([
    db.delete(exportEvents).where(inArray(exportEvents.householdFileId, files)),
    db.delete(entries).where(inArray(entries.sectionId, fileSections)),
    db.delete(checklistItems).where(inArray(checklistItems.sectionId, fileSections)),
    db.delete(sections).where(inArray(sections.householdFileId, files)),
    db.delete(householdFiles).where(eq(householdFiles.userId, userId)),
    db.delete(session).where(eq(session.userId, userId)),
    db.delete(account).where(eq(account.userId, userId)),
    db
      .delete(verification)
      .where(
        sql`(case when json_valid(${verification.value}) then json_extract(${verification.value}, '$.email') end) in (select ${user.email} from ${user} where ${user.id} = ${userId})`,
      ),
    db.delete(user).where(eq(user.id, userId)),
  ]);
}
