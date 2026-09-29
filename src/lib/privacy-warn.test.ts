import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CREDENTIAL_ERROR,
  FULL_NUMBER_ERROR,
  SECRET_WARNING,
  entropyPerChar,
  findBlocked,
  findFullNumber,
  looksLikeFullNumber,
  looksLikeSecretToken,
  pendingFindings,
  scanField,
  scanText,
} from "./privacy-warn";

const level = (text: string) => scanText(text)?.level ?? null;
const reason = (text: string) => scanText(text)?.reason ?? null;

describe("findFullNumber", () => {
  it("flags SSN layouts with dashes or spaces, and bare 9-digit runs", () => {
    assert.equal(findFullNumber("123-45-6789"), "ssn");
    assert.equal(findFullNumber("ssn 123-45-6789 here"), "ssn");
    assert.equal(findFullNumber("SSN 123 45 6789"), "ssn");
    assert.equal(findFullNumber("acct 123456789"), "ssn");
  });

  it("does not read an SSN out of a longer digit string", () => {
    assert.equal(findFullNumber("1123-45-6789"), null);
    assert.equal(findFullNumber("123-45-67890"), null);
    assert.equal(findFullNumber("x123-45-67890"), null);
  });

  it("flags long digit runs that are not phone-shaped", () => {
    assert.equal(findFullNumber("1234567890123"), "full_number");
    assert.equal(findFullNumber("acct 123456789012"), "full_number");
    assert.equal(findFullNumber("21234567890"), "full_number");
  });

  it("treats 10 digits, or 11 starting with 1, as a phone number", () => {
    assert.equal(findFullNumber("8005550100"), null);
    assert.equal(findFullNumber("18005550100"), null);
    assert.equal(findFullNumber("5550100000 5550100001"), null);
    assert.equal(findFullNumber("call 8005550100 then 123456789"), "ssn");
  });

  it("flags grouped card and account numbers of 13 to 19 digits", () => {
    assert.equal(findFullNumber("4111 1111 1111 1111"), "full_number");
    assert.equal(findFullNumber("4111-1111-1111-1"), "full_number");
    assert.equal(findFullNumber("3782 822463 10005"), "full_number");
    assert.equal(findFullNumber("acct 12345 67890 123"), "full_number");
    assert.equal(findFullNumber("see 4111 1111 1111 1111 1111"), "full_number");
    assert.equal(findFullNumber("800 555 0100 4111 1111 1111 1111"), "full_number");
  });

  it("allows phones, dates, ZIP+4, years, and last-4s", () => {
    for (const ok of [
      "Call 555-123-4567",
      "+1 (555) 123 4567",
      "800 555 0100 800 555 0199",
      "Renews 2026-09-29",
      "ZIP 12345-6789",
      "ends 0000",
      "12345678",
      "",
    ]) {
      assert.equal(findFullNumber(ok), null, ok);
    }
  });
});

describe("QA blockers: looksLikeFullNumber", () => {
  const cases = ["123 45 6789", "0001 2345 6789", "123.45.6789", "4111/1111/1111/1111"];

  it("QA-2: catches each shape on its own", () => {
    for (const text of cases) assert.equal(looksLikeFullNumber(text), true, text);
  });

  it("QA-2: catches each shape inside a sentence", () => {
    for (const text of cases) {
      assert.equal(looksLikeFullNumber(`My number is ${text}, from the statement.`), true, text);
      assert.equal(looksLikeFullNumber(`(${text})`), true, text);
    }
  });

  it("QA-2: allows the date range 2026-09-29 - 2027-09-29", () => {
    assert.equal(looksLikeFullNumber("2026-09-29 - 2027-09-29"), false);
    assert.equal(looksLikeFullNumber("Policy term 2026-09-29 - 2027-09-29, renews yearly"), false);
    assert.equal(looksLikeFullNumber("2026/09/29 - 2027/09/29"), false);
    assert.equal(looksLikeFullNumber("2026.09.29 2027.09.29"), false);
  });

  it("QA-1: catches a card number used as an email or phone", () => {
    assert.equal(looksLikeFullNumber("4111111111111111@example.com"), true);
    assert.equal(looksLikeFullNumber("4111111111111111"), true);
  });

  it("grouped numbers: 10 to 12 digits in 4+ digit groups, any separator", () => {
    assert.equal(findFullNumber("0001-2345-6789"), "full_number");
    assert.equal(findFullNumber("0001.2345.6789"), "full_number");
    assert.equal(findFullNumber("1234 5678 90"), "full_number");
    assert.equal(findFullNumber("1234 5678 9"), null);
    assert.equal(findFullNumber("123 4567 8901"), null);
    assert.equal(findFullNumber("4111.1111.1111.1111"), "full_number");
  });

  it("SSN shape with dots, slashes, or mixed separators", () => {
    assert.equal(findFullNumber("123/45/6789"), "ssn");
    assert.equal(findFullNumber("123.45-6789"), "ssn");
    assert.equal(findFullNumber("1123.45.6789"), null);
    assert.equal(findFullNumber("123.45.67890"), null);
  });

  it("allows international phones, lists of years, and amounts with cents", () => {
    assert.equal(findFullNumber("+44 7700 900123"), null);
    assert.equal(findFullNumber("+49 1512 3456789"), null);
    assert.equal(findFullNumber("+4915123456789"), null);
    assert.equal(findFullNumber("+441234567890123"), null);
    assert.equal(findFullNumber("+4412345678901234"), "full_number");
    assert.equal(findFullNumber("+4412 3456 7890 1234"), "full_number");
    assert.equal(findFullNumber("x+4111 1111 1111 1111 1"), "full_number");
    assert.equal(findFullNumber("Returns 2021 2022 2023 2024"), null);
    assert.equal(findFullNumber("Returns 1999/2000/2001"), null);
    assert.equal(findFullNumber("2021 2022 4111 1111"), "full_number");
    assert.equal(findFullNumber("$25000000.50 face value"), null);
    assert.equal(findFullNumber("25000000.505"), "full_number");
    assert.equal(findFullNumber("250000000.50"), "ssn");
  });
});

describe("entropyPerChar", () => {
  it("measures bits per character", () => {
    assert.equal(entropyPerChar("aaaa"), 0);
    assert.equal(entropyPerChar("ab"), 1);
    assert.equal(entropyPerChar("abcd"), 2);
    assert.equal(entropyPerChar("aabb"), 1);
  });
});

describe("looksLikeSecretToken", () => {
  it("flags 8+ char tokens mixing letters and digits with case or a symbol", () => {
    for (const t of ["Hunter2!x", "B3tt3rP@ss", "Password1", "Hunter22", "hunter-22", "Hunt3r!x"]) {
      assert.equal(looksLikeSecretToken(t), true, t);
    }
  });

  it("needs 8 chars, letters, digits, and case or a symbol", () => {
    for (const t of ["Hunt3r!", "P@ssword", "1234!@#$", "hunter22", "Aaaaaaa1", "12345678"]) {
      assert.equal(looksLikeSecretToken(t), false, t);
    }
  });

  it("flags long high-entropy same-case tokens such as hex keys", () => {
    assert.equal(looksLikeSecretToken("a8f5f167f44f4964e6c998dee827110c"), true);
    assert.equal(looksLikeSecretToken("a8f5f167f44f4964e6c"), false);
    assert.equal(looksLikeSecretToken("a1a1a1a1a1a1a1a1a1a1"), false);
    assert.equal(looksLikeSecretToken("abcdefghij0123456789"), true);
  });

  it("strips surrounding punctuation before judging", () => {
    assert.equal(looksLikeSecretToken('"Hunter2!x",'), true);
    assert.equal(looksLikeSecretToken("(Hunter2x)."), true);
    assert.equal(looksLikeSecretToken("(Abcdef1)"), false);
  });

  it("leaves emails, URLs, and domains alone", () => {
    for (const t of [
      "Hunter2x@example.com",
      "https://Example.com/Login2x",
      "http://x.io/A1b2c3d4",
      "www.Example2.com",
      "Example2.com",
      "shop.Example-24.co/Ab1",
    ]) {
      assert.equal(looksLikeSecretToken(t), false, t);
    }
    assert.equal(looksLikeSecretToken("Hunter2.Xy"), true);
    assert.equal(looksLikeSecretToken("Hunter2@example"), true);
  });
});

describe("scanText", () => {
  it("returns null for ordinary pointers and metadata", () => {
    for (const ok of [
      "Login is in our Example password manager family vault.",
      "Password manager: Example Vault",
      "The password is in Bitwarden",
      "The password is in.",
      "Checking/Savings",
      "401(k) at Example Brokerage",
      "Branch hours 9-5 weekdays.",
      "pin 123",
      "CVV 12",
      "pat@example.com",
      "",
    ]) {
      assert.equal(scanText(ok), null, ok);
    }
  });

  it("does not warn when a secret label points somewhere", () => {
    for (const word of [
      "in", "at", "on", "inside", "kept", "stored", "see", "ask", "printed",
      "written", "saved", "held", "via", "under", "located", "lives",
    ]) {
      assert.equal(scanText(`Recovery codes: ${word} the fire safe`), null, word);
    }
    assert.equal(scanText("PIN: In the envelope"), null);
    assert.equal(scanText("Password: stored in Example Password Manager"), null);
    assert.equal(scanText("Backup code: (in the safe)"), null);
  });

  it("blocks a value written after an explicit credential label", () => {
    for (const bad of [
      "password: hunter",
      "password: Tr0ub4dor&3",
      "PASSWORD:hunter2",
      "password = Tr0ub4dor&3",
      "Passwd=hunter",
      "passcode: 0000",
      "my PIN: 0000",
      "PIN=4821",
      "pin code: 4821",
      "PIN number: 4821",
      "secret: abc",
      "Security answer: Fluffy",
      "security answers = Fluffy",
      "backup code: abcd",
      "Backup codes: abcd efgh",
      "2FA code: 123456",
      "2fa codes=123456",
      "2fa backup code: abcd",
      "Password: ñandú",
    ]) {
      assert.deepEqual(scanText(bad), { level: "block", reason: "credential", message: CREDENTIAL_ERROR }, bad);
    }
  });

  it("checks every credential label in the text, not just the first", () => {
    assert.equal(reason("Password: in the family vault. PIN: 4821"), "credential");
    assert.equal(reason("Recovery code: in the safe; otp: 1x"), "secret_label");
  });

  it("does not block a label with no real value after it", () => {
    for (const text of ["password:", "Password: ...", "PIN: ***", "password: -", "Password: N/A", "PIN: none", "Secret: TBD", "Password: unknown"]) {
      assert.equal(scanText(text), null, text);
    }
  });

  it("only warns on softer labels and on '#' after a credential label", () => {
    for (const bad of [
      "password # hunter",
      "pwd # hunter",
      "pwd: hunter",
      "Passphrase: correct horse",
      "security code: 12",
      "seed phrase = apple banana",
      "recovery phrase: apple banana",
      "recovery code: abcd",
      "cvv: 12",
      "CVC: 12",
      "otp: abc",
    ]) {
      assert.deepEqual(scanText(bad), { level: "warn", reason: "secret_label", message: SECRET_WARNING }, bad);
    }
  });

  it("does not read ordinary 'label: value' text as a credential", () => {
    assert.equal(scanText("Branch: Main St"), null);
    assert.equal(scanText("Spin: weekly"), null);
    assert.equal(scanText("Passwords: see the family vault"), null);
  });

  it("warns on 'is/was' phrasing only when the value looks like a secret", () => {
    assert.equal(reason("PIN is 4821"), "secret_label");
    assert.equal(reason("the password was hunter2"), "secret_label");
    assert.equal(reason("the password is 'correcthorse'"), "secret_label");
    assert.equal(reason('the password is "correcthorse"'), "secret_label");
    assert.equal(reason("the password is hunter_two"), "secret_label");
    assert.equal(reason("the password is hunter!"), null);
    assert.equal(reason("the password is correcthorse"), null);
  });

  it("warns on PIN and card-code digits", () => {
    for (const bad of ["pin 1234", "PIN #4821", "pin 12345678", "CVV 123 on the back", "cvv2 1234", "cvc #123"]) {
      assert.equal(reason(bad), "secret_label", bad);
    }
    assert.equal(reason("pin 123456789"), "ssn");
  });

  it("warns on password-like tokens inside longer text", () => {
    assert.deepEqual(scanText("login P@ssw0rd99 for bank"), {
      level: "warn",
      reason: "secret_token",
      message: SECRET_WARNING,
    });
    assert.equal(reason("api key 9f86d081884c7d659a2feaa0c55ad015"), "secret_token");
    // Single letters join digit groups for the SSN check: 167f44f4964 reads as 167-44-4964.
    assert.equal(reason("api key a8f5f167f44f4964e6c998dee827110c"), "ssn");
    assert.equal(reason("one\ttwo\nHunter2!x"), "secret_token");
  });

  it("blocks full numbers ahead of any warning", () => {
    assert.deepEqual(scanText("password: 4111 1111 1111 1111"), {
      level: "block",
      reason: "full_number",
      message: FULL_NUMBER_ERROR,
    });
    assert.deepEqual(scanText("SSN 123-45-6789"), { level: "block", reason: "ssn", message: FULL_NUMBER_ERROR });
    assert.equal(level("acct 123456789"), "block");
  });

  it("uses plain-language messages", () => {
    assert.match(FULL_NUMBER_ERROR, /last 4 digits at most/);
    assert.match(SECRET_WARNING, /password manager/);
    assert.match(SECRET_WARNING, /where it lives/);
  });
});

describe("scanField", () => {
  it("skips the secret heuristics for last-4, email, and phone, which have their own formats", () => {
    assert.equal(scanField("email", "Hunter2!x@example.com"), null);
    assert.equal(scanField("phone", "+1 (555) 010-0199"), null);
    assert.equal(scanField("last4", "1234"), null);
  });

  it("QA-1: still runs the block-level checks on last-4, email, and phone", () => {
    assert.equal(scanField("phone", "4111111111111111")?.message, FULL_NUMBER_ERROR);
    assert.equal(scanField("email", "4111111111111111@example.com")?.message, FULL_NUMBER_ERROR);
    assert.equal(scanField("email", "password=hunter2@example.com")?.message, CREDENTIAL_ERROR);
    assert.equal(scanField("last4", "123456789")?.reason, "ssn");
  });

  it("scans text and textarea fields", () => {
    assert.equal(scanField("text", "123456789")?.level, "block");
    assert.equal(scanField("textarea", "pwd: hunter2")?.level, "warn");
    assert.equal(scanField("textarea", "password: hunter2")?.level, "block");
    assert.equal(scanField("text", "Example Bank"), null);
  });
});

describe("pendingFindings", () => {
  const fields = [
    { name: "label", kind: "text" },
    { name: "last4", kind: "last4" },
    { name: "notes", kind: "textarea" },
  ];

  it("reports block and warn findings per field", () => {
    assert.deepEqual(pendingFindings(fields, { label: "Acct 123456789", notes: "pwd: hunter2" }, {}), {
      label: { level: "block", reason: "ssn", message: FULL_NUMBER_ERROR },
      notes: { level: "warn", reason: "secret_label", message: SECRET_WARNING },
    });
  });

  it("releases a warning once that exact value is confirmed, and re-checks edits", () => {
    const values = { label: "Email", notes: "pwd: hunter2" };
    assert.deepEqual(pendingFindings(fields, values, { notes: "pwd: hunter2" }), {});
    assert.deepEqual(Object.keys(pendingFindings(fields, { ...values, notes: "pwd: hunter3" }, { notes: "pwd: hunter2" })), [
      "notes",
    ]);
  });

  it("never releases a block, even if confirmed", () => {
    const values = { label: "Card", notes: "4111 1111 1111 1111" };
    assert.deepEqual(Object.keys(pendingFindings(fields, values, { notes: values.notes })), ["notes"]);
    const credential = { label: "Email", notes: "password: hunter2" };
    assert.deepEqual(Object.keys(pendingFindings(fields, credential, { notes: credential.notes })), ["notes"]);
  });

  it("treats missing values as empty, and holds a full number even in a format field", () => {
    assert.deepEqual(pendingFindings(fields, { last4: "1234" }, {}), {});
    assert.deepEqual(pendingFindings(fields, { last4: "123456789" }, { last4: "123456789" }), {
      last4: { level: "block", reason: "ssn", message: FULL_NUMBER_ERROR },
    });
  });
});

describe("rule boundaries", () => {
  it("blocks grouped numbers from 10 digits, and leaves 10+ digit groups to the long-run rule", () => {
    assert.equal(findFullNumber("12345678 1234 1234567"), "full_number");
    assert.equal(findFullNumber("12345678 12"), "full_number");
    assert.equal(findFullNumber("12345678 1"), null);
    assert.equal(findFullNumber("8005550100 1234"), null);
    assert.equal(findFullNumber("1234 8005550100"), null);
    assert.equal(findFullNumber("5550100000 5550100001"), null);
  });

  it("finds a card number that starts after a short leading group", () => {
    assert.equal(findFullNumber("12 1234 1234 1234 1"), "full_number");
    assert.equal(findFullNumber("12 1234 5678"), null);
    assert.equal(findFullNumber("1234 5678"), null);
  });

  it("returns null for text with no digits", () => {
    assert.equal(findFullNumber("Example Bank, Main St branch"), null);
  });

  it("treats every pointer word after a secret label as a pointer", () => {
    const words = ["in", "at", "on", "inside", "kept", "stored", "see", "ask", "printed"];
    words.push("written", "saved", "held", "via", "under", "located", "lives");
    words.push("none", "n/a", "tbd", "unknown");
    const flagged = words.filter((w) => level(`password: ${w.toUpperCase()} the family vault`) !== null);
    assert.deepEqual(flagged, []);
    const softFlagged = words.filter((w) => level(`Recovery code: ${w.toUpperCase()} the fire safe`) !== null);
    assert.deepEqual(softFlagged, []);
    assert.equal(level("password: somewhere"), "block");
    assert.equal(level("recovery code: somewhere"), "warn");
  });

  it("reads PIN and card codes written with no space", () => {
    assert.equal(level("pin1234"), "warn");
    assert.equal(level("cvv123"), "warn");
    assert.equal(level("pinx1234"), null);
    assert.equal(level("cvvx123"), null);
  });

  it("strips only leading and trailing punctuation, however much there is", () => {
    assert.equal(level("a1(b2c3d"), "warn");
    assert.equal(level("((a1b2c3d"), null);
    assert.equal(level("a1b2c3d.."), null);
  });

  it("only skips a token when the whole token is an email, URL, or domain", () => {
    assert.equal(level("Pa55@@me@example.com"), "warn");
    assert.equal(level("user@example.comX9!pw"), "warn");
    assert.equal(level("Tr0ub&www.example"), "warn");
    assert.equal(level("Tr0ub&4dor.com"), "warn");
    assert.equal(level("example.comTr0ub&4"), "warn");
  });

  it("does not count upper-case-only codes as mixed case", () => {
    assert.equal(looksLikeSecretToken("ABCD1234"), false);
    assert.equal(looksLikeSecretToken("abcd1234"), false);
  });

  it("warns at exactly the entropy thresholds", () => {
    assert.equal(entropyPerChar("aaBB1234"), 2.5);
    assert.equal(looksLikeSecretToken("aaBB1234"), true);
    const hexish = "aaaaaaaabbbbbbbb0123456789cdefgh";
    assert.equal(entropyPerChar(hexish), 3.5);
    assert.equal(looksLikeSecretToken(hexish), true);
  });

  it("needs 20 characters before a same-case token counts on entropy alone", () => {
    assert.equal(entropyPerChar("abcdef123456") > 3.5, true);
    assert.equal(looksLikeSecretToken("abcdef123456"), false);
  });

  it("does not scan email fields, even when the text would warn elsewhere", () => {
    assert.equal(scanField("text", "pin1234@example.com")?.level, "warn");
    assert.equal(scanField("email", "pin1234@example.com"), null);
  });
});

describe("findBlocked", () => {
  it("returns only block-level findings, which the server enforces", () => {
    assert.deepEqual(findBlocked("password: Tr0ub4dor&3"), { level: "block", reason: "credential", message: CREDENTIAL_ERROR });
    assert.deepEqual(findBlocked("4111 1111 1111 1111"), { level: "block", reason: "full_number", message: FULL_NUMBER_ERROR });
    assert.equal(findBlocked("Tr0ub4dor&3"), null);
    assert.equal(findBlocked("pwd: hunter2"), null);
    assert.equal(findBlocked("Example Bank"), null);
  });
});
