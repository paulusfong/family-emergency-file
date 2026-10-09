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
 * separator (any run of characters that are not letters or digits) comes
 * between both pairs of groups, as printed on a card ("3845 201735 4845",
 * "3018 - 207780 - 4961", "3018/207780/4961"); a year before a phone written
 * 6-4 ("2019 770365-0135") is not one.
 */
const DINERS_RE = new RegExp(`(?<![0-9])[0-9]{4}([^\\p{L}0-9]+)[0-9]{6}\\1[0-9]{4}`, "gu");
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
 * Text with no letters (digits and separators only) has nothing that says a
 * group of digits is a ZIP, a street number, or an extension rather than part
 * of a card, so there the card check is the one from before phones were set
 * aside (2e7c80e): every loose run of the text as written, phones included,
 * is checked for a 13-19 digit Luhn number. Whatever that check blocked in
 * such text stays blocked, however the groups are separated
 * ("3018 - 207780 - 4961", "47; 3  (612) 665-8926").
 */
function legacyLetterFreeBlock(text: string) {
  return !LETTER_RE.test(text) && holdsCard(text);
}

/**
 * Full account, card, or SSN shapes, the same in every field (phone and
 * email included), in order:
 * 1. a formatted phone that hides a card (see Phones above), or a Luhn-valid
 *    card printed 4-6-4; formatted valid phones are then set aside for the
 *    checks below;
 * 2. any other 13-19 digit loose run that passes Luhn, also tried without a
 *    leading country code "1" ("1 4111 1111 1111 1111"); in text with no
 *    letters, phones are not set aside for this (legacyLetterFreeBlock);
 * 3. an SSN layout (3-2-4 digits; any separators, single letters included);
 * 4. once well-formed tokens are also set aside (dates, ZIP+4s, amounts, year
 *    lists, VINs; none of them Luhn-valid), any run of 9+ digits. A phone
 *    written as a bare run ("4045550123") is not set aside.
 */
export function findFullNumber(raw: string): PrivacyReason | null {
  const text = normalizeForScan(raw);
  const { masked, hidesCard } = setPhonesAside(text);
  if (hidesCard || holdsCard(masked) || legacyLetterFreeBlock(text)) return "full_number";
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
 * Labels and values. Labels are matched after foldForLabels: look-alike
 * letters become Latin ("раssword" with Cyrillic р and а is "password"), and
 * look-alike colons, equals signs, dashes, and arrows become ":", "=", "-",
 * and "→". A label counts when a separator comes right after it: ":" or "="
 * (after any whitespace, line breaks included, or "#": "password : x",
 * "password\n: x", "PIN #: 1234"), an arrow ("password → x", "password => x"),
 * or a dash with a space on one side ("password - x", "password -- x",
 * "Password — x", "password- x"; not "password-protected"). The value starts
 * at the first letter or digit after it: everything with neither
 * (punctuation, symbols, spaces) is skipped, so "password: / x",
 * "password: ! x", and "password:: x" all read "x", and punctuation can never
 * stand in for a value. The value is read from the text with look-alike
 * letters left as typed (see readsAsValue), so "іn" with a Cyrillic і is not
 * the pointer word "in".
 */
const COLON_MARK = "[\\s#]*[:=]";
const ARROW_MARK = "\\s*\u2192";
const DASH_MARK = "[ \\t]+-|-[ \\t]";
/** Every character that ends a line: \n, \r, \v, \f, NEL, and the Unicode line and paragraph separators. */
const BREAKS = "\\n\\r\\v\\f\\u0085\\u2028\\u2029";
/** No letter or digit before this point on its line. */
const STARTS_LINE = `(?<![\\p{L}\\p{N}][^${BREAKS}]*)`;
/**
 * At most one word before this point on its line ("Bank PIN", "Gmail
 * password"), with nothing but spaces or symbols around it.
 */
const STARTS_LINE_OR_ONE_WORD = `(?<=(?:^|[${BREAKS}])[^\\p{L}\\p{N}${BREAKS}]*(?:[\\p{L}\\p{N}]+[^\\p{L}\\p{N}${BREAKS}]+)?)`;
/** Where the value starts (group 1, captured ahead so the next label is still matched): the first letter or digit. */
const VALUE = "[^\\p{L}\\p{N}]*(?=([\\p{L}\\p{N}][\\s\\S]*))";
const labelledValueRe = (label: string, mark: string) => new RegExp(`${label}(?=${mark})${VALUE}`, "giud");

/**
 * Labels that name a credential outright. A value after one is blocked,
 * unless it is a pointer ("Password: in the family vault").
 */
const PIN = "pin(?:[ -]?(?:code|number))?";
const CREDENTIAL_LABELS = `password|passwd|passcode|${PIN}|secret|security answers?|(?:2fa )?backup codes?|2fa codes?`;
/** The value, and the label it follows (as matched). */
type ValueTest = (value: string, label: string) => boolean;
const CREDENTIAL_CHECKS: [RegExp, ValueTest][] = [
  [labelledValueRe(`\\b(?:${CREDENTIAL_LABELS})`, `${COLON_MARK}|${ARROW_MARK}|${DASH_MARK}`), readsAsValue],
  /*
   * "Pass: x", but only with ":" or "=" and with no word just before it:
   * "Boarding pass: Delta app", "Season pass - June", "Passport: x", and
   * "bypass: x" are ordinary text. With an arrow or a dash, only when it
   * starts its line ("pass - x").
   */
  [labelledValueRe("(?<![a-z][ \\t]*)\\bpass", COLON_MARK), readsAsValue],
  [labelledValueRe(`${STARTS_LINE}\\bpass`, `${ARROW_MARK}|${DASH_MARK}`), readsAsValue],
  /*
   * A label alone on its line, or after one word ("Bank PIN", "Gmail
   * password"), the value on a later line, with or without a dash before it
   * ("Password\n- hunter2", "PIN\n4821", "Bank PIN\n- 4821"). Any line break
   * counts (see BREAKS). With no separator this is also how a heading reads
   * ("Reset password\n- call the bank"), so only a secret-shaped word on the
   * value's line blocks it.
   */
  [
    labelledValueRe(`${STARTS_LINE_OR_ONE_WORD}\\b(?:${CREDENTIAL_LABELS})`, `[^\\p{L}\\p{N}${BREAKS}]*[${BREAKS}]`),
    hasSecretWord,
  ],
];
/** Softer labels, and any label with "#" alone, only warn. */
const SECRET_LABELS = `password|passwd|pwd|passcode|passphrase|${PIN}|secret|security (?:code|answer)|seed phrase|recovery (?:phrase|code)|backup codes?|cvv|cvc|otp`;
const LABEL_WITH_VALUE_RE = labelledValueRe(`\\b(?:${SECRET_LABELS})`, `[\\s#]*[:=#]|${ARROW_MARK}|${DASH_MARK}`);
const LABEL_IS_RE = new RegExp(`\\b(?:${SECRET_LABELS})\\s+(?:is|was)\\s+(["']?)(\\S+)`, "i");
const CODE_DIGITS_RE = /\b(?:pin\s*#?\s*\d{4,8}|cv[vc]2?\s*#?\s*\d{3,4})\b/i;
/**
 * Words that say where a value is ("Recovery codes: in the fire safe") or
 * that there is none. Matched as typed, in ASCII: a look-alike letter makes
 * the word a value.
 */
const NOT_A_VALUE = new Set([
  "in", "at", "on", "inside", "kept", "stored", "see", "ask", "printed",
  "written", "saved", "held", "via", "under", "located", "lives",
  "none", "n/a", "tbd", "unknown",
]);
/** Words that may come before a pointer word: "1 copy in the safe", "a note in the safe". */
const LEAD_IN_RE = /^(?:a|an|the|one|[1-9])$/i;
const LOWER_WORD_RE = /^\p{Ll}+$/u;
const LINE_BREAK_RE = /[\n\r\v\f\u0085\u2028\u2029]/;
const EDGE_SYMBOLS_RE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const LIST_MARKER_RE = /^[0-9]{1,2}[.)]$/;
/** Letters, joined by an apostrophe, ".", "/", or "-" ("Mom's", "n/a", "fire-proof", "U.S"). */
const WORD_RE = /^\p{L}+(?:['’./-]\p{L}+)*$/u;
const WORD_PART_RE = /['’./-]/u;
/** Each part of a word in lower case, upper case, or capitalized ("safe", "IRS", "Mom", "O'Brien"). */
const PLAIN_CASE_RE = /^(?:[^\p{Lu}]+|\p{Lu}[^\p{Lu}]*|[^\p{Ll}]+)$/u;
/** Letters joined by "-" only, in any case ("YubiKey-protected", "fire-proof"). */
const HYPHENATED_RE = /^\p{L}+(?:-\p{L}+)+$/u;
const YEAR_WORD_RE = /^(?:19|20)[0-9]{2}$/;
const ORDINAL_RE = /^[0-9]{1,2}(?:st|nd|rd|th)$/i;
/** Names of places people keep passwords that do not read as plain words. */
const KNOWN_NAMES = new Set(["1password", "lastpass", "keepass", "keepassxc", "nordpass", "roboform", "icloud", "iphone", "ipad", "onedrive", "yubikey"]);

/** The words among whitespace-split tokens, each without punctuation or symbols at its edges; symbol-only tokens dropped. */
function wordsOf(tokens: string[]) {
  return tokens.map((w) => w.replace(EDGE_SYMBOLS_RE, "")).filter((w) => w !== "");
}

const tokensOf = (line: string) => line.split(/\s/);

function isPointer(word: string | undefined) {
  return word !== undefined && NOT_A_VALUE.has(word.toLowerCase());
}

/**
 * A word that does not read like a secret: letters only, each part of it in
 * lower case, upper case, or capitalized; a known product name ("1Password",
 * "iCloud"); an ordinal ("2nd"); a year written before another such word ("the 2024
 * tax binder"); or an email address or URL. A domain with no digits
 * ("bank.example.com") is letters joined by "." already. Anything
 * else ("hunter2", "Hunter2!", "4821", "p@ss", "hUnTeR", a year at the end)
 * is secret-shaped.
 */
function isPlainWord(word: string, next?: string) {
  if (KNOWN_NAMES.has(word.toLowerCase()) || ORDINAL_RE.test(word)) return true;
  if (HYPHENATED_RE.test(word)) return true;
  if (WORD_RE.test(word)) return word.split(WORD_PART_RE).every((part) => PLAIN_CASE_RE.test(part));
  if (YEAR_WORD_RE.test(word)) return next !== undefined && WORD_RE.test(next);
  return EMAIL_RE.test(word) || URL_RE.test(word);
}

function allPlain(words: string[]) {
  return words.every((w, i) => isPlainWord(w, words[i + 1]));
}

/**
 * After a credential label, the value (everything from its first letter or
 * digit on) is a pointer, not a secret, when its line starts with a pointer
 * word (optionally after a lead-in: "a note in", "1 copy kept in") and every
 * word after the pointer word is plain (isPlainWord), and so is every word on
 * the next line with words ("Password: see below\nHunter2!" is a value;
 * "Password: see below\nIn the blue binder" is not). Numbers are read as
 * described under "Numbers in a pointer". Anything else is a value.
 */
/*
 * Numbers in a pointer. Before its words are read, each line has these set
 * aside as plain words:
 * - phones (the same formatted valid phones findFullNumber sets aside:
 *   "ask Aunt May (404) 555-0123");
 * - dates: "3/14", "14/3", "3/14/2024", "3/14/24", "2024-03-14",
 *   "14.03.2024", "3-14-2024", "Mar 14", "March 14th, 2024";
 * - a number right after an anchor word ("page 3", "p. 3", "box 2217",
 *   "safe #2", "no. 7"): any number when the label is not a PIN, passcode, or
 *   code, and 1-3 digits under one ("PIN: in safe #2" is a pointer, "PIN: in
 *   drawer 4821" is a value).
 * Any other number is still secret-shaped ("4821", "box 48 21": "21").
 */
const ANCHORS =
  "page|pg|p\\.|pp\\.|box|drawer|shelf|no\\.|number|unit|room|apt\\.?|suite|locker|slot|folder|binder|tab|section|ch\\.|chapter|vol\\.";
const ANCHORED_NUMBER_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(?:${ANCHORS})[ \\t]*#?|#)[ \\t]*([0-9]+)(?![\\p{L}\\p{N}])`,
  "giu",
);
const MONTH_NAME =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_WORD_RE = new RegExp(
  "(?<![\\p{L}\\p{N}]|[0-9][-/.])(?:" +
    [
      `(?:${MONTH}/${DAY}|${DAY}/${MONTH})(?:/(?:${YEAR}|[0-9]{2}))?`,
      `${YEAR}-${MONTH}-${DAY}`,
      `(?:${DAY}([-.])${MONTH}|${MONTH}([-.])${DAY})(?:\\1|\\2)${YEAR}`,
      `(?:${MONTH_NAME})\\.?[ \\t]+${DAY}(?:st|nd|rd|th)?(?:,?[ \\t]+${YEAR})?`,
    ].join("|") +
    ")(?![\\p{L}\\p{N}]|[-/.][0-9])",
  "giu",
);
/** Labels under which a short number is the secret itself. */
const CODE_LABEL_RE = /pin|passcode|code|cvv|cvc|otp/i;

/** A line's words, with phones, dates, and anchored numbers (see above) set aside as plain words. */
function lineWords(line: string, codeLabel: boolean) {
  const text = setPhonesAside(line)
    .masked.replace(DATE_WORD_RE, " date ")
    .replace(ANCHORED_NUMBER_RE, (m, digits: string) =>
      digits.length <= 3 || !codeLabel ? `${m.slice(0, -digits.length)}n` : m,
    );
  return wordsOf(tokensOf(text));
}

/** Each line of a value as its words (see lineWords). */
function linesOf(value: string, label: string) {
  const codeLabel = CODE_LABEL_RE.test(label);
  return value.split(LINE_BREAK_RE).map((line) => lineWords(line, codeLabel));
}

/** Where the pointer word is in a value's first line: first, after a lead-in, or after a lead-in and one lower-case word; -1 if none. */
function pointerAt(words: string[]) {
  if (isPointer(words[0])) return 0;
  if (!LEAD_IN_RE.test(words[0])) return -1;
  if (isPointer(words[1])) return 1;
  return isPointer(words[2]) && LOWER_WORD_RE.test(words[1]) ? 2 : -1;
}

function readsAsValue(value: string, label: string) {
  const [first, ...more] = linesOf(value, label);
  const at = pointerAt(first);
  if (at < 0) return true;
  return !allPlain(first.slice(at + 1)) || !allPlain(more.find((words) => words.length > 0) ?? []);
}

/** True when the value's line has a secret-shaped word; a list marker ("1.", "2)") first is fine. */
function hasSecretWord(value: string, label: string) {
  const line = value.split(LINE_BREAK_RE)[0];
  const marker = LIST_MARKER_RE.exec(tokensOf(line)[0]);
  return !allPlain(linesOf(marker ? line.slice(marker[0].length) : line, label)[0]);
}

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

/**
 * True when some label match (found in `labels`) carries a value by `test`,
 * read at the same offset in `plain`: the same text with look-alike letters
 * left as typed.
 */
function hasLabelledValue(re: RegExp, labels: string, plain: string, test: ValueTest) {
  return [...labels.matchAll(re)].some((m) => test(plain.slice(m.indices![1]![0]), m[0]));
}

function hasSecretLabel(text: string, plain: string) {
  if (hasLabelledValue(LABEL_WITH_VALUE_RE, text, plain, readsAsValue)) return true;
  if (CODE_DIGITS_RE.test(text)) return true;
  const is = LABEL_IS_RE.exec(text);
  if (!is) return false;
  const value = is[2].replace(EDGE_PUNCT_RE, "");
  return is[1] !== "" || /[\d\W_]/.test(value);
}

/**
 * Letters that look like Latin ones, each above the Latin letter it passes
 * for: Cyrillic and Greek look-alikes, Latin small capitals ("ᴘɪɴ"), and a
 * few other Latin letters (alpha, dotless i and j, script g, Latin iota and
 * upsilon, wynn). Text is NFKC-normalized first, so a lunate sigma ϲ arrives
 * as a final sigma ς and a rho symbol ϱ as ρ. Every letter of every label has its look-alikes here
 * ("pinсode" with a Cyrillic с, "secreτ" with a Greek tau). One code unit for
 * one, so offsets do not move.
 */
const CONFUSABLES =
  "асԁеһіјкорԛѕԝхуАВСЕНІЈКМОРЅТХԜαικνορυΑΒΕΖΗΙΚΜΝΟΡΤΥΧɑı" +
  "тгмнүҮҽѵѴѡӏӀЬτςησωγχϝϜϳɡȷɩʋƿᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢ";
const LOOKS_LIKE =
  "acdehijkopqswxyABCEHIJKMOPSTXWaikvopuABEZHIKMNOPTYXai" +
  "trmhyYevVwiIbtcnowyxfFjgjiupabcdefghijklmnoprstuvwyz";
const CONFUSABLE_RE = new RegExp(`[${CONFUSABLES}]`, "g");

/** Each look-alike letter in CONFUSABLES replaced by the Latin letter it passes for. */
export function foldConfusables(text: string) {
  return text.replace(CONFUSABLE_RE, (ch) => LOOKS_LIKE[CONFUSABLES.indexOf(ch)]);
}

/*
 * Separators that look like ":", "=", "-", or an arrow. NFKC has already made
 * fullwidth and small forms ASCII ("：", "＝", "－"); these have no such
 * mapping. Colons: ratio ∶, proportion ∷, modifier-letter and IPA colons
 * ꞉ ˸ ː, two-dot punctuation ⁚, tricolon ⁝, triple colon ⫶, APL quad colon ⍠,
 * Armenian ։, Hebrew ׃, Syriac ܃ ܄ ܅ ܆ ܇ ܈ ܉, Mongolian ᠄, Z-notation ⦂,
 * Lisu ꓽ, Bamum ꛴, Ethiopic ፡ ፥ ፦, runic ᛬.
 * Equals: ≔ ≕ ꞊ ═. Dashes: every dash punctuation character (\p{Pd}: ‐ – —
 * ― ⸺ 〜 ...), the minus signs − ˗ ⁒ ➖, hyphen bullet ⁃, swung dash ⁓, dash
 * with left upturn ⹃, the horizontal lines ⎯ ⏤, and the light and heavy
 * horizontal box-drawing lines (─ ━ ┄ ╌ ╴ ...). Arrows: the Arrows,
 * Supplemental Arrows-A/B/C, and Miscellaneous Symbols and Arrows blocks, the
 * dingbat arrows (➔ ... ➾), the right-pointing triangles ▶ ▷ ▸ ▹ ► ▻, and
 * "->" / "-->" typed out.
 */
const COLON_LIKE_RE = /[∶∷꞉˸ː⁚⁝⫶⍠։׃܃܄܅܆܇܈܉᠄⦂ꓽ꛴፡፥፦᛬]/g;
const EQUALS_LIKE_RE = /[≔≕꞊═]/g;
const DASH_LIKE_RE = /[\p{Pd}\u2212\u02D7\u2043\u2052\u2053\u2796\u2E43\u23AF\u23E4\u2500\u2501\u2504\u2505\u2508\u2509\u254C\u254D\u2574\u2576\u2578\u257A\u257C\u257E]/gu;
const ARROW_RE = /-+>|[\u2190-\u21FF\u27F0-\u27FF\u2794\u2798-\u27BF\u2900-\u297F\u2B00-\u2BFF\u25B6-\u25BB\u{1F800}-\u{1F8FF}]/gu;

/**
 * A punctuation mark or symbol that NFKC would turn into letters or digits
 * ("㏌" into "in", "№" into "No", "℡" into "TEL") is a space when labels are
 * read: a symbol never stands in for a value or a pointer word.
 */
const SYMBOL_RE = /[\p{P}\p{S}]/gu;
const LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;

function blankWordSymbols(text: string) {
  return text.replace(SYMBOL_RE, (ch) => (LETTER_OR_DIGIT_RE.test(ch.normalize("NFKC")) ? " " : ch));
}

/** Look-alike colons, equals signs, dashes, and arrows written ":", "=", "-", and "→". */
export function foldSeparators(text: string) {
  return text.replace(COLON_LIKE_RE, ":").replace(EQUALS_LIKE_RE, "=").replace(DASH_LIKE_RE, "-").replace(ARROW_RE, "\u2192");
}

/** The strongest finding for a piece of free text, or null when it looks fine. */
export function scanText(raw: string): PrivacyFinding | null {
  const full = findFullNumber(raw);
  if (full) return { level: "block", reason: full, message: FULL_NUMBER_ERROR };
  const text = normalizeForScan(raw);
  const symbolsBlanked = normalizeForScan(blankWordSymbols(raw));
  // foldConfusables maps one code unit to one, so offsets in `plain` and `labels` line up.
  const plain = foldSeparators(symbolsBlanked);
  const labels = foldSeparators(foldConfusables(symbolsBlanked));
  if (CREDENTIAL_CHECKS.some(([re, test]) => hasLabelledValue(re, labels, plain, test))) {
    return { level: "block", reason: "credential", message: CREDENTIAL_ERROR };
  }
  if (hasSecretLabel(labels, plain)) return { level: "warn", reason: "secret_label", message: SECRET_WARNING };
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
