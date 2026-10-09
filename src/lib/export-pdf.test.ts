import PDFDocument from "pdfkit";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExportData } from "./export";
import {
  STYLES,
  addFooters,
  formatExportDate,
  layoutPdf,
  pdfkitPen,
  renderPdf,
  toWinAnsi,
  type Pen,
  type PdfDoc,
} from "./export-pdf";

function sample(sectionCount = 2): ExportData {
  const sections: ExportData["sections"] = [
    {
      key: "S1",
      title: "Household snapshot",
      status: "complete",
      statusLabel: "Complete",
      checklist: [
        { label: "Who lives here", status: "done" },
        { label: "Pets", status: "skipped" },
      ],
      entries: [
        {
          type: "account",
          typeTitle: "Account",
          label: "Joint checking",
          fields: [
            { name: "institution", label: "Institution", value: "Example Bank" },
            { name: "last4", label: "Last 4 digits", value: "0000" },
          ],
          updatedAt: "2026-09-29T10:00:00.000Z",
        },
      ],
    },
    {
      key: "S2",
      title: "Key contacts",
      status: "not_started",
      statusLabel: "Not started",
      checklist: [{ label: "Executor", status: "open" }],
      entries: [],
    },
  ];
  for (let i = 3; i <= sectionCount; i++) {
    sections.push({ key: `S${i}`, title: `Section ${i}`, status: "not_started", statusLabel: "Not started", checklist: [], entries: [] });
  }
  return {
    kind: "family-emergency-file",
    version: 1,
    exportedAt: "2026-09-29T10:00:00.000Z",
    title: "Family Emergency File",
    notice: "Store this somewhere safe; it contains no passwords.",
    progress: { total: 2, complete: 1, inProgress: 0, percent: 50 },
    sections: sections.slice(0, sectionCount),
  };
}

function recordingPen() {
  const ops: string[] = [];
  const pen: Pen = {
    newPage: () => ops.push("--page--"),
    write: (text, style) => ops.push(`${style}: ${text}`),
    gap: (n) => ops.push(`gap ${n}`),
  };
  return { ops, pen };
}

describe("layoutPdf", () => {
  it("writes a cover page, then one page per section with checklist and entries", () => {
    const { ops, pen } = recordingPen();
    layoutPdf(sample(), pen);
    assert.deepEqual(ops, [
      "title: Family Emergency File",
      "gap 0.5",
      "notice: Store this somewhere safe; it contains no passwords.",
      "gap 1",
      "body: Exported September 29, 2026 · 50% complete (1 of 2 sections)",
      "gap 1",
      "h2: What this is",
      "body: A map of where things are and who to call, for the person who steps in if something happens. It records locations, pointers, and contacts. It does not contain passwords, PINs, or full account numbers; any value that looked like one was removed.",
      "gap 1",
      "h2: Sections",
      "item: S1 Household snapshot — Complete",
      "item: S2 Key contacts — Not started",
      "--page--",
      "h1: S1 Household snapshot",
      "muted: Complete · 2 of 2 checklist items handled · 1 entry",
      "gap 1",
      "h2: Checklist",
      "item: [x] Who lives here",
      "item: [-] Pets (skipped)",
      "gap 1",
      "h2: Entries",
      "h3: Account: Joint checking",
      "body: Institution: Example Bank",
      "body: Last 4 digits: 0000",
      "gap 0.5",
      "--page--",
      "h1: S2 Key contacts",
      "muted: Not started · 0 of 1 checklist items handled · 0 entries",
      "gap 1",
      "h2: Checklist",
      "item: [ ] Executor",
      "gap 1",
      "h2: Entries",
      "muted: No entries yet.",
    ]);
  });

  it("formats the export date in UTC", () => {
    assert.equal(formatExportDate("2026-01-01T02:00:00.000Z"), "January 1, 2026");
  });
});

describe("toWinAnsi", () => {
  it("keeps Windows-1252 text and replaces anything else with ?", () => {
    assert.equal(toWinAnsi("Café – “quotes” • … € ñ ü ÿ Ÿ"), "Café – “quotes” • … € ñ ü ÿ Ÿ");
    assert.equal(toWinAnsi("日本 😀 ✓"), "?? ? ?");
    assert.equal(toWinAnsi("a\r\nb\rc\td\ne"), "a\nb\nc d\ne");
  });

  it("draws the range edges exactly", () => {
    const at = (c: number) => toWinAnsi(String.fromCodePoint(c));
    assert.deepEqual([0x09, 0x0a, 0x1f, 0x20, 0x7e, 0x7f, 0x80, 0x9f, 0xa0, 0xff, 0x100].map(at), [
      " ",
      "\n",
      "?",
      " ",
      "~",
      "?",
      "?",
      "?",
      "\u00a0",
      "ÿ",
      "?",
    ]);
  });
});

function fakeDoc(pageCount = 2) {
  const calls: unknown[][] = [];
  const margins = { left: 54, right: 54, bottom: 54 };
  const doc = {
    page: { width: 612, height: 792, margins },
    addPage() {
      calls.push(["addPage"]);
      return doc;
    },
    font(name: string) {
      calls.push(["font", name]);
      return doc;
    },
    fontSize(size: number) {
      calls.push(["fontSize", size]);
      return doc;
    },
    fillColor(color: string) {
      calls.push(["fillColor", color]);
      return doc;
    },
    text(...args: unknown[]) {
      calls.push(["text", ...args, { marginBottomAtDraw: margins.bottom }]);
      return doc;
    },
    moveDown(n: number) {
      calls.push(["moveDown", n]);
      return doc;
    },
    bufferedPageRange: () => ({ start: 3, count: pageCount }),
    switchToPage(n: number) {
      calls.push(["switchToPage", n]);
      return doc;
    },
  };
  return { doc: doc as unknown as PdfDoc, calls, margins };
}

describe("pdfkitPen", () => {
  it("maps each style to its font, size, and color and cleans the text", () => {
    const { doc, calls } = fakeDoc();
    const pen = pdfkitPen(doc);
    pen.write("Hi 😀", "notice");
    pen.gap(0.5);
    pen.newPage();
    assert.deepEqual(calls, [
      ["font", "Helvetica-Bold"],
      ["fontSize", 16],
      ["fillColor", "#8a3b12"],
      ["text", "Hi ?", { paragraphGap: 4 }, { marginBottomAtDraw: 54 }],
      ["moveDown", 0.5],
      ["addPage"],
    ]);
  });

  it("has a style for every role", () => {
    assert.deepEqual(STYLES, {
      title: { font: "Helvetica-Bold", size: 28, color: "#1b2a3a" },
      notice: { font: "Helvetica-Bold", size: 16, color: "#8a3b12" },
      h1: { font: "Helvetica-Bold", size: 20, color: "#1b2a3a" },
      h2: { font: "Helvetica-Bold", size: 13, color: "#1b2a3a" },
      h3: { font: "Helvetica-Bold", size: 11, color: "#1b2a3a" },
      body: { font: "Helvetica", size: 11, color: "#222222" },
      muted: { font: "Helvetica", size: 10, color: "#5b6573" },
      item: { font: "Helvetica", size: 11, color: "#222222" },
    });
  });
});

describe("addFooters", () => {
  it("writes the notice and page numbers inside the bottom margin of every page", () => {
    const { doc, calls, margins } = fakeDoc(2);
    const data = sample();
    addFooters(doc, { ...data, title: "Fong family 😀" });
    const footer = (page: number) => [
      ["switchToPage", 2 + page],
      ["font", "Helvetica"],
      ["fontSize", 8],
      ["fillColor", "#5b6573"],
      [
        "text",
        `Fong family ? · Store this somewhere safe; it contains no passwords. · Page ${page} of 2`,
        54,
        756,
        { width: 504, align: "center", lineBreak: false },
        { marginBottomAtDraw: 0 },
      ],
    ];
    assert.deepEqual(calls, [...footer(1), ...footer(2)]);
    assert.equal(margins.bottom, 54);
  });
});

describe("renderPdf", () => {
  it("renders a real, letter-size PDF with a cover and one page per section", async () => {
    const bytes = await renderPdf({ ...sample(12), title: "Fong family 😀" });
    const text = Buffer.from(bytes).toString("latin1");
    const info = (key: string) => {
      const ref = new RegExp(`/${key} (\\d+) 0 R`).exec(text)![1];
      return new RegExp(`\\n${ref} 0 obj\\n\\((.*)\\)\\nendobj`).exec(text)![1];
    };
    assert.equal(text.startsWith("%PDF-1.3"), true);
    assert.equal(text.trimEnd().endsWith("%%EOF"), true);
    assert.match(text, /\/Type \/Pages\s*\/Count 13/);
    assert.match(text, /\/MediaBox \[0 0 612 792\]/);
    assert.equal(info("Title"), "Fong family ?");
    assert.equal(info("Subject"), "Store this somewhere safe; it contains no passwords.");
    assert.equal(info("Creator"), "Family Emergency File");
  });

  it("buffers pages so every page, cover included, gets the footer", async () => {
    const seen: { options?: PDFKit.PDFDocumentOptions; texts: string[] } = { texts: [] };
    await renderPdf(sample(12), (options) => {
      seen.options = options;
      const doc = new PDFDocument(options);
      const text = doc.text.bind(doc) as (value: string, ...rest: unknown[]) => PDFKit.PDFDocument;
      doc.text = ((value: string, ...rest: unknown[]) => {
        seen.texts.push(String(value));
        return text(value, ...rest);
      }) as typeof doc.text;
      return doc;
    });
    assert.equal(seen.options?.size, "LETTER");
    assert.equal(seen.options?.margin, 54);
    assert.equal(seen.options?.bufferPages, true);
    const footers = seen.texts.filter((t) => t.includes(" · Page "));
    assert.equal(footers.length, 13);
    assert.equal(footers[0], "Family Emergency File · Store this somewhere safe; it contains no passwords. · Page 1 of 13");
    assert.equal(footers[12].endsWith("Page 13 of 13"), true);
  });
});
