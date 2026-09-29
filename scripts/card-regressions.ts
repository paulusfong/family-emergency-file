/**
 * Card-leak regression harness for the phone rules in src/lib/privacy-warn.ts.
 *
 *   npx tsx scripts/card-regressions.ts [--base <git rev>] [--probes <file.json>]... [--out <file.json>]
 *
 * Compares findFullNumber at a base revision (default 2e7c80e, the last one
 * with no phone exemption for the Luhn check; after a history rewrite, pass
 * the commit with the same tree) against the working tree over:
 * - card-layouts: 440,000 generated Luhn-valid cards (13, 15, 16, 19 digits;
 *   10,000 each) in 11 layouts, many phone-shaped (seed 7);
 * - issuer-layouts: standard printed layouts (16 and 19 digits in groups of 4,
 *   Amex 4-6-5, 13-digit 4-4-5, unspaced), alone, in a sentence, and next to
 *   a phone; every one must be blocked (QA rule 1);
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
const base = opt("--base")[0] ?? "2e7c80e";
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

/** The 11 layouts of the round-4 measurement (many of them phone-shaped). */
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
};

type Input = { set: string; kind: string; v: string };

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
  ["16 unspaced", 16, []],
  ["19 unspaced", 19, []],
  ["15 unspaced", 15, []],
  ["13 unspaced", 13, []],
];
const ISSUER_PREFIXES: Record<number, string[]> = {
  13: ["4", ""],
  15: ["34", "37", ""],
  16: ["4", "51", "55", "2221", "2720", "6011", "65", ""],
  19: ["4", "62", "6011", ""],
};
const CONTEXTS: [string, (c: string) => string][] = [
  ["alone", (c) => c],
  ["label", (c) => `Card: ${c}`],
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
    for (const sep of sizes.length ? [" ", "-"] : [""]) {
      for (let i = 0; i < 500; i++) {
        const prefixes = ISSUER_PREFIXES[n];
        const c = card(n, prefixes[i % prefixes.length]);
        const printed = sizes.length ? groups(c, sizes, sep) : c;
        for (const [ctx, f] of CONTEXTS) yield { set: "issuer-layouts", kind: `${name}${sep === "-" ? " dash" : ""}/${ctx}`, v: f(printed) };
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
  const sources = [cardLayoutInputs(), issuerInputs(), ...opt("--probes").map(probeInputs)];
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
      if (input.set !== "card-layouts" && input.set !== "issuer-layouts") {
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

  const rule2 = regressions.filter((r) => r.luhn && r.bucket === "digits-and-separators").length;
  console.log(`\nQA rule 2: ${rule2} digits-and-separators Luhn regressions. QA rule 1: ${rule1Leaks} leaks.`);
  if (out) fs.writeFileSync(out, JSON.stringify({ base, tally, regressions, rule1, probeGroups, fp }, null, 1));
  process.exitCode = rule2 || rule1Leaks ? 1 : 0;
}

void main();
