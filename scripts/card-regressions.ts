/**
 * Card-leak regression harness for the phone rules in src/lib/privacy-warn.ts.
 *
 *   npx tsx scripts/card-regressions.ts [--base <git rev>] [--probes <file.json>]... [--out <file.json>]
 *
 * Compares findFullNumber at a base revision (default 5b5bc50, the last one
 * with no phone exemption for the Luhn check: the same tree as 2e7c80e before
 * the history rewrite) against the working tree over:
 * - card-layouts: 680,000 generated Luhn-valid cards (13, 15, 16, 19 digits;
 *   10,000 each) in 17 layouts, many phone-shaped, six of them split around a
 *   phone by a run of spaces or a tab (seed 7);
 * - issuer-layouts: standard printed layouts (16 and 19 digits in groups of 4,
 *   Amex 4-6-5, 13-digit 4-4-5, Diners 14-digit 4-6-4, unspaced), with a
 *   space, "-", or "." between groups, alone, after a label, in a sentence,
 *   and next to a phone; every one must be blocked (QA rule 1);
 * - separator-layouts: 60,000 Luhn-valid cards (13-19 digits) cut into 2-6
 *   random groups, joined by separators from SEPARATORS (single characters,
 *   runs, mixed, with and without spaces around them: " - ", "--", "/", ",",
 *   ";", "_", "(", ") ", "\n", ...), one kind per card or a different one per
 *   gap (seed 13);
 * - separator-phone-layouts: 60,000 Luhn-valid cards (13-19 digits) with a
 *   valid North American phone inside them, printed as a phone in one of six
 *   formats, the other digits cut into groups and joined the same way (QA's
 *   R3phone shape: "47; 3  (612) 665-8926", "4177983   510 - 878");
 * - diners-gaps: Diners 4-6-4 cards with each of SEPARATORS between the
 *   groups, alone ("3018 - 207780 - 4961");
 * - any --probes file: a JSON object of key -> string (or { v: string }),
 *   such as QA's probes8.json from gen8.
 * An input is a regression when the base blocked it and the working tree does
 * not. It is "Luhn" when a loose run in it (digits across separators and
 * single letters, the base's card check) is a 13-19 digit Luhn number, and
 * "digits-and-separators" when it has no letters at all after normalizing (so
 * no word and no x/ext marker). QA rule 2: digits-and-separators Luhn
 * regressions must be 0. Exit code 1 if that or rule 1 fails.
 *
 * It also prints the false-positive table of the seeded contact notes
 * (src/test/contact-notes.ts) for both revisions.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findFullNumber, normalizeForScan, passesLuhn } from "../src/lib/privacy-warn";
import { generateContactNotes } from "../src/test/contact-notes";

type Fn = (text: string) => string | null;

const args = process.argv.slice(2);
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const base = opt("--base")[0] ?? "5b5bc50";
const out = opt("--out")[0];

async function loadBase(rev: string): Promise<Fn> {
  const dir = path.resolve("node_modules/.cache/fef-card-regressions");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `privacy-warn-${rev.replace(/[^\w.-]/g, "_")}.ts`);
  fs.writeFileSync(file, execFileSync("git", ["show", `${rev}:src/lib/privacy-warn.ts`]));
  return (await import(pathToFileURL(file).href)).findFullNumber as Fn;
}

/* The base's card check: loose runs (single letters and x/ext count as separators). */
const LOOSE_SEP = "[^\\p{L}0-9]|(?:\\p{L}|ext)(?!\\p{L})";
const LOOSE_RUN_RE = new RegExp(`[0-9](?:(?:${LOOSE_SEP})*[0-9])*`, "giu");
const isCard = (d: string) => d.length >= 13 && d.length <= 19 && passesLuhn(d);
function hasLuhnRun(raw: string) {
  return [...normalizeForScan(raw).matchAll(LOOSE_RUN_RE)].some(([run]) => {
    const d = run.replace(/[^0-9]/g, "");
    return isCard(d) || (/^1[^0-9]/.test(run) && isCard(d.slice(1)));
  });
}
const bucketOf = (raw: string) => (/\p{L}/u.test(normalizeForScan(raw)) ? "letters-or-markers" : "digits-and-separators");

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join("");
const checkDigit = (s: string) => String([...Array(10).keys()].find((d) => passesLuhn(s + d)));
const card = (n: number, prefix = "") => {
  const body = prefix + digits(n - 1 - prefix.length);
  return body + checkDigit(body);
};

/**
 * The 11 layouts of the round-4 measurement (many of them phone-shaped), and
 * six with the groups next to a phone split off by a run of spaces or a tab.
 */
const CARD_LAYOUTS: Record<string, (c: string) => string> = {
  "4444sp": (c) => c.match(/.{1,4}/g)!.join(" "),
  "4444dash": (c) => c.match(/.{1,4}/g)!.join("-"),
  "3-3-4-rest": (c) => `${c.slice(0, 3)}-${c.slice(3, 6)}-${c.slice(6, 10)}-${c.slice(10)}`,
  "(3) 3-4 rest": (c) => `(${c.slice(0, 3)}) ${c.slice(3, 6)}-${c.slice(6, 10)} ${c.slice(10)}`,
  "head (3) 3-4": (c) => `${c.slice(0, c.length - 10)} (${c.slice(-10, -7)}) ${c.slice(-7, -4)}-${c.slice(-4)}`,
  "2 4 4 rest": (c) => `${c.slice(0, 2)} ${c.slice(2, 6)} ${c.slice(6, 10)} ${c.slice(10)}`,
  "3.3.4.rest": (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 10)}.${c.slice(10)}`,
  "1 3 3 4 rest": (c) => `1 ${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6, 10)} ${c.slice(10)}`,
  "4 6 rest": (c) => `${c.slice(0, 4)} ${c.slice(4, 10)} ${c.slice(10)}`,
  "3 3-4 rest": (c) => `${c.slice(0, 3)} ${c.slice(3, 6)}-${c.slice(6, 10)} ${c.slice(10)}`,
  "2 3 3-4 rest": (c) => `${c.slice(0, 2)} ${c.slice(2, 5)} ${c.slice(5, 8)}-${c.slice(8, 12)} ${c.slice(12)}`,
  "head    (3) 3-4": (c) => `${c.slice(0, c.length - 10)}    (${c.slice(-10, -7)}) ${c.slice(-7, -4)}-${c.slice(-4)}`,
  "head\t(3) 3-4": (c) => `${c.slice(0, c.length - 10)}\t(${c.slice(-10, -7)}) ${c.slice(-7, -4)}-${c.slice(-4)}`,
  "(3) 3-4 x17sp rest": (c) => `(${c.slice(0, 3)}) ${c.slice(3, 6)}-${c.slice(6, 10)}${" ".repeat(17)}${c.slice(10)}`,
  "3-3-4\trest": (c) => `${c.slice(0, 3)}-${c.slice(3, 6)}-${c.slice(6, 10)}\t${c.slice(10)}`,
  "2  (3) 3-4  rest": (c) => `${c.slice(0, 2)}  (${c.slice(2, 5)}) ${c.slice(5, 8)}-${c.slice(8, 12)}  ${c.slice(12)}`,
  "head \t 3.3.4": (c) => `${c.slice(0, c.length - 10)} \t ${c.slice(-10, -7)}.${c.slice(-7, -4)}.${c.slice(-4)}`,
};

type Input = { set: string; kind: string; v: string };

/** Separators between card groups: single characters, runs, and the forms QA found ("4177983   510 - 878"). */
const SEPARATORS = [
  " ", "  ", "   ", "          ", "\t", " \t ", "-", ".", " - ", "--", "-- ", " -- ", " -  - ", "/", " / ", "//",
  ",", ", ", ",,", " , ", ";", "; ", " ; ", "_", "__", " _ ", "(", " (", ") ", ")", ",(", " -  - (", " . ", "..",
  "|", " | ", " · ", "\n", " \n ", "\r\n", "#", " #", "*", "~", "+", "'", "\"", ":", ": ", "=", "\u2014", " \u2013 ",
  "\u00a0", "\u00a0\u00a0", "\u3000", "\u2009", "\u3164",
];
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];

/** Cuts digits into 1-`max` groups of random sizes (at least one digit each). */
function cut(d: string, max: number) {
  if (d === "") return [];
  const k = Math.min(d.length, 1 + Math.floor(rnd() * max));
  const at = new Set<number>();
  while (at.size < k - 1) at.add(1 + Math.floor(rnd() * (d.length - 1)));
  const cuts = [0, ...[...at].sort((a, b) => a - b), d.length];
  return cuts.slice(1).map((end, i) => d.slice(cuts[i], end));
}

/** Joins parts with one separator kind throughout, or a random one per gap. */
function join(parts: string[], mixed: boolean) {
  const one = pick(SEPARATORS);
  return parts.reduce((out, p, i) => (i === 0 ? p : out + (mixed ? pick(SEPARATORS) : one) + p), "");
}

function* separatorInputs(): Generator<Input> {
  seed = 13;
  for (let i = 0; i < 60000; i++) {
    const n = 13 + (i % 7);
    const mixed = i % 3 === 0;
    yield { set: "separator-layouts", kind: `${n}/${mixed ? "mixed" : "one-kind"}`, v: join(cut(card(n), 6), mixed) };
  }
}

const PHONE_FORMATS: ((p: string) => string)[] = [
  (p) => `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`,
  (p) => `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`,
  (p) => `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6)}`,
  (p) => `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`,
  (p) => `(${p.slice(0, 3)})${p.slice(3, 6)}-${p.slice(6)}`,
  (p) => `${p.slice(0, 3)}/${p.slice(3, 6)}-${p.slice(6)}`,
];

/**
 * A Luhn-valid card of n digits with a North American number (area code and
 * exchange starting 2-9) at a random offset, printed as a phone.
 */
function* separatorPhoneInputs(): Generator<Input> {
  seed = 17;
  for (let i = 0; i < 60000; i++) {
    const n = 13 + (i % 7);
    const off = Math.floor(rnd() * (n - 10 + 1));
    const phone = `${2 + Math.floor(rnd() * 8)}${digits(2)}${2 + Math.floor(rnd() * 8)}${digits(6)}`;
    let head = digits(off);
    let tail = digits(n - 10 - off);
    // The check digit goes last: in the tail, or else the first head digit (which has no fixed value).
    if (tail) tail = tail.slice(0, -1) + checkDigit(head + phone + tail.slice(0, -1));
    else if (head) head = [..."0123456789"].find((d) => passesLuhn(d + head.slice(1) + phone))! + head.slice(1);
    else continue;
    const mixed = i % 3 === 0;
    const parts = [...cut(head, 3), pick(PHONE_FORMATS)(phone), ...cut(tail, 3)];
    yield { set: "separator-phone-layouts", kind: `${n}/${mixed ? "mixed" : "one-kind"}`, v: join(parts, mixed) };
  }
}

function* dinersGapInputs(): Generator<Input> {
  seed = 19;
  for (const sep of SEPARATORS) {
    for (let i = 0; i < 50; i++) {
      const c = card(14, pick(["36", "38", "30", "300", "305"]));
      yield { set: "diners-gaps", kind: JSON.stringify(sep), v: groups(c, [4, 6, 4], sep) };
    }
  }
}

function* cardLayoutInputs(): Generator<Input> {
  seed = 7;
  for (let i = 0; i < 10000; i++) {
    for (const n of [13, 15, 16, 19]) {
      const c = card(n);
      for (const [k, f] of Object.entries(CARD_LAYOUTS)) yield { set: "card-layouts", kind: `${k}/${n}`, v: f(c) };
    }
  }
}

const groups = (c: string, sizes: number[], sep: string) => {
  let at = 0;
  return sizes.map((s) => c.slice(at, (at += s))).join(sep);
};
/** Standard printed layouts: [name, length, group sizes (empty = unspaced)]. */
const ISSUER_LAYOUTS: [string, number, number[]][] = [
  ["16 in 4s", 16, [4, 4, 4, 4]],
  ["19 in 4s", 19, [4, 4, 4, 4, 3]],
  ["Amex 4-6-5", 15, [4, 6, 5]],
  ["13 as 4-4-5", 13, [4, 4, 5]],
  ["Diners 4-6-4", 14, [4, 6, 4]],
  ["14 unspaced", 14, []],
  ["16 unspaced", 16, []],
  ["19 unspaced", 19, []],
  ["15 unspaced", 15, []],
  ["13 unspaced", 13, []],
];
const ISSUER_PREFIXES: Record<number, string[]> = {
  13: ["4", ""],
  14: ["36", "38", "30", "300", "305", ""],
  15: ["34", "37", ""],
  16: ["4", "51", "55", "2221", "2720", "6011", "65", ""],
  19: ["4", "62", "6011", ""],
};
const CONTEXTS: [string, (c: string) => string][] = [
  ["alone", (c) => c],
  ["label", (c) => `Card: ${c}`],
  ["issuer-label", (c) => `Diners Club ${c}`],
  ["sentence", (c) => `Visa ${c} exp 04/28, in the fire safe`],
  ["phone-then-card", (c) => `(404) 683-5510 ${c}`],
  ["card-then-phone", (c) => `${c} (404) 683-5510`],
  ["phone-comma-card", (c) => `Call 404-683-5510, card ${c}`],
  ["card-comma-phone", (c) => `${c}, 404.683.5510`],
  ["plus1-phone-then-card", (c) => `+1 404 683 5510 ${c}`],
];

function* issuerInputs(): Generator<Input> {
  seed = 11;
  for (const [name, n, sizes] of ISSUER_LAYOUTS) {
    for (const sep of sizes.length ? [" ", "-", "."] : [""]) {
      for (let i = 0; i < 500; i++) {
        const prefixes = ISSUER_PREFIXES[n];
        const c = card(n, prefixes[i % prefixes.length]);
        const printed = sizes.length ? groups(c, sizes, sep) : c;
        for (const [ctx, f] of CONTEXTS) yield { set: "issuer-layouts", kind: `${name}${{ "-": " dash", ".": " dot" }[sep] ?? ""}/${ctx}`, v: f(printed) };
      }
    }
  }
}

function* probeInputs(file: string): Generator<Input> {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string | { v: string }>;
  for (const [k, raw] of Object.entries(data)) {
    const v = typeof raw === "string" ? raw : raw.v;
    yield { set: path.basename(file), kind: k.split("|")[0], v };
  }
}

async function main() {
  const oldFn = await loadBase(base);
  const newFn: Fn = findFullNumber;
  const tally: Record<string, Record<string, number>> = {};
  const add = (key: string, field: string) => ((tally[key] ??= {})[field] = (tally[key][field] ?? 0) + 1);
  const regressions: (Input & { bucket: string; luhn: boolean; old: string | null })[] = [];
  const rule1: Record<string, { n: number; leaks: number; example?: string }> = {};
  const probeGroups: Record<string, Record<string, number>> = {};
  const sources = [
    cardLayoutInputs(),
    issuerInputs(),
    separatorInputs(),
    separatorPhoneInputs(),
    dinersGapInputs(),
    ...opt("--probes").map(probeInputs),
  ];
  for (const source of sources) {
    for (const input of source) {
      const old = oldFn(input.v);
      const now = newFn(input.v);
      const bucket = bucketOf(input.v);
      const luhn = hasLuhnRun(input.v);
      const key = `${input.set} | ${bucket}`;
      add(key, "inputs");
      if (luhn) add(key, "luhn");
      if (old !== null && now === null) {
        add(key, luhn ? "regressions-luhn" : "regressions-other");
        regressions.push({ ...input, bucket, luhn, old });
      }
      if (old === null && now !== null) add(key, "newly-blocked");
      if (input.set === "issuer-layouts") {
        const r = (rule1[input.kind] ??= { n: 0, leaks: 0 });
        r.n++;
        if (now === null) {
          r.leaks++;
          r.example ??= input.v;
        }
      }
      if (input.set.endsWith(".json")) {
        const g = (probeGroups[`${input.set} ${input.kind}`] ??= { n: 0, allowedNow: 0, allowedBase: 0 });
        g.n++;
        if (now === null) g.allowedNow++;
        if (old === null) g.allowedBase++;
      }
    }
  }

  console.log(`Base ${base} vs working tree. Regressions = blocked at the base, allowed now.\n`);
  console.log("set | bucket".padEnd(52), "inputs".padStart(8), "luhn".padStart(8), "regr-luhn".padStart(10), "regr-other".padStart(11), "newly-blocked".padStart(14));
  for (const [key, t] of Object.entries(tally).sort()) {
    console.log(
      key.padEnd(52),
      String(t.inputs ?? 0).padStart(8),
      String(t.luhn ?? 0).padStart(8),
      String(t["regressions-luhn"] ?? 0).padStart(10),
      String(t["regressions-other"] ?? 0).padStart(11),
      String(t["newly-blocked"] ?? 0).padStart(14),
    );
  }
  const byKind: Record<string, { n: number; example: string }> = {};
  for (const r of regressions.filter((r) => r.luhn)) {
    const k = `${r.bucket} | ${r.set} ${r.kind}`;
    (byKind[k] ??= { n: 0, example: r.v }).n++;
  }
  console.log("\nLuhn regressions by bucket and kind (count, first example):");
  for (const [k, { n, example }] of Object.entries(byKind).sort()) console.log(`  ${k}: ${n}  ${JSON.stringify(example)}`);

  console.log("\nQA rule 1, standard issuer layouts (leaks must be 0):");
  let rule1Leaks = 0;
  for (const [k, r] of Object.entries(rule1)) {
    rule1Leaks += r.leaks;
    if (r.leaks) console.log(`  LEAK ${k}: ${r.leaks}/${r.n}  ${JSON.stringify(r.example)}`);
  }
  const rule1N = Object.values(rule1).reduce((s, r) => s + r.n, 0);
  console.log(`  ${rule1Leaks} leaks in ${rule1N} inputs (${Object.keys(rule1).length} layout x context kinds)`);

  if (Object.keys(probeGroups).length) {
    console.log("\nProbe files, allowed (not blocked) per group:");
    for (const [k, g] of Object.entries(probeGroups)) console.log(`  ${k}: now ${g.allowedNow}/${g.n}, base ${g.allowedBase}/${g.n}`);
  }

  const notes = generateContactNotes();
  const fp: Record<string, { n: number; now: number; base: number; example?: string }> = {};
  for (const { pattern, value } of notes) {
    const r = (fp[pattern] ??= { n: 0, now: 0, base: 0 });
    r.n++;
    if (newFn(value) !== null) {
      r.now++;
      r.example ??= value;
    }
    if (oldFn(value) !== null) r.base++;
  }
  console.log("\nContact-note false positives (blocked rows), now vs base:");
  for (const [p, r] of Object.entries(fp)) {
    console.log(`  ${p.padEnd(38)} ${String(r.now).padStart(4)} / ${r.n}  (base ${r.base})  ${r.example ? JSON.stringify(r.example) : ""}`);
  }
  const sum = (f: "n" | "now" | "base") => Object.values(fp).reduce((t, r) => t + r[f], 0);
  console.log(`  ${"total".padEnd(38)} ${String(sum("now")).padStart(4)} / ${sum("n")}  (base ${sum("base")})`);

  console.log(`\nSeparators generated: ${SEPARATORS.length} kinds (${JSON.stringify(SEPARATORS)}).`);
  const rule2 = regressions.filter((r) => r.luhn && r.bucket === "digits-and-separators").length;
  console.log(`\nQA rule 2: ${rule2} digits-and-separators Luhn regressions. QA rule 1: ${rule1Leaks} leaks.`);
  if (out) fs.writeFileSync(out, JSON.stringify({ base, tally, regressions, rule1, probeGroups, fp }, null, 1));
  process.exitCode = rule2 || rule1Leaks ? 1 : 0;
}

void main();
