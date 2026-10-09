import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CREDENTIAL_ERROR,
  FULL_NUMBER_ERROR,
  SECRET_WARNING,
  entropyPerChar,
  findBlocked,
  findFullNumber,
  foldConfusables,
  foldSeparators,
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

  it("flags long digit runs, including bare phone-length runs", () => {
    assert.equal(findFullNumber("1234567890123"), "full_number");
    assert.equal(findFullNumber("acct 123456789012"), "full_number");
    assert.equal(findFullNumber("21234567890"), "full_number");
    assert.equal(findFullNumber("8005550100"), "full_number");
    assert.equal(findFullNumber("18005550100"), "full_number");
  });

  it("flags grouped card and account numbers", () => {
    assert.equal(findFullNumber("4111 1111 1111 1111"), "full_number");
    assert.equal(findFullNumber("4111-1111-1111-1"), "full_number");
    assert.equal(findFullNumber("3782 822463 10005"), "full_number");
    assert.equal(findFullNumber("acct 12345 67890 123"), "full_number");
    assert.equal(findFullNumber("see 4111 1111 1111 1111 1111"), "full_number");
    assert.equal(findFullNumber("800 555 0100 4111 1111 1111 1111"), "full_number");
  });

  it("allows formatted phones, dates, ZIP+4, years, and last-4s", () => {
    for (const ok of [
      "Call 404-555-0123",
      "+1 (404) 555 0123",
      "800 555 0100 or 800 555 0199",
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

  it("allows international phones, lists of years, and amounts with cents", () => {
    assert.equal(findFullNumber("+44 20 7946 0958"), null);
    assert.equal(findFullNumber("+49 1512 3456789"), null);
    assert.equal(findFullNumber("+4915123456789"), "full_number");
    assert.equal(findFullNumber("Returns 1999 2000 2001 2002 2003"), null);
    assert.equal(findFullNumber("Returns 2021, 2022, 2023, 2024"), null);
    assert.equal(findFullNumber("Returns 2021 2022 2023 2024"), "full_number");
    assert.equal(findFullNumber("$25000000.50 face value"), null);
    assert.equal(findFullNumber("25000000.505"), "full_number");
    assert.equal(findFullNumber("250000000.50"), "full_number");
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

describe("credential labels followed by punctuation (QA)", () => {
  const blocked = (text: string) => assert.deepEqual(scanText(text), { level: "block", reason: "credential", message: CREDENTIAL_ERROR }, text);

  it("skips a run of separators after the label and checks the value behind it", () => {
    // QA's eleven forms (pw23.py): punctuation that used to be read as the value.
    for (const text of [
      "password:: x",
      "password := x",
      "password => x",
      "password: - x",
      "password = = x",
      "password: : x",
      "password: = x",
      "password: . x",
      "password: * x",
      "Password: — x",
      "password -- x",
    ]) {
      blocked(text);
      blocked(text.replace("x", "hunter2"));
      blocked(`Notes for Pat\n${text} - thanks`);
    }
    for (const text of ["password:\t;~| x", "PIN: ... 4821", "passcode: ** 0000", "secret: >x", "password:\n- x", "password: −‐‑‒–― x"]) blocked(text);
  });

  it("reads a dash with a space beside it as a separator, with no colon", () => {
    for (const text of ["password - x", "password -> x", "Password — x", "password – x", "password- x", "password -x", "PIN - 4821", "Passcode -- 0000"]) {
      blocked(text);
    }
    for (const text of ["password-protected PDF", "Password-protected: yes", "password—kept in the vault", "Reset password\n- call the bank"]) {
      assert.equal(level(text), null, text);
    }
  });

  it("reads ':' or '=' after spaces or '#' as a separator", () => {
    for (const text of ["password : x", "password\t= x", "PIN #: 1234", "pin # = 1234"]) blocked(text);
    assert.equal(reason("password # hunter"), "secret_label");
  });

  it("blocks 'pass:' and 'pass=' with no word right before them", () => {
    for (const text of ["pass: x", "Pass:hunter2", "PASS = x", "Login: pat / pass: hunter2", "Notes - pass: x", "pass #: x"]) blocked(text);
    for (const text of [
      "Boarding pass: Delta app",
      "Bus pass: x",
      "Season pass - expires June",
      "Passport: top drawer",
      "Passport - top drawer",
      "Passenger: Dana",
      "Bypass: Route 9",
      "Passed: inspection",
      "Compass: glovebox",
      "Pass the keys to Pat",
      "Pass: in the family vault",
    ]) {
      assert.equal(level(text), null, text);
    }
  });

  it("folds Cyrillic and Greek look-alike letters before matching a label", () => {
    for (const text of ["\u0440\u0430ssword: x", "раѕѕԝоrԁ: x", "ΡΙΝ: 4821", "Рasscode = 0000", "ѕесrеt: x", "раѕѕ: x", "ΡΑSSWΟRD:: x"]) blocked(text);
    assert.equal(reason("ρwd: hunter"), "secret_label");
    assert.equal(reason("οtp: abc"), "secret_label");
    assert.equal(level("раssword: in the family vault"), null);
    assert.equal(level("Пароль: в сейфе"), null);
    assert.equal(level("Секрет: нет"), null);
  });

  it("maps each look-alike to one Latin letter and leaves everything else alone", () => {
    assert.equal(
      foldConfusables("асԁеһіјкорԛѕԝхуАВСЕНІЈКМОРЅТХԜαικνορυΑΒΕΖΗΙΚΜΝΟΡΤΥΧɑı"),
      "acdehijkopqswxyABCEHIJKMOPSTXWaikvopuABEZHIKMNOPTYXai",
    );
    assert.equal(
      foldConfusables("тгмнүҮҽѵѴѡӏӀЬτςησωγχϝϜϳɡȷɩʋƿᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢ"),
      "trmhyYevVwiIbtcnowyxfFjgjiupabcdefghijklmnoprstuvwyz",
    );
    assert.equal(foldConfusables("Пароль: в сейфе, 4821 Main St"), "Пapoль: в ceйфe, 4821 Main St");
  });

  it("only warns on the softer labels, whatever the separators", () => {
    for (const text of ["pwd:: hunter", "pwd - hunter", "otp => abc", "recovery code: — abcd", "Passphrase -- correct horse"]) {
      assert.equal(reason(text), "secret_label", text);
    }
  });

  it("still allows labels that point somewhere or have no value", () => {
    for (const text of [
      "Password is in the safe",
      "password: see access plan",
      "Password: in the family vault",
      "Password: see Example Password Manager",
      "PIN: kept in the fire safe",
      "Recovery codes: in the fire safe",
      "password: ********",
      "Password:: in the family vault",
      "Password: — see the access plan",
      "password => kept in the safe",
      "PIN - kept in the fire safe",
      "password: - none",
      "password: :",
      "Password / PIN: see the access plan",
      "Passwords: see the family vault",
    ]) {
      assert.equal(level(text), null, text);
    }
    // Not a credential label; "1Password" alone reads like a password token, so it only warns, as before.
    assert.equal(reason("Password manager: 1Password"), "secret_token");
    assert.equal(reason("Password manager — 1Password"), "secret_token");
  });
});

describe("credential labels: QA interim 4", () => {
  const blocked = (text: string) => assert.deepEqual(scanText(text), { level: "block", reason: "credential", message: CREDENTIAL_ERROR }, JSON.stringify(text));
  const allowed = (text: string) => assert.equal(level(text), null, JSON.stringify(text));

  it("skips any punctuation or symbol token before the value", () => {
    for (const c of ["/", "!", "?", "_", "»", "«", "\"", "'", "(", ")", "[", "{", "<", "@", "$", "%", "&", "+", "^", "`", "\\", "¿", "¡", "†", "•", "→", "✓", "★", "€"]) {
      blocked(`password: ${c} hunter2`);
      blocked(`password: ${c}${c} x`);
      blocked(`pass: ${c} x`);
      assert.equal(reason(`pwd: ${c} hunter2`), "secret_label", c);
    }
    blocked("password: / ! ? _ » hunter2");
    blocked("PIN: / 4821");
    blocked("password: /hunter2");
    allowed("password: / ! ?");
    allowed("password: » in the family vault «");
    allowed("Password: (see the access plan)");
    allowed("PIN: — n/a.");
    allowed("Password: kept...");
    allowed("PIN: see!!");
  });

  it("blocks with every punctuation and symbol character in the BMP as the token", () => {
    const saved: string[] = [];
    for (let cp = 0x21; cp < 0x10000; cp++) {
      const c = String.fromCodePoint(cp);
      if (/[\p{P}\p{S}]/u.test(c) && findBlocked(`password: ${c} hunter2`) === null) saved.push(c);
    }
    assert.deepEqual(saved, []);
  });

  it("does not read a symbol that NFKC spells as a word as a value or a pointer", () => {
    // "㏌" is "in" after NFKC, "№" is "No", "℡" is "TEL".
    blocked("password: ㏌ hunter2");
    blocked("PIN: № 4821");
    allowed("password: ℡");
    allowed("password: in the family vault");
    // A blanked symbol splits a word rather than joining its letters into a pointer word.
    blocked("password: ke㏌pt");
  });

  it("reads Unicode colons, equals signs, arrows, and dashes as separators", () => {
    for (const c of ["∶", "꞉", "˸", "ː", "﹕", "：", "︓", "∷", "⁚", "։", "׃", "܃", "܄", "܅", "᠄", "⦂", "ꓽ", "꛴", "፡", "፥", "᛬", "≔", "≕", "꞊", "═", "＝", "﹦"]) {
      blocked(`password ${c} x`);
      blocked(`password${c}x`);
      blocked(`PIN${c} 4821`);
      blocked(`pass${c} x`);
      allowed(`password ${c} in the family vault`);
    }
    for (const c of ["→", "⇒", "⟹", "➔", "⟶", "⇨", "⤍", "⭢", "➡", "▶", "►", "▻", "🠒", "->", "-->", "—>", "=>"]) {
      blocked(`password ${c} x`);
      blocked(`password${c}x`);
      blocked(`secret ${c} x`);
      allowed(`password ${c} kept in the safe`);
      assert.equal(reason(`pwd ${c} hunter`), "secret_label", c);
    }
    for (const c of ["⁃", "⸺", "⸻", "━", "─", "┄", "╌", "╴", "⁓", "−", "˗", "⁒", "➖", "⹃", "⎯", "⏤", "‐", "‑", "‒", "–", "—", "―", "﹘", "〜", "－"]) {
      blocked(`password ${c} x`);
      blocked(`password${c} x`);
      blocked(`password ${c}x`);
      allowed(`password${c}protected PDF`);
    }
    // "pass" with an arrow or a dash counts only when it starts its line.
    blocked("pass → x");
    blocked("pass ━ x");
    allowed("Bus pass → x");
    allowed("Season pass ━ June");
    assert.equal(foldSeparators("a∶b꞉c≔d═e━f⁃g→h⇒i->j-->k—>l▶m"), "a:b:c=d=e-f-g\u2192h\u2192i\u2192j\u2192k\u2192l\u2192m");
    assert.equal(foldSeparators("Pat - 4 > 3, a=b; c: d"), "Pat - 4 > 3, a=b; c: d");
  });

  it("allows any whitespace, line breaks included, between the label and the colon, as main did", () => {
    for (const text of ["password\n: x", "password\r\n: x", "PIN\n: 4821", "password \n : hunter2", "Password\n\n= x", "pass\n: x", "PIN #\n: 1234", "password\u00a0: x", "password\u3000: x"]) {
      blocked(text);
    }
    assert.equal(reason("pwd\n: hunter"), "secret_label");
    assert.equal(reason("otp\r\n= abc"), "secret_label");
    allowed("password\n: in the family vault");
    allowed("Reset password\n- call the bank");
  });

  it("folds look-alikes of every letter of every label", () => {
    for (const text of [
      "pinсode: 4821", // Cyrillic с
      "secreτ: x", // Greek tau
      "ѕеcrет: x",
      "раsswоrԁ: x",
      "раѕѕсоԁе: 0000",
      "ᴘᴀssᴡᴏʀᴅ: x",
      "ᴘɪɴ: 4821",
      "ꜱᴇᴄʀᴇᴛ: x",
      "pαsswοrd: x",
      "ΡΙΝ code: 4821",
      "pιη: 4821",
      "pαssωοrd: x",
      "pasѕcοde = 0000",
      "ѕecuгity answer: x",
      "2ϝa codes: x",
      "baсkuр codes: x",
      "ʙackup codes: x",
      "securiτy answers: x",
      "pin numbeг: 4821",
      "pin nuмber: 4821",
      "pαsswd: x",
    ]) {
      blocked(text);
    }
    assert.equal(reason("ρԝԁ: hunter"), "secret_label");
    assert.equal(reason("cᴠᴠ: 123"), "secret_label");
    assert.equal(reason("οτp: abc"), "secret_label");
    assert.equal(reason("seed ρhrαse: abc"), "secret_label");
    assert.equal(reason("recονery code: abc"), "secret_label");
    assert.equal(reason("passρhrase: abc"), "secret_label");
  });

  it("reads 'pincode' and 'pin-code' as labels too", () => {
    for (const text of ["pincode: 4821", "Pin-code = 4821", "PINCODE - 4821", "pinnumber: 4821", "pin-number: 4821"]) blocked(text);
    assert.equal(reason("pincode # 4821"), "secret_label");
  });
});

describe("scanField", () => {
  it("skips the secret heuristics for last-4, email, and phone, which have their own formats", () => {
    assert.equal(scanField("email", "Hunter2!x@example.com"), null);
    assert.equal(scanField("phone", "+1 (404) 555-0199"), null);
    assert.equal(scanField("last4", "1234"), null);
    assert.equal(scanField("last4", "Hunter2!x"), null);
    assert.equal(scanField("phone", "Ab12cd34!"), null);
    assert.equal(scanField("text", "Ab12cd34!")?.level, "warn");
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

describe("credential labels: QA round 8 (pointer words, a dash on the next line)", () => {
  const blocked = (text: string) => assert.deepEqual(scanText(text), { level: "block", reason: "credential", message: CREDENTIAL_ERROR }, JSON.stringify(text));
  const allowed = (text: string) => assert.equal(level(text), null, JSON.stringify(text));

  it("checks every word after a pointer word on its line", () => {
    for (const text of [
      "password: in hunter2",
      "password\n: see hunter2",
      "password\n: in hunter2",
      "PIN: at 4821",
      "PIN: in 4821",
      "PIN: see 4821",
      "Secret: ask hunter2",
      "Password: in Hunter2!",
      "password: in safe hunter2",
      "password: see Sunshine1",
      "PIN: in drawer 4821",
      "password: in the vault hunter2",
      "password\n: in the vault hunter2",
      "password: in: hunter2",
      "password: in, hunter2",
      "password: see: hunter2",
      "Password: see Tulip#2024",
      "Password: stored s3cr3t-Pass",
      "pin: none 4821",
      "Password: in the safe p@ss",
      "Password: in the safe hUnTeR",
      "Password: kept in hunter2.tk",
      "PIN: see 2024",
      "PIN: kept in 2024 4821",
      "PIN: in the 4821st drawer",
      "Pass: in hunter2",
    ]) {
      blocked(text);
    }
    for (const w of ["at", "on", "none", "n/a", "tbd", "unknown", "kept", "via", "under", "lives"]) blocked(`Password: ${w} hunter2`);
  });

  it("reads the next line when nothing follows the pointer word", () => {
    blocked("Password: see\nhunter2");
    blocked("Password: in\n\n4821");
    allowed("Password: kept in\nthe fire safe");
    allowed("Password: see\n");
    allowed("PIN: none");
  });

  it("does not take a look-alike pointer word as a pointer", () => {
    blocked("password: іn hunter2");
    blocked("password: іn the safe");
    blocked("PIN: ѕee the binder");
    // Look-alike letters still fold for the label itself.
    allowed("раssword: in the family vault");
  });

  it("still allows pointers made of plain words", () => {
    for (const text of [
      "Password: in the safe",
      "password: in the family vault",
      "password: see access plan",
      "Password: kept in the fireproof box",
      "Secret: ask Mom",
      "Password: stored with the lawyer",
      "PIN: at the bank",
      "password: in the blue folder",
      "password: kept at Mom's house",
      "PIN: in the 2024 tax binder",
      "PIN: kept in the 2nd drawer",
      "Password: ask O'Brien at the IRS",
      "Password: in LastPass",
      "Password: in the iCloud keychain",
      "Password: see https://bank.example.com/reset",
      "Password: ask pat@example.com",
      "Password: see bank.example.com",
      "Password: in the safe (top shelf), ask Mom",
      "password: n/a",
      "Password: see the U.S. passport folder",
      "PIN: in the fire-proof box",
      "Password: see binder — top shelf",
    ]) {
      allowed(text);
    }
    // "1Password" reads like a password token, so it only warns, as before.
    assert.equal(reason("Password: stored in 1Password"), "secret_token");
  });

  it("allows a short lead-in before the pointer word", () => {
    allowed("Password: 1 copy in the safe");
    allowed("Password: a note in the safe");
    allowed("Password: the card kept in the safe");
    allowed("PIN: one copy stored with the lawyer");
    allowed("Password: an envelope at the bank");
    allowed("Password: a printed copy in the safe");
    allowed("Password: 2 in the safe");
    blocked("password: 1 hunter2");
    blocked("password: a hunter2");
    blocked("PIN: 1 4821");
    blocked("Password: 1 copy in the safe hunter2");
    blocked("Password: a Note in the safe");
    blocked("Password: copy in the safe");
    blocked("Password: a big note in the safe");
    blocked("Password: 10 copies in the safe");
    blocked("Password: 11 copies in the safe");
    blocked("Password: 0 copies in the safe");
    blocked("Password: a note2 in the safe");
    blocked("Password: a hunter2 in the safe");
    allowed("Password: 9 copies in the safe");
    allowed("Password: THE card in the safe");
  });

  it("reads years, ordinals, and known names after a pointer word only in their exact shapes", () => {
    for (const name of ["1Password", "LastPass", "KeePass", "KeePassXC", "NordPass", "RoboForm", "iCloud", "iPhone", "iPad", "OneDrive", "YubiKey"]) {
      assert.notEqual(level(`Password: see the ${name} app`), "block", name);
    }
    allowed("PIN: in the 12th drawer");
    allowed("Password: see the 1999 binder");
    blocked("PIN: kept in the 2024");
    blocked("PIN: in the 12024 binder");
    blocked("PIN: in the 20245 binder");
    blocked("PIN: in the 2024 4821");
    blocked("PIN: in the 2024 2025 binder");
    blocked("PIN: in the 2nd4821 drawer");
    blocked("PIN: in the 123rd drawer");
    blocked("Password: see fire-hOuse");
    blocked("Password: see fire-house2");
    allowed("Password: in the ((top shelf))");
    allowed("Password: in the safe — ask Mom");
  });

  it("reads a dash at the start of the next line as a separator after a label alone on its line", () => {
    for (const text of ["Password\n- hunter2", "Password\n— hunter2", "Password \n - hunter2", "PIN\n- 4821", "Password\n-hunter2", "Password\r\n- hunter2", "**Password**\n- hunter2", "Notes\nPIN\n- 4821"]) {
      blocked(text);
    }
    allowed("Reset password\n- call the bank");
    allowed("Password\n- call the bank");
    allowed("PIN\n- ask Dad");
  });

  it("blocks a secret-shaped word on the line after a label alone on its line", () => {
    for (const text of ["Password\nhunter2", "PIN\n4821", "Password\n\nHunter2!", "Secret\n1. hunter2", "PIN\n2) 4821", "PIN\n12"]) blocked(text);
    blocked("PIN\n1.4821");
    blocked("Password\nx1. Ask Mom");
    blocked("Password\n123. Ask Mom");
    for (const text of ["Password\nIn the safe", "PIN\nAsk Dad", "Password\n1. Ask Mom", "Password\n12. Ask Mom", "Password\n2) Ask  Mom", "Password\n\n", "Reset password\nhunter2", "Passwords\nhunter2"]) allowed(text);
    // Only the credential labels count here; "pwd" alone on a line is left alone, as before.
    assert.equal(level("pwd\nhunter"), null);
  });

  it("reads 'pass' with a dash or an arrow at the start of a line", () => {
    blocked("pass - x");
    blocked("Notes\nPass -> hunter2");
    allowed("pass - in the family vault");
    allowed("Season pass - expires June");
    allowed("Boarding pass: Gate 12");
    allowed("Wifi pass:");
  });

  it("reads the remaining colon look-alikes as separators", () => {
    for (const c of ["⫶", "⁝", "፦", "܈", "܉", "⍠"]) {
      blocked(`password ${c} hunter2`);
      blocked(`PIN${c}4821`);
      allowed(`password ${c} in the family vault`);
    }
  });

  it("leaves the soft labels and a word before 'pass' as they were", () => {
    assert.equal(level("pw: hunter2"), null);
    assert.equal(reason("pwd: hunter2"), "secret_label");
    assert.equal(reason("pwd: in hunter2"), "secret_label");
    assert.equal(level("pwd: in the safe"), null);
    assert.equal(level("Wifi pass: hunter2"), null);
  });
});
