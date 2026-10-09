/**
 * Seeded generator of realistic contact notes that must pass the full-number
 * checks: phones next to addresses, dates, ZIPs, street numbers, other phones,
 * and real short extensions. It measures how often the phone joins in
 * lib/privacy-warn block ordinary text (false positives).
 *
 * Re-run and print the per-pattern false-positive table:
 *   npx tsx src/test/contact-notes.ts [rowsPerPattern=600] [seed=20260929]
 * contact-notes.test.ts pins the counts for the default seed.
 */
import { isValidPhoneNumber } from "libphonenumber-js/min";
import { findFullNumber } from "../lib/privacy-warn";

export type NoteRow = { pattern: string; value: string };

export const PATTERNS = [
  "address-then-phone",
  "date-then-phone",
  "zip-then-phone",
  "street-number-then-phone",
  "phone-then-address",
  "phone-then-bare-zip",
  "two-phones",
  "phone-short-extension",
  "street-number-phone-short-extension",
] as const;

const AREA_CODES = ["404", "470", "678", "770", "312", "212", "617", "415", "206", "713", "305", "202", "503", "720", "919", "615"];
const STREETS = ["Peachtree", "Maple", "Clairmont", "Ponce de Leon", "Oak", "Elm", "Main", "Highland", "Briarcliff", "Lenox", "Juniper"];
const SUFFIXES = ["St", "Ave", "Rd", "Blvd", "Dr", "Ln", "Way", "Pkwy", "St NE", "Rd NW"];
const CITIES: [string, string, string][] = [
  ["Atlanta", "GA", "303"], ["Decatur", "GA", "300"], ["Chicago", "IL", "606"], ["Boston", "MA", "021"],
  ["Seattle", "WA", "981"], ["Houston", "TX", "770"], ["Nashville", "TN", "372"], ["Portland", "OR", "972"],
];
const UNITS = ["Apt", "Suite", "Unit", "#", "Ste", "Box", "PO Box", "Lot", "Bldg"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NAMES = ["Pat", "Dana", "Aunt Lee", "Dr. Kim", "Sam Reed", "Mrs. Alvarez", "Uncle Ken", "the landlord", "Grandma"];

export function generateContactNotes(rowsPerPattern = 600, seed = 20260929): NoteRow[] {
  let state = seed;
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join("");

  const national = () => {
    for (;;) {
      const n = pick(AREA_CODES) + String(int(200, 999)) + digits(4);
      if (!/^...[2-9]11/.test(n) && isValidPhoneNumber(n, "US")) return n;
    }
  };
  const phone = () => {
    const n = national();
    const [a, b, c] = [n.slice(0, 3), n.slice(3, 6), n.slice(6)];
    return pick([
      `(${a}) ${b}-${c}`, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `${a} ${b} ${c}`,
      `+1 ${a}-${b}-${c}`, `+1 (${a}) ${b}-${c}`, `1-${a}-${b}-${c}`, `+1 ${a} ${b} ${c}`,
    ]);
  };
  const zip = (prefix: string) => prefix + digits(2);
  const zipMaybe4 = (prefix: string) => (rnd() < 0.4 ? `${zip(prefix)}-${digits(4)}` : zip(prefix));
  const streetNumber = () => String(int(1, 10 ** int(1, 5) - 1));
  const street = () => `${streetNumber()} ${pick(STREETS)} ${pick(SUFFIXES)}`;
  const address = () => {
    const [city, st, z] = pick(CITIES);
    const unit = rnd() < 0.35 ? `, ${pick(UNITS)} ${int(1, 2400)}` : "";
    return pick([
      `${street()}${unit}, ${city}, ${st} ${zipMaybe4(z)}`,
      `${street()}${unit}, ${city} ${st} ${zipMaybe4(z)}`,
      `${street()}${unit} ${city} ${st}`,
      `${street()}${unit}`,
    ]);
  };
  const date = () => {
    const [y, m, d] = [int(1998, 2031), int(1, 12), int(1, 28)];
    const pad = (x: number) => String(x).padStart(2, "0");
    return pick([`${y}-${pad(m)}-${pad(d)}`, `${m}/${d}/${y}`, `${pad(m)}/${pad(d)}/${y}`, `${MONTHS[m - 1]} ${d}, ${y}`, `${m}/${d}`, `${y}`]);
  };
  const lead = () => pick(["", `${pick(NAMES)}: `, `${pick(NAMES)} at `, "Call ", "Office: "]);
  const joiner = () => pick([" ", ", ", " - ", " · ", "; ", " | ", ". Call ", " tel ", "\n", " (cell) "]);

  const ext = () =>
    `${pick([" x", " x ", "x", " ext. ", " ext ", " Ext: ", " #", " extension ", ", ext. "])}${digits(int(1, 4))}`;

  const make: Record<(typeof PATTERNS)[number], () => string> = {
    "address-then-phone": () => `${lead()}${address()}${joiner()}${phone()}`,
    "date-then-phone": () =>
      `${pick(["Moved in ", "Called ", "Last visit ", "Since ", "Updated ", ""])}${date()}${joiner()}${phone()}`,
    "zip-then-phone": () => {
      const [, st, z] = pick(CITIES);
      return `${pick(["", `${st} `, "ZIP "])}${zipMaybe4(z)}${joiner()}${phone()}`;
    },
    "street-number-then-phone": () =>
      `${pick(["", `${pick(NAMES)}, `])}${pick([`${pick(UNITS)} ${streetNumber()}`, streetNumber(), `${street()}`])}${joiner()}${phone()}`,
    "phone-then-address": () => {
      const [city, st, z] = pick(CITIES);
      return `${lead()}${phone()}${pick([", ", " - ", " · ", "; ", " at ", "\n", " "])}${pick([
        address(), `${pick(UNITS)} ${int(1, 2400)}`, `${st} ${zipMaybe4(z)}`, `${city} ${st} ${zipMaybe4(z)}`, street(),
      ])}`;
    },
    "phone-then-bare-zip": () => {
      const [, , z] = pick(CITIES);
      return `${lead()}${phone()}${pick([" ", ", ", " - "])}${zip(z)}`;
    },
    "two-phones": () => `${lead()}${phone()}${pick([" or ", ", ", " / ", " and ", "; ", " (cell) ", " | ", " or cell "])}${phone()}`,
    "phone-short-extension": () => `${lead()}${phone()}${ext()}`,
    "street-number-phone-short-extension": () =>
      `${pick([`${pick(UNITS)} ${streetNumber()}`, streetNumber(), street()])}${pick([" ", ", ", " - "])}${phone()}${ext()}`,
  };

  const rows: NoteRow[] = [];
  for (const pattern of PATTERNS) for (let i = 0; i < rowsPerPattern; i++) rows.push({ pattern, value: make[pattern]() });
  return rows;
}

/** Rows each pattern blocks (false positives), with a few examples. */
export function falsePositives(rows: NoteRow[]) {
  const out: Record<string, { rows: number; blocked: number; examples: string[] }> = {};
  for (const { pattern, value } of rows) {
    const entry = (out[pattern] ??= { rows: 0, blocked: 0, examples: [] });
    entry.rows++;
    if (findFullNumber(value) !== null) {
      entry.blocked++;
      if (entry.examples.length < 3) entry.examples.push(value);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [rowsArg, seedArg] = process.argv.slice(2);
  const rows = generateContactNotes(Number(rowsArg ?? 600), Number(seedArg ?? 20260929));
  const fp = falsePositives(rows);
  let total = 0;
  for (const [pattern, { rows: n, blocked, examples }] of Object.entries(fp)) {
    total += blocked;
    console.log(`${pattern.padEnd(26)} ${String(blocked).padStart(4)} / ${n}  ${((100 * blocked) / n).toFixed(2)}%  ${JSON.stringify(examples)}`);
  }
  console.log(`${"total".padEnd(26)} ${String(total).padStart(4)} / ${rows.length}  ${((100 * total) / rows.length).toFixed(2)}%`);
}
