import Link from "next/link";
import { Shell } from "@/components/shell";
import { listChecklist, listEntries } from "@/lib/entries";
import { ENTRY_TYPE_DEFS, entrySummary, readPayload } from "@/lib/entry-fields";
import { ENTRY_TYPES, type ChecklistStatus } from "@/lib/schema";
import { STATUS_LABEL, sectionStatus } from "@/lib/progress";
import { ACCESS_PLAN_NOTE, SECTION_PRIMARY_TYPE, SECTION_PURPOSE, type SectionKey } from "@/lib/sections";
import { setChecklistItem } from "../actions";
import { loadOwnedSection } from "../load";

const ITEM_BADGE: Record<Exclude<ChecklistStatus, "open">, string> = {
  done: "Done",
  skipped: "Skipped",
};

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { key } = await params;
  const { deleted } = await searchParams;
  const { def, section } = await loadOwnedSection(key);
  const [items, rows] = await Promise.all([listChecklist(section.id), listEntries(section.id)]);
  const sectionKey = def.key as SectionKey;
  const primary = SECTION_PRIMARY_TYPE[sectionKey];
  const resolved = items.filter((i) => i.status !== "open").length;
  const status = sectionStatus({ items: items.length, resolved, entries: rows.length });
  const addTypes = [primary, ...ENTRY_TYPES.filter((t) => t !== primary)];
  const base = `/app/sections/${def.key}`;

  return (
    <Shell signedIn>
      <section className="panel">
        <p>
          <Link href="/app">← Dashboard</Link>
        </p>
        <div className="section-title">
          <h1>
            {def.key} {def.title}
          </h1>
          <span className={`chip chip-${status}`}>{STATUS_LABEL[status]}</span>
        </div>
        <p className="section-meta">
          {resolved} of {items.length} checklist items handled
        </p>
        {deleted ? <p className="flash">Entry deleted.</p> : null}
        {sectionKey === "S10" ? <p className="privacy-note">{ACCESS_PLAN_NOTE}</p> : null}

        <h2 id="checklist">Checklist</h2>
        <ul className="checklist">
          {items.map((item) => (
            <li key={item.id} className={`checklist-item item-${item.status}`}>
              <span className="checklist-label">{item.label}</span>
              {item.status === "open" ? null : <span className="badge">{ITEM_BADGE[item.status]}</span>}
              <form action={setChecklistItem} className="checklist-actions">
                <input type="hidden" name="sectionKey" value={def.key} />
                <input type="hidden" name="itemId" value={item.id} />
                {item.status === "open" ? (
                  <>
                    <button type="submit" name="status" value="done" aria-label={`Mark "${item.label}" done`}>
                      Done
                    </button>
                    <button
                      type="submit"
                      name="status"
                      value="skipped"
                      className="secondary"
                      aria-label={`Skip "${item.label}"`}
                    >
                      Skip
                    </button>
                  </>
                ) : (
                  <button
                    type="submit"
                    name="status"
                    value="open"
                    className="secondary"
                    aria-label={`Reopen "${item.label}"`}
                  >
                    Undo
                  </button>
                )}
              </form>
            </li>
          ))}
        </ul>

        <h2 id="entries">Entries</h2>
        {rows.length === 0 ? (
          <div className="empty-state">
            <p>
              <strong>Why this matters:</strong> {SECTION_PURPOSE[sectionKey]}
            </p>
            <p className="lede">No entries yet. Add the first one below.</p>
          </div>
        ) : (
          <ul className="entry-list">
            {rows.map((row) => {
              const summary = entrySummary(row.entryType, readPayload(row.entryType, row.payloadJson));
              return (
                <li key={row.id}>
                  <Link href={`${base}/entries/${row.id}`}>
                    <span>
                      <strong>{row.label}</strong>
                      {summary ? <span className="entry-summary">{summary}</span> : null}
                    </span>
                    <span className="badge">{ENTRY_TYPE_DEFS[row.entryType].title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="add-entry" aria-label="Add an entry">
          {addTypes.map((t, i) => (
            <Link
              key={t}
              href={`${base}/entries/new?type=${t}`}
              className={i === 0 ? "btn" : "btn btn-secondary"}
            >
              Add {ENTRY_TYPE_DEFS[t].title.toLowerCase()}
            </Link>
          ))}
        </div>
      </section>
    </Shell>
  );
}
