"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  createEntry,
  deleteEntry,
  findSection,
  setChecklistStatus,
  updateEntry,
} from "@/lib/entries";
import {
  fieldErrorSummary,
  isEntryType,
  validateEntry,
  type SaveEntryInput,
  type SaveEntryResult,
} from "@/lib/entry-fields";
import { CHECKLIST_STATUS, type ChecklistStatus } from "@/lib/schema";
import { requireHousehold } from "@/lib/session";

const NOT_FOUND: SaveEntryResult = { ok: false, status: 404, error: "That entry no longer exists." };

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function ownedSection(sectionKey: unknown) {
  const { file } = await requireHousehold();
  return findSection(file.id, text(sectionKey));
}

/**
 * Create (entryId null) or update an entry in one of the signed-in user's
 * sections. Called by the autosaving editor; returns a result instead of
 * throwing so the client can show a toast. Unknown or foreign ids are 404.
 */
export async function saveEntry(input: SaveEntryInput): Promise<SaveEntryResult> {
  const section = await ownedSection(input?.sectionKey);
  if (!section) return NOT_FOUND;
  if (!isEntryType(input.entryType)) {
    return { ok: false, status: 400, error: "Unknown entry type." };
  }
  // A blank or non-string id matches no row, so the update below returns 404.
  const entryId = input.entryId === null ? null : text(input.entryId);

  const valid = validateEntry(input.entryType, input.values);
  if (!valid.ok) {
    return {
      ok: false,
      status: 400,
      error: fieldErrorSummary(input.entryType, valid.fieldErrors),
      fieldErrors: valid.fieldErrors,
    };
  }

  try {
    if (entryId === null) {
      const row = await createEntry(section.id, input.entryType, valid.label, valid.payload);
      return { ok: true, entryId: row.id };
    }
    const updated = await updateEntry(section.id, entryId, input.entryType, valid.label, valid.payload);
    return updated ? { ok: true, entryId } : NOT_FOUND;
  } catch (err) {
    console.error("entry save failed", err);
    return { ok: false, status: 500, error: "Couldn't save right now. Please retry." };
  }
}

export async function removeEntry(formData: FormData) {
  const section = await ownedSection(formData.get("sectionKey"));
  if (!section) notFound();
  const deleted = await deleteEntry(section.id, text(formData.get("entryId")));
  if (!deleted) notFound();
  redirect(`/app/sections/${section.sectionKey}?deleted=1`);
}

export async function setChecklistItem(formData: FormData) {
  const section = await ownedSection(formData.get("sectionKey"));
  if (!section) notFound();
  const status = text(formData.get("status"));
  if (!(CHECKLIST_STATUS as readonly string[]).includes(status)) notFound();
  const updated = await setChecklistStatus(
    section.id,
    text(formData.get("itemId")),
    status as ChecklistStatus,
  );
  if (!updated) notFound();
  revalidatePath(`/app/sections/${section.sectionKey}`);
}
