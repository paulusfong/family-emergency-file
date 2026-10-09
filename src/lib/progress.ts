import type { SectionStatus } from "./schema";

/** What a section's status is derived from. */
export type SectionCounts = {
  /** Checklist items in the section. */
  items: number;
  /** Checklist items marked Done or Skipped. */
  resolved: number;
  /** Entries recorded in the section. */
  entries: number;
};

export const STATUS_LABEL: Record<SectionStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
};

/**
 * complete: every checklist item is Done or Skipped (Skip means "doesn't
 * apply to us"). in_progress: anything recorded or checked off short of that.
 * Entries alone never complete a section; the checklist is the confirmation.
 */
export function sectionStatus({ items, resolved, entries }: SectionCounts): SectionStatus {
  if (items > 0 && resolved >= items) return "complete";
  return resolved > 0 || entries > 0 ? "in_progress" : "not_started";
}

export type OverallProgress = {
  total: number;
  complete: number;
  inProgress: number;
  /** Whole percent of sections complete, 0–100. */
  percent: number;
};

/** Simple average of section completion (FR-S5): complete sections / all sections. */
export function overallProgress(statuses: readonly SectionStatus[]): OverallProgress {
  const total = statuses.length;
  const complete = statuses.filter((s) => s === "complete").length;
  const inProgress = statuses.filter((s) => s === "in_progress").length;
  const percent = total === 0 ? 0 : Math.round((complete / total) * 100);
  return { total, complete, inProgress, percent };
}

/** Screen-reader text for the dashboard progress bar. */
export function progressText({ total, complete, percent }: OverallProgress) {
  return `${percent}% — ${complete} of ${total} sections complete`;
}
