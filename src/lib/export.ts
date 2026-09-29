import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { ENTRY_TYPE_DEFS, readPayload } from "./entry-fields";
import { id } from "./ids";
import { findBlocked } from "./privacy-warn";
import { STATUS_LABEL, overallProgress, sectionStatus, type OverallProgress } from "./progress";
import {
  checklistItems,
  entries,
  exportEvents,
  sections,
  type ChecklistStatus,
  type EntryType,
  type ExportFormat,
  type SectionStatus,
} from "./schema";

export const EXPORT_KIND = "family-emergency-file";
export const EXPORT_VERSION = 1;
export const EXPORT_NOTICE = "Store this somewhere safe; it contains no passwords.";
/** Shown in place of a stored value that today's privacy rules would block. */
export const REDACTED = "[removed: looked like a password or full number]";

export type ExportField = { name: string; label: string; value: string };
export type ExportEntry = {
  type: EntryType;
  typeTitle: string;
  label: string;
  fields: ExportField[];
  updatedAt: string;
};
export type ExportChecklistItem = { label: string; status: ChecklistStatus };
export type ExportSection = {
  key: string;
  title: string;
  status: SectionStatus;
  statusLabel: string;
  checklist: ExportChecklistItem[];
  entries: ExportEntry[];
};
export type ExportData = {
  kind: typeof EXPORT_KIND;
  version: number;
  exportedAt: string;
  title: string;
  notice: string;
  progress: OverallProgress;
  sections: ExportSection[];
};

export type ExportRows = {
  title: string;
  sections: { id: string; sectionKey: string; title: string }[];
  checklist: { sectionId: string; label: string; status: ChecklistStatus }[];
  entries: { sectionId: string; entryType: EntryType; label: string; payloadJson: string; updatedAt: Date }[];
};

/** Belt and braces: never export a value the save rules would now reject. */
function safe(value: string) {
  return findBlocked(value) ? REDACTED : value;
}

function toExportEntry(row: ExportRows["entries"][number]): ExportEntry {
  const def = ENTRY_TYPE_DEFS[row.entryType];
  const payload = readPayload(row.entryType, row.payloadJson);
  const fields = def.fields
    .filter((f) => payload[f.name])
    .map((f) => ({ name: f.name, label: f.label.replace(/ \(optional\)$/, ""), value: safe(payload[f.name]) }));
  return { type: row.entryType, typeTitle: def.title, label: safe(row.label), fields, updatedAt: row.updatedAt.toISOString() };
}

/** Pure: shape the file's rows into the export document. */
export function buildExportData(rows: ExportRows, exportedAt: Date): ExportData {
  const out = rows.sections.map((s): ExportSection => {
    const checklist = rows.checklist
      .filter((c) => c.sectionId === s.id)
      .map(({ label, status }) => ({ label, status }));
    const list = rows.entries.filter((e) => e.sectionId === s.id).map(toExportEntry);
    const status = sectionStatus({
      items: checklist.length,
      resolved: checklist.filter((c) => c.status !== "open").length,
      entries: list.length,
    });
    return { key: s.sectionKey, title: s.title, status, statusLabel: STATUS_LABEL[status], checklist, entries: list };
  });
  return {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    title: rows.title,
    notice: EXPORT_NOTICE,
    progress: overallProgress(out.map((s) => s.status)),
    sections: out,
  };
}

/** Everything in one household file, in section and checklist order. */
export async function loadExportData(file: { id: string; title: string }, exportedAt: Date) {
  const inFile = eq(sections.householdFileId, file.id);
  const sectionRows = await db
    .select({ id: sections.id, sectionKey: sections.sectionKey, title: sections.title })
    .from(sections)
    .where(inFile)
    .orderBy(asc(sections.sortOrder));
  const checklist = await db
    .select({ sectionId: checklistItems.sectionId, label: checklistItems.label, status: checklistItems.status })
    .from(checklistItems)
    .innerJoin(sections, eq(checklistItems.sectionId, sections.id))
    .where(inFile)
    .orderBy(asc(checklistItems.sortOrder), asc(checklistItems.itemKey));
  const entryRows = await db
    .select({
      sectionId: entries.sectionId,
      entryType: entries.entryType,
      label: entries.label,
      payloadJson: entries.payloadJson,
      updatedAt: entries.updatedAt,
    })
    .from(entries)
    .innerJoin(sections, eq(entries.sectionId, sections.id))
    .where(inFile)
    .orderBy(asc(entries.createdAt), asc(entries.label), asc(entries.id));
  return buildExportData({ title: file.title, sections: sectionRows, checklist, entries: entryRows }, exportedAt);
}

/** Audit row for a download: file, format, time. Never any content. */
export async function recordExport(householdFileId: string, format: ExportFormat, at = new Date()) {
  await db.insert(exportEvents).values({ id: id(), householdFileId, format, createdAt: at });
}

export async function lastExport(householdFileId: string) {
  const [row] = await db
    .select({ format: exportEvents.format, createdAt: exportEvents.createdAt })
    .from(exportEvents)
    .where(eq(exportEvents.householdFileId, householdFileId))
    // created_at has one-second resolution; rowid breaks ties in insert order.
    .orderBy(desc(exportEvents.createdAt), desc(sql`rowid`))
    .limit(1);
  return row ?? null;
}

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  pdf: "PDF",
  json: "JSON",
  json_age: "encrypted JSON",
};

/** e.g. family-emergency-file-2026-09-29.pdf (UTC date of the export). */
export function exportFileName(exportedAt: string, ext: string) {
  return `family-emergency-file-${exportedAt.slice(0, 10)}.${ext}`;
}

/** Owner-only downloads: never cached by the browser, a proxy, or a CDN. */
export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

export function downloadResponse(body: BodyInit, contentType: string, fileName: string) {
  return new Response(body, {
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
