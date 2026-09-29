import { and, asc, eq } from "drizzle-orm";
import { db } from "./db";
import type { EntryValues } from "./entry-fields";
import { id } from "./ids";
import {
  checklistItems,
  entries,
  sections,
  type ChecklistStatus,
  type EntryType,
} from "./schema";

/**
 * Ownership model: every read or write below is scoped by a section id that
 * the caller resolved with findSection(fileId, key), where fileId comes from
 * the signed-in user's own household file. A row outside that section simply
 * does not match, so another user's ids behave exactly like unknown ids.
 */

export async function findSection(householdFileId: string, sectionKey: string) {
  const [row] = await db
    .select()
    .from(sections)
    .where(and(eq(sections.householdFileId, householdFileId), eq(sections.sectionKey, sectionKey)))
    .limit(1);
  return row ?? null;
}

export async function listChecklist(sectionId: string) {
  return db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.sectionId, sectionId))
    .orderBy(asc(checklistItems.sortOrder), asc(checklistItems.itemKey));
}

export async function setChecklistStatus(
  sectionId: string,
  itemId: string,
  status: ChecklistStatus,
) {
  const rows = await db
    .update(checklistItems)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(checklistItems.id, itemId), eq(checklistItems.sectionId, sectionId)))
    .returning({ id: checklistItems.id });
  return rows.length === 1;
}

export async function listEntries(sectionId: string) {
  return db
    .select()
    .from(entries)
    .where(eq(entries.sectionId, sectionId))
    .orderBy(asc(entries.createdAt), asc(entries.label), asc(entries.id));
}

export async function getEntry(sectionId: string, entryId: string) {
  const [row] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.sectionId, sectionId)))
    .limit(1);
  return row ?? null;
}

export async function createEntry(
  sectionId: string,
  entryType: EntryType,
  label: string,
  payload: EntryValues,
) {
  const now = new Date();
  const [row] = await db
    .insert(entries)
    .values({
      id: id(),
      sectionId,
      entryType,
      label,
      payloadJson: JSON.stringify(payload),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

/** Update only when the entry is in this section and keeps its type. */
export async function updateEntry(
  sectionId: string,
  entryId: string,
  entryType: EntryType,
  label: string,
  payload: EntryValues,
) {
  const rows = await db
    .update(entries)
    .set({ label, payloadJson: JSON.stringify(payload), updatedAt: new Date() })
    .where(
      and(eq(entries.id, entryId), eq(entries.sectionId, sectionId), eq(entries.entryType, entryType)),
    )
    .returning({ id: entries.id });
  return rows.length === 1;
}

export async function deleteEntry(sectionId: string, entryId: string) {
  const rows = await db
    .delete(entries)
    .where(and(eq(entries.id, entryId), eq(entries.sectionId, sectionId)))
    .returning({ id: entries.id });
  return rows.length === 1;
}
