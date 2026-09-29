import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENTRY_TYPE_DEFS,
  FULL_NUMBER_ERROR,
  LIMITS,
  entrySummary,
  isEntryType,
  readPayload,
  validateEntry,
} from "./entry-fields";
import { ENTRY_TYPES } from "./schema";

const FORBIDDEN = /password|passcode|\bpin\b|cvv|security (code|answer)|seed phrase|full (account|card|policy)|ssn|social security/i;

describe("entry field definitions", () => {
  it("defines every entry type with a title, label field, and fields", () => {
    assert.deepEqual(Object.keys(ENTRY_TYPE_DEFS), [...ENTRY_TYPES]);
    for (const t of ENTRY_TYPES) {
      const def = ENTRY_TYPE_DEFS[t];
      assert.equal(def.type, t);
      assert.ok(def.title.length > 0);
      assert.ok(def.labelField.label.length > 0);
      assert.ok(def.labelField.placeholder.length > 0);
      assert.ok(def.fields.length > 0);
      assert.equal(new Set(def.fields.map((f) => f.name)).size, def.fields.length);
      for (const f of def.fields) {
        assert.ok(f.label.length > 0, `${t}.${f.name} has a label`);
        assert.notEqual(f.name, "label");
      }
    }
  });

  it("never asks for a password, PIN, or full number (names and labels)", () => {
    for (const def of Object.values(ENTRY_TYPE_DEFS)) {
      for (const f of def.fields) {
        assert.doesNotMatch(f.name, FORBIDDEN, `${def.type}.${f.name}`);
        assert.doesNotMatch(f.label, FORBIDDEN, `${def.type}.${f.label}`);
      }
      assert.doesNotMatch(def.labelField.label, FORBIDDEN);
    }
  });

  it("captures the PRD metadata per type", () => {
    const names = (t: keyof typeof ENTRY_TYPE_DEFS) => ENTRY_TYPE_DEFS[t].fields.map((f) => f.name);
    assert.deepEqual(names("contact"), ["relationship", "role", "phone", "email", "notes"]);
    assert.deepEqual(names("account"), [
      "institution",
      "accountType",
      "last4",
      "ownership",
      "whereToFind",
      "accessPlan",
      "whoToCall",
      "notes",
    ]);
    assert.deepEqual(names("policy"), ["institution", "policyType", "last4", "whereToFind", "whoToCall", "notes"]);
    assert.deepEqual(names("document_location"), ["whereToFind", "digitalCopy", "whoToCall", "notes"]);
    assert.deepEqual(names("access_plan"), ["provider", "loginLocation", "recoveryPlan", "whoToCall", "notes"]);
    assert.deepEqual(names("note"), ["notes"]);
    const plan = Object.fromEntries(ENTRY_TYPE_DEFS.access_plan.fields.map((f) => [f.name, f]));
    assert.equal(plan.recoveryPlan.kind, "textarea");
    assert.equal(plan.loginLocation.kind, "text");
    assert.match(plan.loginLocation.hint!, /Never the password itself/);
    assert.match(plan.recoveryPlan.hint!, /recovery kit or backup codes/);
    assert.equal(ENTRY_TYPE_DEFS.access_plan.title, "Access plan");
    const kinds = Object.fromEntries(ENTRY_TYPE_DEFS.account.fields.map((f) => [f.name, f.kind]));
    assert.equal(kinds.last4, "last4");
    assert.equal(kinds.accessPlan, "textarea");
    assert.equal(kinds.notes, "textarea");
    assert.equal(kinds.institution, "text");
    const contactKinds = Object.fromEntries(ENTRY_TYPE_DEFS.contact.fields.map((f) => [f.name, f.kind]));
    assert.equal(contactKinds.phone, "phone");
    assert.equal(contactKinds.email, "email");
    assert.equal(ENTRY_TYPE_DEFS.policy.fields.find((f) => f.name === "last4")?.kind, "last4");
    assert.equal(ENTRY_TYPE_DEFS.policy.fields.find((f) => f.name === "whoToCall")?.label, "Agent or claims line");
    assert.equal(ENTRY_TYPE_DEFS.note.fields[0].label, "Note");
    assert.equal(ENTRY_TYPE_DEFS.note.fields[0].kind, "textarea");
  });

  it("gives every field that shows helper copy a non-empty placeholder or hint", () => {
    const withCopy: string[] = [];
    for (const t of ENTRY_TYPES) {
      for (const f of ENTRY_TYPE_DEFS[t].fields) {
        for (const key of ["placeholder", "hint"] as const) {
          const copy = f[key];
          if (copy === undefined) continue;
          assert.ok(copy.trim().length >= 8, `${t}.${f.name}.${key} is too short: "${copy}"`);
          withCopy.push(`${t}.${f.name}.${key}`);
        }
      }
    }
    for (const expected of [
      "contact.relationship.placeholder",
      "contact.role.placeholder",
      "account.institution.placeholder",
      "account.accountType.placeholder",
      "account.ownership.placeholder",
      "account.whereToFind.placeholder",
      "account.accessPlan.hint",
      "account.whoToCall.placeholder",
      "policy.institution.placeholder",
      "policy.policyType.placeholder",
      "policy.last4.hint",
      "policy.whereToFind.placeholder",
      "policy.whoToCall.placeholder",
      "document_location.whereToFind.placeholder",
      "document_location.digitalCopy.placeholder",
      "document_location.whoToCall.placeholder",
      "access_plan.provider.placeholder",
      "access_plan.loginLocation.placeholder",
      "access_plan.loginLocation.hint",
      "access_plan.recoveryPlan.hint",
      "access_plan.whoToCall.placeholder",
    ]) {
      assert.ok(withCopy.includes(expected), `missing helper copy: ${expected}`);
    }
    assert.match(ENTRY_TYPE_DEFS.account.fields.find((f) => f.name === "accessPlan")!.hint!, /not the password/i);
    assert.match(ENTRY_TYPE_DEFS.policy.fields.find((f) => f.name === "last4")!.hint!, /last 4/i);
  });

  it("recognises entry types", () => {
    for (const t of ENTRY_TYPES) assert.equal(isEntryType(t), true);
    assert.equal(isEntryType("password"), false);
    assert.equal(isEntryType(undefined), false);
    assert.equal(isEntryType(1), false);
  });
});

describe("validateEntry", () => {
  it("trims, keeps known non-blank fields, and drops unknown ones", () => {
    const res = validateEntry("account", {
      label: "  Joint checking ",
      institution: " Example Bank ",
      accountType: "Checking",
      last4: "0000",
      ownership: "   ",
      password: "hunter2",
      pin: "1234",
    });
    assert.deepEqual(res, {
      ok: true,
      label: "Joint checking",
      payload: { institution: "Example Bank", accountType: "Checking", last4: "0000" },
    });
  });

  it("requires the label with a type-specific message", () => {
    assert.deepEqual(validateEntry("contact", { label: "  " }), {
      ok: false,
      fieldErrors: { label: "Name is required." },
    });
    assert.deepEqual(validateEntry("account", {}), {
      ok: false,
      fieldErrors: { label: "Account nickname is required." },
    });
  });

  it("treats a non-object payload as empty", () => {
    for (const raw of [null, undefined, "x", 3]) {
      assert.deepEqual(validateEntry("note", raw), { ok: false, fieldErrors: { label: "Title is required." } });
    }
  });

  it("rejects non-string values", () => {
    assert.deepEqual(validateEntry("note", { label: 5, notes: ["x"] }), {
      ok: false,
      fieldErrors: { label: "Invalid value.", notes: "Invalid value." },
    });
    assert.deepEqual(validateEntry("note", { label: "Ok", notes: null }), {
      ok: true,
      label: "Ok",
      payload: {},
    });
  });

  it("enforces length limits", () => {
    assert.equal(LIMITS.label, 120);
    assert.equal(LIMITS.text, 200);
    assert.equal(LIMITS.textarea, 2000);
    const ok = validateEntry("account", {
      label: "a".repeat(120),
      institution: "b".repeat(200),
      notes: "c".repeat(2000),
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(
      validateEntry("account", {
        label: "a".repeat(121),
        institution: "b".repeat(201),
        notes: "c".repeat(2001),
      }),
      {
        ok: false,
        fieldErrors: {
          label: "Keep this under 120 characters.",
          institution: "Keep this under 200 characters.",
          notes: "Keep this under 2000 characters.",
        },
      },
    );
  });

  it("accepts only exactly four digits for last-4 fields", () => {
    for (const last4 of ["123", "12345", "12a4", "1234 "]) {
      const res = validateEntry("policy", { label: "Term life", last4: last4 === "1234 " ? "12 34" : last4 });
      assert.deepEqual(res, {
        ok: false,
        fieldErrors: { last4: "Enter exactly 4 digits, or leave it blank." },
      });
    }
    assert.deepEqual(validateEntry("policy", { label: "Term life", last4: " 4321 " }), {
      ok: true,
      label: "Term life",
      payload: { last4: "4321" },
    });
  });

  it("validates contact email and phone", () => {
    assert.deepEqual(
      validateEntry("contact", { label: "Pat", email: "pat@example", phone: "call me" }),
      {
        ok: false,
        fieldErrors: {
          email: "Enter a valid email address.",
          phone: "Enter a phone number using digits, spaces, and + ( ) - only.",
        },
      },
    );
    assert.equal(validateEntry("contact", { label: "Pat", phone: "12345" }).ok, false);
    assert.equal(validateEntry("contact", { label: "Pat", phone: "555 1234 x" }).ok, true);
    assert.equal(validateEntry("contact", { label: "Pat", phone: "1".repeat(31) }).ok, false);
    assert.equal(validateEntry("contact", { label: "Pat", email: "a b@example.com" }).ok, false);
    assert.equal(validateEntry("contact", { label: "Pat", email: "x pat@example.com" }).ok, false);
    assert.equal(validateEntry("contact", { label: "Pat", email: "pat@example.com x" }).ok, false);
    assert.equal(validateEntry("contact", { label: "Pat", phone: "a555 123 4567" }).ok, false);
    assert.equal(validateEntry("contact", { label: "Pat", phone: "555 123 4567a" }).ok, false);
    assert.deepEqual(
      validateEntry("contact", {
        label: "Pat Example",
        email: "pat@example.com",
        phone: "+1 (555) 010-0000",
      }),
      {
        ok: true,
        label: "Pat Example",
        payload: { email: "pat@example.com", phone: "+1 (555) 010-0000" },
      },
    );
  });

  it("rejects full numbers in label and free-text fields", () => {
    assert.deepEqual(
      validateEntry("account", { label: "Acct 123456789012", notes: "card 4111 1111 1111 1111" }),
      { ok: false, fieldErrors: { label: FULL_NUMBER_ERROR, notes: FULL_NUMBER_ERROR } },
    );
    assert.deepEqual(validateEntry("note", { label: "SSN", notes: "It is 123-45-6789" }), {
      ok: false,
      fieldErrors: { notes: FULL_NUMBER_ERROR },
    });
    assert.match(FULL_NUMBER_ERROR, /last 4 digits at most/);
  });

  it("uses the shared privacy rules: phone-shaped digits pass, spaced SSNs do not", () => {
    assert.deepEqual(validateEntry("account", { label: "Joint checking", whoToCall: "Branch 8005550100" }), {
      ok: true,
      label: "Joint checking",
      payload: { whoToCall: "Branch 8005550100" },
    });
    assert.deepEqual(validateEntry("note", { label: "IDs", notes: "SSN 123 45 6789" }), {
      ok: false,
      fieldErrors: { notes: FULL_NUMBER_ERROR },
    });
  });

  it("does not block warn-level text on the server; the editor asks first", () => {
    assert.deepEqual(validateEntry("access_plan", { label: "Family email", recoveryPlan: "password: hunter2" }), {
      ok: true,
      label: "Family email",
      payload: { recoveryPlan: "password: hunter2" },
    });
  });
});

describe("readPayload", () => {
  it("keeps only known non-empty string fields", () => {
    assert.deepEqual(
      readPayload("account", JSON.stringify({ institution: "Example Bank", last4: "", extra: "x", notes: 5 })),
      { institution: "Example Bank" },
    );
  });

  it("tolerates bad JSON and non-objects", () => {
    assert.deepEqual(readPayload("note", "{nope"), {});
    assert.deepEqual(readPayload("note", "null"), {});
    assert.deepEqual(readPayload("note", '"str"'), {});
  });
});

describe("entrySummary", () => {
  it("summarises each type", () => {
    assert.equal(
      entrySummary("account", { institution: "Example Bank", accountType: "Checking", last4: "0000" }),
      "Example Bank · Checking · ••0000",
    );
    assert.equal(
      entrySummary("policy", { institution: "Example Mutual", policyType: "Term life", last4: "1234" }),
      "Example Mutual · Term life · ••1234",
    );
    assert.equal(entrySummary("account", { institution: "Example Bank" }), "Example Bank");
    assert.equal(
      entrySummary("contact", { relationship: "Sister", role: "Executor", phone: "555-0100" }),
      "Sister · Executor · 555-0100",
    );
    assert.equal(entrySummary("document_location", { whereToFind: "Fire safe" }), "Fire safe");
    assert.equal(
      entrySummary("access_plan", { provider: "Example Mail", loginLocation: "Family vault", notes: "x" }),
      "Example Mail · Family vault",
    );
    assert.equal(entrySummary("access_plan", {}), "");
    assert.equal(entrySummary("note", { notes: "First line\nsecond" }), "First line");
    assert.equal(entrySummary("note", { notes: "x".repeat(80) }), "x".repeat(80));
    assert.equal(entrySummary("note", { notes: "x".repeat(81) }), `${"x".repeat(79)}…`);
    assert.equal(entrySummary("note", {}), "");
    assert.equal(entrySummary("contact", {}), "");
  });
});
