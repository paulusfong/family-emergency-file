import PDFDocument from "pdfkit";
import type { ExportData, ExportSection } from "./export";

/** Text roles the layout uses; the pdfkit pen maps each to a font, size, and color. */
export type TextStyle = "title" | "notice" | "h1" | "h2" | "h3" | "body" | "muted" | "item";

/** The drawing surface the layout writes to. renderPdf backs it with pdfkit. */
export interface Pen {
  newPage(): void;
  write(text: string, style: TextStyle): void;
  gap(lines: number): void;
}

export const STYLES: Record<TextStyle, { font: string; size: number; color: string }> = {
  title: { font: "Helvetica-Bold", size: 28, color: "#1b2a3a" },
  notice: { font: "Helvetica-Bold", size: 16, color: "#8a3b12" },
  h1: { font: "Helvetica-Bold", size: 20, color: "#1b2a3a" },
  h2: { font: "Helvetica-Bold", size: 13, color: "#1b2a3a" },
  h3: { font: "Helvetica-Bold", size: 11, color: "#1b2a3a" },
  body: { font: "Helvetica", size: 11, color: "#222222" },
  muted: { font: "Helvetica", size: 10, color: "#5b6573" },
  item: { font: "Helvetica", size: 11, color: "#222222" },
};

const CHECK_MARK = { done: "[x]", skipped: "[-]", open: "[ ]" } as const;

export function formatExportDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function sectionSummary(s: ExportSection) {
  const handled = s.checklist.filter((c) => c.status !== "open").length;
  const n = s.entries.length;
  return `${s.statusLabel} · ${handled} of ${s.checklist.length} checklist items handled · ${n} ${n === 1 ? "entry" : "entries"}`;
}

function layoutSection(s: ExportSection, pen: Pen) {
  pen.newPage();
  pen.write(`${s.key} ${s.title}`, "h1");
  pen.write(sectionSummary(s), "muted");
  pen.gap(1);
  pen.write("Checklist", "h2");
  for (const c of s.checklist) {
    pen.write(`${CHECK_MARK[c.status]} ${c.label}${c.status === "skipped" ? " (skipped)" : ""}`, "item");
  }
  pen.gap(1);
  pen.write("Entries", "h2");
  if (s.entries.length === 0) pen.write("No entries yet.", "muted");
  for (const e of s.entries) {
    pen.write(`${e.typeTitle}: ${e.label}`, "h3");
    for (const f of e.fields) pen.write(`${f.label}: ${f.value}`, "body");
    pen.gap(0.5);
  }
}

/** Pure layout: a cover page, then one page (or more) per section, S1 to S12. */
export function layoutPdf(data: ExportData, pen: Pen) {
  const { progress } = data;
  pen.write(data.title, "title");
  pen.gap(0.5);
  pen.write(data.notice, "notice");
  pen.gap(1);
  pen.write(
    `Exported ${formatExportDate(data.exportedAt)} · ${progress.percent}% complete (${progress.complete} of ${progress.total} sections)`,
    "body",
  );
  pen.gap(1);
  pen.write("What this is", "h2");
  pen.write(
    "A map of where things are and who to call, for the person who steps in if something happens. It records locations, pointers, and contacts. It does not contain passwords, PINs, or full account numbers; any value that looked like one was removed.",
    "body",
  );
  pen.gap(1);
  pen.write("Sections", "h2");
  for (const s of data.sections) pen.write(`${s.key} ${s.title} — ${s.statusLabel}`, "item");
  for (const s of data.sections) layoutSection(s, pen);
}

const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/**
 * The PDF uses the standard Helvetica fonts, which cover Windows-1252 only.
 * Anything else (CJK, emoji) becomes "?" instead of garbage; the JSON export
 * keeps the exact text.
 */
export function toWinAnsi(text: string) {
  let out = "";
  for (const ch of text.replace(/\r\n?/g, "\n").replace(/\t/g, " ")) {
    const c = ch.codePointAt(0)!;
    const ok = c === 10 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.includes(ch);
    out += ok ? ch : "?";
  }
  return out;
}

/** The subset of PDFKit.PDFDocument the pen and footers use. */
export type PdfDoc = Pick<
  PDFKit.PDFDocument,
  "addPage" | "font" | "fontSize" | "fillColor" | "text" | "moveDown" | "bufferedPageRange" | "switchToPage"
> & { page: { width: number; height: number; margins: { left: number; right: number; bottom: number } } };

export function pdfkitPen(doc: PdfDoc): Pen {
  return {
    newPage: () => void doc.addPage(),
    write(text, style) {
      const s = STYLES[style];
      doc.font(s.font).fontSize(s.size).fillColor(s.color).text(toWinAnsi(text), { paragraphGap: 4 });
    },
    gap: (lines) => void doc.moveDown(lines),
  };
}

/** "Page n of m" and the notice at the foot of every page. */
export function addFooters(doc: PdfDoc, data: ExportData) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    const { width, height, margins } = doc.page;
    const bottom = margins.bottom;
    // Writing inside the bottom margin would otherwise start a new page.
    margins.bottom = 0;
    doc
      .font(STYLES.muted.font)
      .fontSize(8)
      .fillColor(STYLES.muted.color)
      .text(`${toWinAnsi(data.title)} · ${data.notice} · Page ${i + 1} of ${count}`, margins.left, height - 36, {
        width: width - margins.left - margins.right,
        align: "center",
        lineBreak: false,
      });
    margins.bottom = bottom;
  }
}

type CreateDoc = (options: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument;

export async function renderPdf(
  data: ExportData,
  createDoc: CreateDoc = (options) => new PDFDocument(options),
): Promise<Uint8Array<ArrayBuffer>> {
  const doc = createDoc({
    size: "LETTER",
    margin: 54,
    bufferPages: true,
    info: { Title: toWinAnsi(data.title), Subject: data.notice, Creator: "Family Emergency File" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));
  layoutPdf(data, pdfkitPen(doc));
  addFooters(doc, data);
  doc.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}
