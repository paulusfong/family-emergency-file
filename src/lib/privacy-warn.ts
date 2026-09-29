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
 * Full numbers. The text is normalized first (NFKC, so fullwidth digits become
 * ASCII; zero-width characters removed; every decimal digit mapped to 0-9). A
 * "run" is digits joined across separators, so "4111 - 1111_1111\t1111" is one
 * 16-digit run. Anything that is not a letter or a digit is a separator, and so
 * is an extension marker ("x", "ext") on its own. Other letters end a run,
 * except in the loose runs used for the Luhn and SSN checks, where a single
 * letter between digit groups ("4111a1111b1111c1111") is a separator too. A
 * word of two or more letters ends every run, so VINs, serials, and policy IDs
 * ("1HGCM82633A004352", "HO3-4471-AZ") do not join into long numbers.
 */
const ZERO_WIDTH_RE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const DIGIT_RE = /\p{Nd}/gu;
const SEP = "[^\\p{L}0-9]|(?:x|ext)(?!\\p{L})";
const LOOSE_SEP = "[^\\p{L}0-9]|(?:\\p{L}|ext)(?!\\p{L})";
const runRe = (sep: string) => new RegExp(`[0-9](?:(?:${sep})*[0-9])*`, "giu");
const RUN_RE = runRe(SEP);
const LOOSE_RUN_RE = runRe(LOOSE_SEP);
const NON_DIGIT_RE = /[^0-9]/g;
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
/** A VIN: 17 letters and digits, no I, O, or Q, with at least one letter (17 bare digits stay blocked). */
const VIN_RE = /(?<![\p{L}0-9])(?=[0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}(?![\p{L}0-9])/giu;
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

/** NFKC, zero-width characters removed, every decimal digit written 0-9. */
export function normalizeForScan(text: string) {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(DIGIT_RE, (d) => String(digitValue(d)));
}

/** Digit strings of each run (digits joined across separators). */
function digitRuns(text: string, re = RUN_RE) {
  return [...text.matchAll(re)].map(([run]) => run.replace(NON_DIGIT_RE, ""));
}

/** True when a loose run (single letters count as separators) is a Luhn-valid card number. */
function holdsCard(text: string) {
  return digitRuns(text, LOOSE_RUN_RE).some(isLuhnCard);
}

function maskUnlessCard(token: string) {
  return holdsCard(token) ? token : MASK;
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

/** Sets aside formatted phones, dates, ZIP+4s, amounts, year lists, and VINs so they do not join into a run. */
function maskWellFormed(text: string) {
  let out = text;
  // Phones are overwritten with letters of the same length, so later offsets still line up.
  for (const { startsAt, endsAt } of findPhoneNumbersInText(text, { defaultCountry: "US" })) {
    const phone = text.slice(startsAt, endsAt);
    if (isFormattedPhone(phone) && !holdsCard(phone)) {
      out = out.slice(0, startsAt) + "Z".repeat(phone.length) + out.slice(endsAt);
    }
  }
  for (const re of [DATE_RE, ZIP4_RE, AMOUNT_RE, YEAR_LIST_RE, VIN_RE]) out = out.replace(re, maskUnlessCard);
  return out;
}

/**
 * Full account, card, or SSN shapes, the same in every field (phone and
 * email included), in order:
 * 1. any 13-19 digit loose run that passes Luhn, with no exemptions;
 * 2. an SSN layout (3-2-4 digits; any separators, single letters included);
 * 3. once well-formed tokens are set aside (formatted valid phones, dates,
 *    ZIP+4s, amounts, year lists, VINs; none of them Luhn-valid), any run of
 *    9+ digits. A phone written as a bare run ("4045550123") is not set aside.
 */
export function findFullNumber(raw: string): PrivacyReason | null {
  const text = normalizeForScan(raw);
  if (holdsCard(text)) return "full_number";
  if (SSN_RE.test(text)) return "ssn";
  const run = digitRuns(maskWellFormed(text)).find((d) => d.length >= MIN_BARE_RUN);
  if (run === undefined) return null;
  return run.length === MIN_BARE_RUN ? "ssn" : "full_number";
}

/** True when text (a free-text field) contains a full account, card, or SSN shape. */
export function looksLikeFullNumber(text: string) {
  return findFullNumber(text) !== null;
}

/**
 * Labels that name a credential outright. "label: value" or "label=value" is
 * blocked, unless the value is a pointer ("Password: in the family vault").
 */
const CREDENTIAL_LABELS =
  "password|passwd|passcode|pin(?: code| number)?|secret|security answers?|(?:2fa )?backup codes?|2fa codes?";
const CREDENTIAL_RE = new RegExp(`\\b(?:${CREDENTIAL_LABELS})\\s*[:=]\\s*(\\S+)`, "gi");
/** Softer labels, and any label with "#", only warn. */
const SECRET_LABELS =
  "password|passwd|pwd|passcode|passphrase|pin(?: code| number)?|secret|security (?:code|answer)|seed phrase|recovery (?:phrase|code)|backup codes?|cvv|cvc|otp";
const LABEL_WITH_VALUE_RE = new RegExp(`\\b(?:${SECRET_LABELS})\\s*[:=#]\\s*(\\S+)`, "gi");
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

/** The strongest finding for a piece of free text, or null when it looks fine. */
export function scanText(raw: string): PrivacyFinding | null {
  const full = findFullNumber(raw);
  if (full) return { level: "block", reason: full, message: FULL_NUMBER_ERROR };
  const text = normalizeForScan(raw);
  if (hasLabelledValue(CREDENTIAL_RE, text)) return { level: "block", reason: "credential", message: CREDENTIAL_ERROR };
  if (hasSecretLabel(text)) return { level: "warn", reason: "secret_label", message: SECRET_WARNING };
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
