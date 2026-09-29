import Link from "next/link";
import { Shell } from "@/components/shell";
import { listSections, progressPercent } from "@/lib/household";
import { requireHousehold } from "@/lib/session";

export default async function DashboardPage() {
  const { file } = await requireHousehold();
  const rows = await listSections(file.id);
  const pct = progressPercent(rows);

  return (
    <Shell signedIn>
      <section className="panel">
        <h1>{file.title}</h1>
        <p className="lede">
          Progress: <strong>{pct}%</strong>
          {pct === 0 ? " — nothing filled in yet." : null}
        </p>
        <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.75rem" }}>Sections</h2>
        <ul className="section-list">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/app/sections/${s.sectionKey}`}>
                <span>
                  <strong>{s.sectionKey}</strong> {s.title}
                </span>
                <span className="badge">{s.status.replace("_", " ")}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="disclaimer">
          Open a section to work through its checklist and record where things
          are. Never store passwords, PINs, or full account numbers.
        </p>
      </section>
    </Shell>
  );
}
