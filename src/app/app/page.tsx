import Link from "next/link";
import { PrivacySheet } from "@/components/privacy-sheet";
import { Shell } from "@/components/shell";
import { listSectionProgress } from "@/lib/household";
import { STATUS_LABEL, overallProgress, progressText } from "@/lib/progress";
import { requireHousehold } from "@/lib/session";
import { dismissPrivacySheet } from "./actions";

function entryCount(n: number) {
  return n === 1 ? "1 entry" : `${n} entries`;
}

export default async function DashboardPage() {
  const { file } = await requireHousehold();
  const rows = await listSectionProgress(file.id);
  const progress = overallProgress(rows.map((r) => r.status));
  const { percent, complete, total, inProgress } = progress;

  return (
    <Shell signedIn>
      <section className="panel">
        <h1>{file.title}</h1>
        {file.privacyAckAt ? null : <PrivacySheet dismiss={dismissPrivacySheet} />}

        <div className="progress-summary">
          <p className="progress-figure">
            <strong>{percent}%</strong> complete
          </p>
          <p className="lede">
            {complete} of {total} sections complete
            {inProgress > 0 ? ` · ${inProgress} in progress` : ""}
          </p>
        </div>
        <div
          className="progress-bar"
          role="progressbar"
          aria-label="Overall progress"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={progressText(progress)}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        {complete === 0 ? (
          <p className="hint">
            A section is complete once every checklist item is marked Done or Skip. Partial is still useful.
          </p>
        ) : null}

        <h2 className="section-heading">Sections</h2>
        <ul className="section-list">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/app/sections/${s.sectionKey}`}>
                <span className="section-name">
                  <span>
                    <strong>{s.sectionKey}</strong> {s.title}
                  </span>
                  <span className="section-meta">
                    {s.resolved}/{s.items} checklist · {entryCount(s.entries)}
                  </span>
                </span>
                <span className={`chip chip-${s.status}`}>{STATUS_LABEL[s.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="disclaimer">
          Open a section to work through its checklist and record where things are. Never store passwords, PINs,
          or full account numbers.
        </p>
      </section>
    </Shell>
  );
}
