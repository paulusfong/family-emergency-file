import { ENTRY_TYPES, type EntryType } from "./schema";
import { CREDENTIAL_ERROR, FULL_NUMBER_ERROR, findBlocked } from "./privacy-warn";

export type FieldKind = "text" | "textarea" | "last4" | "phone" | "email";

export type FieldDef = {
  name: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  hint?: string;
};

export type EntryTypeDef = {
  type: EntryType;
  title: string;
  labelField: { label: string; placeholder: string };
  fields: readonly FieldDef[];
};

const NOTES: FieldDef = { name: "notes", label: "Notes", kind: "textarea" };
const WHO_TO_CALL: FieldDef = {
  name: "whoToCall",
  label: "Who to call",
  kind: "text",
  placeholder: "Branch, agent, or phone line",
};

/**
 * Metadata-only field sets. There is deliberately no field for a password,
 * PIN, security answer, or a full account, card, policy, or SSN number: the
 * most a number field accepts is its last 4 digits.
 */
export const ENTRY_TYPE_DEFS: Record<EntryType, EntryTypeDef> = {
  contact: {
    type: "contact",
    title: "Contact",
    labelField: { label: "Name", placeholder: "Example: Pat Example" },
    fields: [
      { name: "relationship", label: "Relationship", kind: "text", placeholder: "Sister, neighbor, friend" },
      { name: "role", label: "Role", kind: "text", placeholder: "Executor, attorney, CPA, HR" },
      { name: "phone", label: "Phone", kind: "phone" },
      { name: "email", label: "Email", kind: "email" },
      NOTES,
    ],
  },
  account: {
    type: "account",
    title: "Account",
    labelField: { label: "Account nickname", placeholder: "Example: Joint checking" },
    fields: [
      { name: "institution", label: "Institution", kind: "text", placeholder: "Example Bank" },
      { name: "accountType", label: "Account type", kind: "text", placeholder: "Checking, savings, 401(k), card" },
      {
        name: "last4",
        label: "Last 4 digits (optional)",
        kind: "last4",
        hint: "Only the last 4. Never the full number.",
      },
      { name: "ownership", label: "Ownership", kind: "text", placeholder: "Joint, solo, beneficiary named" },
      { name: "whereToFind", label: "Where to find statements", kind: "text", placeholder: "Paper file, email, online" },
      {
        name: "accessPlan",
        label: "Access plan",
        kind: "textarea",
        hint: "How a helper gets access, like which password manager holds the login. Not the password itself.",
      },
      WHO_TO_CALL,
      NOTES,
    ],
  },
  policy: {
    type: "policy",
    title: "Policy",
    labelField: { label: "Policy name", placeholder: "Example: Term life" },
    fields: [
      { name: "institution", label: "Insurance company", kind: "text", placeholder: "Example Mutual" },
      { name: "policyType", label: "Coverage type", kind: "text", placeholder: "Life, health, home, auto" },
      {
        name: "last4",
        label: "Policy number, last 4 (optional)",
        kind: "last4",
        hint: "Only the last 4. The full number stays on the policy papers.",
      },
      { name: "whereToFind", label: "Where the policy is kept", kind: "text", placeholder: "Fire safe, insurer website" },
      { ...WHO_TO_CALL, label: "Agent or claims line", placeholder: "Agent name or claims phone" },
      NOTES,
    ],
  },
  document_location: {
    type: "document_location",
    title: "Document location",
    labelField: { label: "Document", placeholder: "Example: Will" },
    fields: [
      { name: "whereToFind", label: "Where the original is", kind: "text", placeholder: "Fire safe, attorney's office" },
      { name: "digitalCopy", label: "Where a digital copy is", kind: "text", placeholder: "Shared drive folder name" },
      { ...WHO_TO_CALL, placeholder: "Who holds it or can release it" },
      NOTES,
    ],
  },
  access_plan: {
    type: "access_plan",
    title: "Access plan",
    labelField: { label: "Account or service", placeholder: "Example: Family email" },
    fields: [
      { name: "provider", label: "Provider", kind: "text", placeholder: "Example Mail, Example Mobile, Example Cloud" },
      {
        name: "loginLocation",
        label: "Where the login lives",
        kind: "text",
        placeholder: "Family vault in Example Password Manager",
        hint: "Name the password manager or sealed envelope that holds it. Never the password itself.",
      },
      {
        name: "recoveryPlan",
        label: "Recovery and emergency access",
        kind: "textarea",
        hint: "Who can get in and how: the emergency-access contact, and where the recovery kit or backup codes are kept.",
      },
      { ...WHO_TO_CALL, placeholder: "The provider's support line or a trusted helper" },
      NOTES,
    ],
  },
  note: {
    type: "note",
    title: "Note",
    labelField: { label: "Title", placeholder: "Example: Tell them this first" },
    fields: [{ ...NOTES, label: "Note" }],
  },
};

export const LIMITS = { label: 120, text: 200, textarea: 2000 } as const;

export { CREDENTIAL_ERROR, FULL_NUMBER_ERROR };

export type EntryValues = Record<string, string>;
export type FieldErrors = Record<string, string>;

export type SaveEntryInput = {
  sectionKey: string;
  entryType: string;
  entryId: string | null;
  values: unknown;
};

export type SaveEntryResult =
  | { ok: true; entryId: string }
  | { ok: false; status: 400 | 404 | 500; error: string; fieldErrors?: FieldErrors };

export function isEntryType(value: unknown): value is EntryType {
  return (ENTRY_TYPES as readonly unknown[]).includes(value);
}

/** Block-level privacy message (full number or labelled credential), else null. */
function blockedError(value: string) {
  return findBlocked(value)?.message ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().x-]{7,30}$/;

function limitFor(kind: FieldKind) {
  return kind === "textarea" ? LIMITS.textarea : LIMITS.text;
}

function checkField(def: FieldDef, value: string): string | null {
  if (value.length > limitFor(def.kind)) return `Keep this under ${limitFor(def.kind)} characters.`;
  if (def.kind === "last4") {
    return /^\d{4}$/.test(value) ? null : "Enter exactly 4 digits, or leave it blank.";
  }
  if (def.kind === "email") return EMAIL_RE.test(value) ? null : "Enter a valid email address.";
  if (def.kind === "phone") {
    return PHONE_RE.test(value) ? null : "Enter a phone number using digits, spaces, and + ( ) - only.";
  }
  return blockedError(value);
}

export type ValidatedEntry =
  | { ok: true; label: string; payload: EntryValues }
  | { ok: false; fieldErrors: FieldErrors };

/**
 * Server-side validation. Accepts only the known fields for the type, trims
 * them, drops blanks, and rejects block-level privacy findings (full numbers
 * and labelled credentials). Warn-level findings are allowed.
 */
export function validateEntry(type: EntryType, raw: unknown): ValidatedEntry {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const def = ENTRY_TYPE_DEFS[type];
  const fieldErrors: FieldErrors = {};

  const read = (name: string) => {
    const v = input[name];
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") {
      fieldErrors[name] = "Invalid value.";
      return "";
    }
    return v.trim();
  };

  const label = read("label");
  if (!fieldErrors.label) {
    if (!label) fieldErrors.label = `${def.labelField.label} is required.`;
    else if (label.length > LIMITS.label) fieldErrors.label = `Keep this under ${LIMITS.label} characters.`;
    else {
      const blocked = blockedError(label);
      if (blocked) fieldErrors.label = blocked;
    }
  }

  const payload: EntryValues = {};
  for (const field of def.fields) {
    const value = read(field.name);
    if (!value) continue;
    const error = checkField(field, value);
    if (error) fieldErrors[field.name] = error;
    else payload[field.name] = value;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, label, payload };
}

/** Parse stored payload JSON, keeping only this type's known string fields. */
export function readPayload(type: EntryType, json: string): EntryValues {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Malformed JSON reads as an empty payload.
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const out: EntryValues = {};
  for (const field of ENTRY_TYPE_DEFS[type].fields) {
    const v = obj[field.name];
    if (typeof v === "string" && v) out[field.name] = v;
  }
  return out;
}

/** One short line for the section list, e.g. "Example Bank · Checking · ••0000". */
export function entrySummary(type: EntryType, payload: EntryValues) {
  const parts: string[] = [];
  const add = (v: string | undefined) => {
    if (v) parts.push(v);
  };
  switch (type) {
    case "contact":
      add(payload.relationship);
      add(payload.role);
      add(payload.phone);
      break;
    case "account":
    case "policy":
      add(payload.institution);
      add(payload.accountType ?? payload.policyType);
      if (payload.last4) parts.push(`••${payload.last4}`);
      break;
    case "document_location":
      add(payload.whereToFind);
      break;
    case "access_plan":
      add(payload.provider);
      add(payload.loginLocation);
      break;
    case "note":
      if (payload.notes) {
        const first = payload.notes.split("\n")[0];
        parts.push(first.length > 80 ? `${first.slice(0, 79)}…` : first);
      }
      break;
  }
  return parts.join(" · ");
}
