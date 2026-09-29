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

export type PrivacyLevel = "block" | "warn";
export type PrivacyReason = "full_number" | "ssn" | "credential" | "secret_label" | "secret_token";
export type PrivacyFinding = { level: PrivacyLevel; reason: PrivacyReason; message: string };

export const FULL_NUMBER_ERROR =
  "This looks like a full account, card, or ID number. Store the last 4 digits at most.";

export const CREDENTIAL_ERROR =
  "This is labelled as a password, PIN, or other credential. Write down where it is kept, never the value itself.";

export const SECRET_WARNING =
  "This looks like a password, PIN, or other secret. Keep it in your password manager and write down where it lives instead.";

const SSN_RE = /(?<!\d)\d{3}[- ]\d{2}[- ]\d{4}(?!\d)/;
const DIGIT_RUN_RE = /\d+(?:[ -]\d+)*/g;
const LONG_RUN_RE = /\d{9,}/g;

/** 10 digits, or 11 starting with 1, reads as a phone number, not an account. */
function isPhoneShaped(run: string) {
  return run.length === 10 || (run.length === 11 && run.startsWith("1"));
}

/**
 * 13 to 19 digits written as groups joined by single spaces or dashes, where
 * every group but the last has at least 4 digits (4-4-4-4 cards, 4-6-5 Amex,
 * long account numbers). Phone numbers use 3-digit groups, so a pair of them
 * side by side does not match.
 */
function hasGroupedCardNumber(text: string) {
  return [...text.matchAll(DIGIT_RUN_RE)].some(([run]) => {
    const groups = run.split(/[ -]/);
    return groups.some((_, start) => {
      let digits = 0;
      for (const group of groups.slice(start)) {
        digits += group.length;
        if (digits >= 13 && digits <= 19) return true;
        if (group.length < 4) return false;
      }
      return false;
    });
  });
}

/** Full account, card, or SSN shapes. */
export function findFullNumber(text: string): PrivacyReason | null {
  if (SSN_RE.test(text)) return "ssn";
  for (const run of text.match(LONG_RUN_RE) ?? []) {
    if (!isPhoneShaped(run)) return run.length === 9 ? "ssn" : "full_number";
  }
  return hasGroupedCardNumber(text) ? "full_number" : null;
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
export function scanText(text: string): PrivacyFinding | null {
  const full = findFullNumber(text);
  if (full) return { level: "block", reason: full, message: FULL_NUMBER_ERROR };
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

/** Field kinds with their own strict format are not scanned. */
const UNSCANNED_KINDS = new Set(["last4", "email", "phone"]);

export function scanField(kind: string, value: string): PrivacyFinding | null {
  return UNSCANNED_KINDS.has(kind) ? null : scanText(value);
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
