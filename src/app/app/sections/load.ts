import { notFound } from "next/navigation";
import { findSection } from "@/lib/entries";
import { findSectionDef } from "@/lib/sections";
import { requireHousehold } from "@/lib/session";

/** Resolve a section key inside the signed-in user's own file, or 404. */
export async function loadOwnedSection(key: string) {
  const { file } = await requireHousehold();
  const def = findSectionDef(key);
  if (!def) notFound();
  const section = await findSection(file.id, def.key);
  if (!section) notFound();
  return { file, def, section };
}
