import { EncryptedExport } from "@/components/encrypted-export";
import { Shell } from "@/components/shell";
import { EXPORT_FORMAT_LABEL, EXPORT_NOTICE, exportFileName, lastExport } from "@/lib/export";
import { formatExportDate } from "@/lib/export-pdf";
import { requireHousehold } from "@/lib/session";

export default async function ExportPage() {
  const { file } = await requireHousehold();
  const last = await lastExport(file.id);
  const today = new Date().toISOString();

  return (
    <Shell signedIn>
      <section className="panel">
        <h1>Export your file</h1>
        <p className="lede">
          Download everything in this file: all twelve sections, their checklists, and every entry. {EXPORT_NOTICE}
        </p>
        <div className="export-options">
          <div className="export-option">
            <h2>Printable PDF</h2>
            <p>A cover page, then one page per section from S1 to S12, ready to print and keep with your will or in a fire safe.</p>
            {/* Plain links, not next/link: a prefetch would count as an export. */}
            <a className="btn" href="/app/export/pdf" download>
              Download PDF
            </a>
          </div>
          <div className="export-option">
            <h2>JSON</h2>
            <p>The same content as structured data, for your own backup or to move it somewhere else.</p>
            <a className="btn btn-secondary" href="/app/export/json" download>
              Download JSON
            </a>
          </div>
          <div className="export-option">
            <h2>Encrypted JSON</h2>
            <p>
              A passphrase-protected copy in the open <strong>age</strong> format, encrypted in this browser. Open it with the{" "}
              <code>age</code> command-line tool: <code>age -d {exportFileName(today, "json.age")}</code>.
            </p>
            <EncryptedExport fileName={exportFileName(today, "json.age")} />
          </div>
        </div>
        <p className="hint">
          {last
            ? `Last export: ${EXPORT_FORMAT_LABEL[last.format]} on ${formatExportDate(last.createdAt.toISOString())}.`
            : "No exports yet."}{" "}
          Downloads are never cached, and we record only the date and format of each export, never its contents.
        </p>
      </section>
    </Shell>
  );
}
