import { SECTION_DEFS, type EntryType } from "./schema";
import { SECTION_CHECKLISTS } from "./section-content";

export type SectionKey = (typeof SECTION_DEFS)[number]["key"];

export type { ChecklistSeed } from "./section-content";
export { ACCESS_PLAN_NOTE, SECTION_CHECKLISTS, SECTION_PURPOSE } from "./section-content";
/** The entry shape each section suggests first; every type is allowed everywhere. */
export const SECTION_PRIMARY_TYPE: Record<SectionKey, EntryType> = {
  S1: "note",
  S2: "contact",
  S3: "account",
  S4: "account",
  S5: "account",
  S6: "policy",
  S7: "account",
  S8: "account",
  S9: "document_location",
  S10: "access_plan",
  S11: "document_location",
  S12: "note",
};

export function checklistSeedRows() {
  return SECTION_DEFS.flatMap((d) =>
    SECTION_CHECKLISTS[d.key].map((item, i) => ({
      sectionKey: d.key,
      itemKey: item.key,
      label: item.label,
      sortOrder: i + 1,
    })),
  );
}

export const CHECKLIST_SEED_TOTAL = checklistSeedRows().length;

export function findSectionDef(key: string) {
  return SECTION_DEFS.find((d) => d.key === key);
}
