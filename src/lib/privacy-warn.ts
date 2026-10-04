/**
 * One set of privacy rules shared by the entry editor (inline warning before
 * save) and the server (validateEntry). The app stores pointers and metadata,
 * never secrets, so two levels:
 *
 * - "block": text shaped like a full account, card, or Social Security number,
 *   or a value written after an explicit credential label ("password: …",
 *   "PIN=…"). The server rejects it and the editor will not autosave it.
 * - "warn": text that looks like a password, PIN, or token. The editor holds
 *   the save until the person confirms it is not a secret; the server allows
 *   it because a heuristic can be wrong.
 */

import { findPhoneNumbersInText, isValidPhoneNumber } from "libphonenumber-js/min";

export type PrivacyLevel = "block" | "warn";
export type PrivacyReason = "full_number" | "ssn" | "credential" | "secret_label" | "secret_token";
export type PrivacyFinding = { level: PrivacyLevel; reason: PrivacyReason; message: string };

export const FULL_NUMBER_ERROR =
  "This looks like a full account, card, or ID number. Store the last 4 digits at most.";

export const CREDENTIAL_ERROR =
  "This is labelled as a password, PIN, or other credential. Write down where it is kept, never the value itself.";

export const SECRET_WARNING =
  "This looks like a password, PIN, or other secret. Keep it in your password manager and write down where it lives instead.";

/*
 * Full numbers. The text is normalized first (Hangul fillers turned into
 * spaces; NFKC, so fullwidth digits become ASCII; every default-ignorable code
 * point, such as ZWSP, ZWJ, or a soft hyphen, removed; every decimal digit
 * mapped to 0-9). A
 * "run" is digits joined across separators, so "4111 - 1111_1111\t1111" is one
 * 16-digit run. Anything that is not a letter or a digit is a separator, and so
 * is an extension marker ("x", "ext") on its own. Other letters end a run,
 * except in the loose runs used for the Luhn and SSN checks, where a single
 * letter between digit groups ("4111a1111b1111c1111") is a separator too. A
 * word of two or more letters ends every run, so VINs, serials, and policy IDs
 * ("1HGCM82633A004352", "HO3-4471-AZ") do not join into long numbers.
 */
/**
 * Hangul fillers are letters (Lo) that render as blank space. They are also
 * default-ignorable, but removing one could join two single letters into a
 * word that ends a run, so each becomes a space: a separator for every check.
 */
const HANGUL_FILLER_RE = /[\u115F\u1160\u3164\uFFA0]/g;
const DEFAULT_IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/gu;
const DIGIT_RE = /\p{Nd}/gu;
const SEP = "[^\\p{L}0-9]|(?:x|ext)(?!\\p{L})";
const LOOSE_SEP = "[^\\p{L}0-9]|(?:\\p{L}|ext)(?!\\p{L})";
const runRe = (sep: string) => new RegExp(`[0-9](?:(?:${sep})*[0-9])*`, "giu");
const RUN_RE = runRe(SEP);
const LOOSE_RUN_RE = runRe(LOOSE_SEP);
const NON_DIGIT_RE = /[^0-9]/g;
const COUNTRY_CODE_ONE_RE = /^1[^0-9]/;
const SSN_RE = new RegExp(`(?<![0-9])[0-9]{3}(?:${LOOSE_SEP})+[0-9]{2}(?:${LOOSE_SEP})+[0-9]{4}(?![0-9])`, "iu");
const MIN_BARE_RUN = 9;
/** Luhn doubling of each digit, digit sum taken. */
const LUHN_DOUBLED = [0, 2, 4, 6, 8, 1, 3, 5, 7, 9];

/* Well-formed tokens that may hold 9+ digits in text fields: removed before the run check. */
const YEAR = "(?:19|20)[0-9]{2}";
const MONTH = "(?:0?[1-9]|1[0-2])";
const DAY = "(?:0?[1-9]|[12][0-9]|3[01])";
const DATE_RE = new RegExp(
  `(?<![0-9])(?:${YEAR}([-/.])${MONTH}\\1${DAY}|${MONTH}([-/.])${DAY}\\2${YEAR})(?![0-9])`,
  "g",
);
const ZIP4_RE = /(?<![0-9])[0-9]{5}-[0-9]{4}(?![0-9])/g;
/**
 * Amounts with at most 12 whole-dollar digits: comma-grouped with cents
 * (1,234,567,890.12) or after "$" ($123,456,789); up to 8 digits with cents
 * (12345678.90) or after "$" ($950). A "$" before an amount with cents is
 * simply a separator.
 */
const AMOUNT_RE =
  /(?<![0-9,.])(?:\$[0-9]{1,3}(?:,[0-9]{3}){1,3}|[0-9]{1,3}(?:,[0-9]{3}){1,3}\.[0-9]{2}|[0-9]{1,8}\.[0-9]{2}|\$[0-9]{1,8})(?![0-9,]|\.[0-9])/g;
/** Years listed with commas ("2019, 2021, 2024"), or five or more with spaces; four spaced years look like a card. */
const YEAR_LIST_RE = new RegExp(`(?<![0-9])${YEAR}(?:(?:\\s*,\\s*${YEAR})+|(?:\\s+${YEAR}){4,})(?![0-9])`, "g");
/**
 * A VIN shape: 17 letters and digits, no I, O, or Q, with at least two letters
 * (one letter on a 16-digit number is not enough: "3360585837343724R").
 */
const VIN_RE = /(?<![\p{L}0-9])(?=(?:[0-9]*[A-HJ-NPR-Z]){2})[A-HJ-NPR-Z0-9]{17}(?![\p{L}0-9])/giu;
/** 9+ digits in a row starting before position 9 (the check digit): an SSN or account number, not a VIN. */
const VIN_EARLY_RUN_RE = /^[A-Z0-9]{0,7}[0-9]{9}/i;
/** ISO 3779 transliteration: a character's value is its index here, mod 10 (A=1 ... H=8, J=1 ... R=9, S=2 ... Z=9). */
const VIN_VALUES = "0123456789.ABCDEFGH..JKLMN.P.R..STUVWXYZ";
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
/** What a set-aside token becomes: a letter that is not an extension marker, so it ends every run. */
const MASK = " Z ";

/**
 * The value (0-9) of a Unicode decimal digit. Each script's digits are ten
 * consecutive code points starting at zero, and a few scripts sit back to
 * back, so count from the start of the whole run of digit code points.
 */
function digitValue(ch: string) {
  const cp = ch.codePointAt(0)!;
  let start = cp;
  while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

/** Hangul fillers as spaces, NFKC, default-ignorables removed, every decimal digit written 0-9. */
export function normalizeForScan(text: string) {
  return text
    .replace(HANGUL_FILLER_RE, " ")
    .normalize("NFKC")
    .replace(DEFAULT_IGNORABLE_RE, "")
    .replace(DIGIT_RE, (d) => String(digitValue(d)));
}

/** Digit strings of each run (digits joined across separators). */
function digitRuns(text: string, re = RUN_RE) {
  return [...text.matchAll(re)].map(([run]) => run.replace(NON_DIGIT_RE, ""));
}

/**
 * True when a loose run (single letters count as separators) is a Luhn-valid
 * card number, with or without a leading country code "1" written on its own.
 */
function holdsCard(text: string) {
  return [...text.matchAll(LOOSE_RUN_RE)].some(([run]) => {
    const digits = run.replace(NON_DIGIT_RE, "");
    return isLuhnCard(digits) || (COUNTRY_CODE_ONE_RE.test(run) && isLuhnCard(digits.slice(1)));
  });
}

function maskUnlessCard(token: string) {
  return holdsCard(token) ? token : MASK;
}

/** The ISO 3779 check digit (position 9): weighted sum mod 11, where 10 is written X. */
export function hasVinCheckDigit(vin: string) {
  const chars = vin.toUpperCase();
  let sum = 0;
  for (let i = 0; i < VIN_WEIGHTS.length; i++) sum += (VIN_VALUES.indexOf(chars[i]) % 10) * VIN_WEIGHTS[i];
  const check = sum % 11;
  return chars[8] === (check === 10 ? "X" : String(check));
}

/**
 * A VIN-shaped token is set aside only when its check digit validates and no
 * run of 9+ digits starts before position 9 ("123456787ABCDEFGH" has a valid
 * check digit but opens with an SSN); otherwise its digits count as usual.
 */
function maskVin(token: string) {
  return hasVinCheckDigit(token) && !VIN_EARLY_RUN_RE.test(token) ? maskUnlessCard(token) : token;
}

/** Luhn: the check digit (last) brings the weighted sum of the rest to a multiple of 10. */
export function passesLuhn(digits: string) {
  let sum = 0;
  for (let i = 1; i < digits.length; i++) {
    const d = Number(digits[digits.length - 1 - i]);
    sum += i % 2 === 1 ? LUHN_DOUBLED[d] : d;
  }
  return (sum + Number(digits.at(-1))) % 10 === 0;
}

function isLuhnCard(digits: string) {
  return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
}

/**
 * A phone number written as one: valid for its country (US by default, via
 * libphonenumber-js), with a separator between digit groups, and no bare run
 * of 9+ digits. "(404) 555-0123", "+44 20 7946 0958"; not "4045550123".
 */
export function isFormattedPhone(value: string) {
  return (
    !new RegExp(`[0-9]{${MIN_BARE_RUN},}`).test(value) &&
    /[0-9][^0-9]+[0-9]/.test(value) &&
    isValidPhoneNumber(value, "US")
  );
}

/*
 * Phones. A formatted valid phone is set aside for every check, the Luhn check
 * included, so digits written next to it ("Atlanta GA 30301 (404) 683-5510",
 * "(404) 555-0147 ext. 204") do not join into a card number. What it could hide
 * is checked on purpose. The phone's digits (its national number, and its
 * digits as typed without the extension: "+1 404..." with the country code,
 * "0114 9344 1306 6245" with the 011 that makes it a call to +49) are tried
 * alone and joined to
 * - a tail: the next digit group after it (its extension, if it has one),
 *   across extension markers and separators only ("x", "ext.", "no.", "/",
 *   ","), within 16 characters;
 * - a head: the digit group just before it, across 1-3 separators and no
 *   letters.
 * A join counts when the tail alone has 5+ digits, or the join adds 6+ in all
 * (real extensions are shorter, and a ZIP before a phone is 5); a short
 * extension after a marker never joins the head. Neither may sit inside
 * another set-aside token (a phone, date, ZIP+4, amount, or year list), and a
 * tail followed by a word with no marker before it is a street number
 * ("(404) 683-5510, 12045 Main St"), not an extension. If any of these is a 13-19 digit Luhn-valid number,
 * the text is blocked.
 *
 * Text with no letters at all has nothing that says a group is a ZIP, a
 * street number, or an extension, so there the whole-run card check still
 * reads a phone together with the groups grouped with it the way card digits
 * are grouped (see tightRunHidesCard).
 */
const EXT_WORDS = "x|ext|extn|extensi[oó]n|ex|no|nr|num|number|anexo|ramal|int|interno|poste|durchwahl|доб";
/* Both match at index 0, possibly empty, so they need no anchor. */
const JOIN_GAP_RE = new RegExp(`(?:[^\\p{L}0-9]|(?:${EXT_WORDS})(?!\\p{L}))*`, "iu");
const MAX_JOIN_GAP = 16;
const LEADING_GROUP_RE = /[0-9]*/;
const STREET_NAME_RE = /^\s+\p{L}{2}/u;
const EXT_MARK_RE = /[\p{L}#]/u;
const TRAILING_GROUP_RE = /([0-9]+)[^\p{L}0-9]{1,3}$/u;
/** How card digits are grouped: a run of spaces or tabs, or exactly one "-" or ".". */
const CARD_GAP = "(?:[ \\t]+|[.-])";
const TIGHT_RUN_RE = new RegExp(`[0-9]+(?:${CARD_GAP}[0-9]+)*`, "g");
/**
 * A 14-digit card printed 4-6-4 (Diners Club). Its last ten digits read as a
 * phone ("3845 201735 4845"), and four digits before a phone are a street
 * number, so the layout is checked before phones are set aside. The same
 * separator comes between both pairs of groups, as printed on a card; a year
 * before a phone written 6-4 ("2019 770365-0135") is not one.
 */
const DINERS_RE = new RegExp(`(?<![0-9])[0-9]{4}(${CARD_GAP})[0-9]{6}\\1[0-9]{4}`, "g");
const DIGIT_CHAR_RE = /[0-9]/;
const LETTER_RE = /\p{L}/u;
const MIN_TAIL = 5;
const MIN_ADDED_DIGITS = 6;

/**
 * A North American number written as one ("(404) 683-5510", "+1 404.683.5510").
 * libphonenumber reads a phone together with digits next to it
 * ("4/23/2013 - (770) 547-4454", "(305) 945-6967 7674 Ponce de Leon Blvd") and
 * then finds none, so these are also looked for on their own.
 */
const NANP_RE = /(?<![0-9+])(?:\+?1[ .-]?)?(?:\([2-9][0-9]{2}\) ?|[2-9][0-9]{2}[ .-]?)[2-9][0-9]{2}[ .-][0-9]{4}(?![0-9])/g;

const NANP_LENGTH = 10;

type FoundPhone = { startsAt: number; endsAt: number; nationalNumber: string };

/**
 * The phones set aside, each up to its last digit before any extension (the
 * extension is then a tail like any other): formatted valid numbers
 * libphonenumber finds, plus North American numbers found on their own (one
 * found twice is harmless: it is masked twice and checked twice). A
 * seven-digit local number ("310-8304") is not one: it cannot make a long run
 * on its own, and setting it aside would split the digits around it.
 */
function findPhones(text: string): FoundPhone[] {
  const phones: FoundPhone[] = [];
  for (const { startsAt, endsAt, number } of findPhoneNumbersInText(text, { defaultCountry: "US" })) {
    const phone = text.slice(startsAt, endsAt);
    if (!isFormattedPhone(phone) || (number.countryCallingCode === "1" && number.nationalNumber.length < NANP_LENGTH)) continue;
    const typed = phone.replace(NON_DIGIT_RE, "").length - (number.ext ?? "").length;
    const core = new RegExp(`(?:[^0-9]*[0-9]){${typed}}`).exec(phone)![0];
    phones.push({ startsAt, endsAt: startsAt + core.length, nationalNumber: number.nationalNumber });
  }
  for (const m of text.matchAll(NANP_RE)) {
    if (!isFormattedPhone(m[0])) continue;
    const nationalNumber = m[0].replace(NON_DIGIT_RE, "").slice(-NANP_LENGTH);
    phones.push({ startsAt: m.index, endsAt: m.index + m[0].length, nationalNumber });
  }
  return phones;
}

/** Which characters sit inside a set-aside token: phones, dates, ZIP+4s, amounts, year lists. */
function asideMask(text: string, phones: FoundPhone[]) {
  const aside: boolean[] = Array.from(text, () => false);
  for (const { startsAt, endsAt } of phones) aside.fill(true, startsAt, endsAt);
  for (const re of [DATE_RE, ZIP4_RE, AMOUNT_RE, YEAR_LIST_RE]) {
    for (const m of text.matchAll(re)) aside.fill(true, m.index, m.index + m[0].length);
  }
  return aside;
}

/**
 * What may follow a phone's digits: nothing, or the digit group after it,
 * across extension markers and separators; `marked` when a marker ("x", "ext",
 * "#") comes first.
 */
function tailsAfter(text: string, from: number, aside: boolean[]) {
  const rest = text.slice(from);
  const gap = JOIN_GAP_RE.exec(rest)![0];
  const group = LEADING_GROUP_RE.exec(rest.slice(gap.length))![0];
  const marked = EXT_MARK_RE.test(gap);
  const street = !marked && STREET_NAME_RE.test(rest.slice(gap.length + group.length));
  const joins = gap.length <= MAX_JOIN_GAP && !aside[from + gap.length] && !street;
  return { tails: joins ? ["", group] : [""], marked };
}

/** What may come before a phone's digits: nothing, or the digit group just before it, across 1-3 separators. */
function headsBefore(text: string, to: number, aside: boolean[]) {
  const m = TRAILING_GROUP_RE.exec(text.slice(0, to));
  return m !== null && !aside[m.index] ? ["", m[1]] : [""];
}

/**
 * A join counts when its tail has 5+ digits (a 15-digit card, or 16 after
 * "+1"), or it adds 6+ digits in all (a 16-digit card is a 10-digit phone and
 * 6 more, on either side or split across both). A short tail after an
 * extension marker is an extension, so it does not join a head
 * ("Suite 210, (404) 555-0147 ext. 2045" is an address, not a split number).
 */
function joinCounts(head: string, tail: string, marked: boolean) {
  if (tail.length >= MIN_TAIL || head + tail === "") return true;
  return head.length + tail.length >= MIN_ADDED_DIGITS && !(marked && tail);
}

/**
 * For text with no letters: the whole-run card check (13-19 digits, Luhn,
 * also without a leading "1" written on its own), run on stretches of phones
 * (read as digits, whatever their inner formatting) and digit groups with a
 * run of spaces or tabs, or a single "-" or ".", between them:
 * "(525) 965-8909 210", "17777 (402) 664-6221", "41 215 536-1819 125",
 * "445195    (683) 237-4184". Any other separator ends a
 * stretch ("30301; (404) 683-5510"), as do the other set-aside tokens and a
 * "+" starting a phone (a card never has one). A stretch with no phone in it
 * is a 9+ digit run already.
 */
function tightRunHidesCard(text: string, phones: FoundPhone[], aside: boolean[]) {
  const inPhone: boolean[] = new Array(text.length).fill(false);
  for (const { startsAt, endsAt } of phones) inPhone.fill(true, startsAt, endsAt);
  const glued = text
    .split("")
    .map((ch, i) => {
      if (!inPhone[i]) return aside[i] ? MASK : ch;
      if (DIGIT_CHAR_RE.test(ch)) return ch;
      if (ch === "+") return "Z";
      // One "-" after each digit group inside the phone; its other separators ("(", ") ") drop out.
      return DIGIT_CHAR_RE.test(text[i - 1]) ? "-" : "";
    })
    .join("");
  return [...glued.matchAll(TIGHT_RUN_RE)].some(([run]) => {
    const digits = run.replace(NON_DIGIT_RE, "");
    return isLuhnCard(digits) || (COUNTRY_CODE_ONE_RE.test(run) && isLuhnCard(digits.slice(1)));
  });
}

/**
 * Overwrites each phone set aside with letters of the same length (so
 * offsets still line up), and reports whether any of them hides a card.
 */
function setPhonesAside(text: string) {
  const phones = findPhones(text);
  const aside = asideMask(text, phones);
  let masked = text;
  let hidesCard = false;
  for (const { startsAt, endsAt, nationalNumber } of phones) {
    const phone = text.slice(startsAt, endsAt);
    const bases = [nationalNumber, phone.replace(NON_DIGIT_RE, "")];
    const heads = headsBefore(text, startsAt, aside);
    const { tails, marked } = tailsAfter(text, endsAt, aside);
    hidesCard ||= heads.some((head) =>
      tails.some((tail) => joinCounts(head, tail, marked) && bases.some((base) => isLuhnCard(head + base + tail))),
    );
    masked = masked.slice(0, startsAt) + "Z".repeat(phone.length) + masked.slice(endsAt);
  }
  hidesCard ||= [...text.matchAll(DINERS_RE)].some(([card]) => passesLuhn(card.replace(NON_DIGIT_RE, "")));
  hidesCard ||= !LETTER_RE.test(text) && tightRunHidesCard(text, phones, aside);
  return { masked, hidesCard };
}

/** Sets aside dates, ZIP+4s, amounts, year lists, and VINs so they do not join into a run. */
function maskWellFormed(text: string) {
  let out = text;
  for (const re of [DATE_RE, ZIP4_RE, AMOUNT_RE, YEAR_LIST_RE]) out = out.replace(re, maskUnlessCard);
  return out.replace(VIN_RE, maskVin);
}

/**
 * Full account, card, or SSN shapes, the same in every field (phone and
 * email included), in order:
 * 1. a formatted phone that hides a card (see Phones above), or a Luhn-valid
 *    card printed 4-6-4; formatted valid phones are then set aside for the
 *    checks below;
 * 2. any other 13-19 digit loose run that passes Luhn, also tried without a
 *    leading country code "1" ("1 4111 1111 1111 1111");
 * 3. an SSN layout (3-2-4 digits; any separators, single letters included);
 * 4. once well-formed tokens are also set aside (dates, ZIP+4s, amounts, year
 *    lists, VINs; none of them Luhn-valid), any run of 9+ digits. A phone
 *    written as a bare run ("4045550123") is not set aside.
 */
export function findFullNumber(raw: string): PrivacyReason | null {
  const text = normalizeForScan(raw);
  const { masked, hidesCard } = setPhonesAside(text);
  if (hidesCard || holdsCard(masked)) return "full_number";
  if (SSN_RE.test(text)) return "ssn";
  const run = digitRuns(maskWellFormed(masked)).find((d) => d.length >= MIN_BARE_RUN);
  if (run === undefined) return null;
  return run.length === MIN_BARE_RUN ? "ssn" : "full_number";
}

/** True when text (a free-text field) contains a full account, card, or SSN shape. */
export function looksLikeFullNumber(text: string) {
  return findFullNumber(text) !== null;
}

/*
 * Labels and values. A label counts when a separator comes right after it:
 * ":" or "=" (after spaces or "#": "password : x", "PIN #: 1234"), or a dash
 * with a space on one side ("password - x", "password -- x", "Password — x",
 * "password -> x"; not "password-protected"). The whole run of separators
 * after it is skipped ("password:: x", "password := x", "password => x",
 * "password: - x", "password: * x", "Password: — x") and the first token
 * after that is the value, so punctuation can never stand in for one.
 * Labels are matched after foldConfusables, so "раssword" (Cyrillic р and а)
 * is "password".
 */
const DASHES = "\\-\\u2010-\\u2015\\u2212";
const SEPARATORS = `\\s:=#*.,;~|>${DASHES}`;
const COLON_MARK = "[ \\t#]*[:=]";
const DASH_MARK = `[ \\t]+[${DASHES}]|[${DASHES}]+>?[ \\t]`;
const labelledValueRe = (label: string, mark: string) =>
  new RegExp(`${label}(?=${mark})[${SEPARATORS}]*([^${SEPARATORS}]\\S*)`, "gi");

/**
 * Labels that name a credential outright. A value after one is blocked,
 * unless it is a pointer ("Password: in the family vault").
 */
const CREDENTIAL_LABELS =
  "password|passwd|passcode|pin(?: code| number)?|secret|security answers?|(?:2fa )?backup codes?|2fa codes?";
const CREDENTIAL_RES = [
  labelledValueRe(`\\b(?:${CREDENTIAL_LABELS})`, `${COLON_MARK}|${DASH_MARK}`),
  /*
   * "Pass: x", but only with ":" or "=" and with no word just before it:
   * "Boarding pass: Delta app", "Season pass - June", "Passport: x", and
   * "bypass: x" are ordinary text.
   */
  labelledValueRe("(?<![a-z][ \\t]*)\\bpass", COLON_MARK),
];
/** Softer labels, and any label with "#" alone, only warn. */
const SECRET_LABELS =
  "password|passwd|pwd|passcode|passphrase|pin(?: code| number)?|secret|security (?:code|answer)|seed phrase|recovery (?:phrase|code)|backup codes?|cvv|cvc|otp";
const LABEL_WITH_VALUE_RE = labelledValueRe(`\\b(?:${SECRET_LABELS})`, `[ \\t]*[:=#]|${DASH_MARK}`);
/** "Recovery codes: in the fire safe" is a pointer, which is what we want. */
const NOT_A_VALUE = new Set([
  "in", "at", "on", "inside", "kept", "stored", "see", "ask", "printed",
  "written", "saved", "held", "via", "under", "located", "lives",
  "none", "n/a", "tbd", "unknown",
]);
const LABEL_IS_RE = new RegExp(`\\b(?:${SECRET_LABELS})\\s+(?:is|was)\\s+(["']?)(\\S+)`, "i");
const CODE_DIGITS_RE = /\b(?:pin\s*#?\s*\d{4,8}|cv[vc]2?\s*#?\s*\d{3,4})\b/i;

const EDGE_PUNCT_RE = /^[("'[{<]+|[)"'\]}>.,;:!?]+$/g;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
const URL_RE = /^(?:https?:\/\/|www\.)/i;
const DOMAIN_RE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,24}(?:\/\S*)?$/;

/** Shannon entropy in bits per character. */
export function entropyPerChar(text: string) {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * A single no-space token that reads like a password or API key: 8+ chars
 * mixing letters and digits with mixed case or a symbol, or a 20+ char
 * high-entropy letters-and-digits token. Emails, URLs, and domains are left
 * alone.
 */
export function looksLikeSecretToken(raw: string) {
  const token = raw.replace(EDGE_PUNCT_RE, "");
  if (token.length < 8) return false;
  if (EMAIL_RE.test(token) || URL_RE.test(token) || DOMAIN_RE.test(token)) return false;
  const letters = /[A-Za-z]/.test(token);
  const digits = /\d/.test(token);
  if (!letters || !digits) return false;
  const mixedCase = /[a-z]/.test(token) && /[A-Z]/.test(token);
  const symbol = /[^A-Za-z0-9]/.test(token);
  const entropy = entropyPerChar(token);
  if ((mixedCase || symbol) && entropy >= 2.5) return true;
  // Same-case letters and digits only (e.g. a hex API key): needs length and spread.
  return token.length >= 20 && entropy >= 3.5;
}

/** True when some "label: value" match carries a real value, not a pointer or blank. */
function hasLabelledValue(re: RegExp, text: string) {
  return [...text.matchAll(re)].some(([, raw]) => {
    const value = raw.replace(EDGE_PUNCT_RE, "").toLowerCase();
    return /[\p{L}\p{N}]/u.test(value) && !NOT_A_VALUE.has(value);
  });
}

function hasSecretLabel(text: string) {
  if (hasLabelledValue(LABEL_WITH_VALUE_RE, text)) return true;
  if (CODE_DIGITS_RE.test(text)) return true;
  const is = LABEL_IS_RE.exec(text);
  if (!is) return false;
  const value = is[2].replace(EDGE_PUNCT_RE, "");
  return is[1] !== "" || /[\d\W_]/.test(value);
}

/**
 * Cyrillic and Greek letters that look like Latin ones, each above the Latin
 * letter it passes for (plus Latin alpha and dotless i). One code unit for
 * one, so offsets do not move.
 */
const CONFUSABLES = "асԁеһіјкорԛѕԝхуАВСЕНІЈКМОРЅТХԜαικνορυΑΒΕΖΗΙΚΜΝΟΡΤΥΧɑı";
const LOOKS_LIKE = "acdehijkopqswxyABCEHIJKMOPSTXWaikvopuABEZHIKMNOPTYXai";
const CONFUSABLE_RE = new RegExp(`[${CONFUSABLES}]`, "g");

/** Each look-alike letter in CONFUSABLES replaced by the Latin letter it passes for. */
export function foldConfusables(text: string) {
  return text.replace(CONFUSABLE_RE, (ch) => LOOKS_LIKE[CONFUSABLES.indexOf(ch)]);
}

/** The strongest finding for a piece of free text, or null when it looks fine. */
export function scanText(raw: string): PrivacyFinding | null {
  const full = findFullNumber(raw);
  if (full) return { level: "block", reason: full, message: FULL_NUMBER_ERROR };
  const text = normalizeForScan(raw);
  const labels = foldConfusables(text);
  if (CREDENTIAL_RES.some((re) => hasLabelledValue(re, labels))) {
    return { level: "block", reason: "credential", message: CREDENTIAL_ERROR };
  }
  if (hasSecretLabel(labels)) return { level: "warn", reason: "secret_label", message: SECRET_WARNING };
  if (text.split(/\s/).some(looksLikeSecretToken)) {
    return { level: "warn", reason: "secret_token", message: SECRET_WARNING };
  }
  return null;
}

/** The block-level finding the server enforces, or null (warnings are allowed). */
export function findBlocked(text: string): PrivacyFinding | null {
  const finding = scanText(text);
  return finding?.level === "block" ? finding : null;
}

/**
 * Last-4, email, and phone fields have their own strict format, so the
 * secret-looking heuristics (which would trip on an email address) are
 * skipped. They still get the block-level checks: a card number is a card
 * number in any field.
 */
const FORMAT_KINDS = new Set(["last4", "email", "phone"]);

export function scanField(kind: string, value: string): PrivacyFinding | null {
  return FORMAT_KINDS.has(kind) ? findBlocked(value) : scanText(value);
}

/**
 * Findings that should hold an autosave, by field name. Block-level findings
 * always hold. A warn-level finding holds until the person confirms that
 * exact value is not a secret (confirmed[name] === value); editing the field
 * again re-checks it.
 */
export function pendingFindings(
  fields: readonly { name: string; kind: string }[],
  values: Record<string, string | undefined>,
  confirmed: Record<string, string>,
): Record<string, PrivacyFinding> {
  const out: Record<string, PrivacyFinding> = {};
  for (const { name, kind } of fields) {
    const value = values[name];
    if (!value) continue;
    const finding = scanField(kind, value);
    if (!finding) continue;
    if (finding.level === "warn" && confirmed[name] === value) continue;
    out[name] = finding;
  }
  return out;
}
