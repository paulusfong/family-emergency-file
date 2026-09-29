import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findFullNumber, hasVinCheckDigit, isFormattedPhone, looksLikeFullNumber, normalizeForScan, passesLuhn } from "./privacy-warn";

/** Each row: [name, value]. */
type Row = readonly [string, string];
const blocked = (rows: readonly Row[]) => rows.filter(([, v]) => findFullNumber(v) === null).map(([n]) => n);
const allowed = (rows: readonly Row[]) => rows.filter(([, v]) => findFullNumber(v) !== null).map(([n]) => n);

describe("normalizeForScan", () => {
  it("applies NFKC, so fullwidth and styled digits become ASCII", () => {
    assert.equal(normalizeForScan("\uff14\uff11\uff11\uff11"), "4111");
    assert.equal(normalizeForScan("\u{1D7D2}\u{1D7CF}"), "41");
  });

  it("removes each zero-width character", () => {
    for (const zw of ["\u00AD", "\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF"]) {
      assert.equal(normalizeForScan(`12${zw}34${zw}`), "1234", JSON.stringify(zw));
    }
  });

  it("writes every script's decimal digits as 0-9", () => {
    assert.equal(normalizeForScan("\u0660\u0661\u0664\u0669"), "0149");
    assert.equal(normalizeForScan("\u0966\u0967\u096F"), "019");
    // U+116D0..U+116E3 are two digit sets back to back.
    assert.equal(normalizeForScan("\u{116D0}\u{116D9}\u{116DA}\u{116DB}\u{116E3}"), "09019");
    assert.equal(normalizeForScan("Pat 0123"), "Pat 0123");
  });
});

describe("passesLuhn", () => {
  const cards = ["4111111111111111", "378282246310005", "6011111111111117", "5555555555554444", "30569309025904"];

  it("accepts known test card numbers", () => {
    for (const card of cards) assert.equal(passesLuhn(card), true, card);
  });

  it("rejects every single-digit change to a valid number", () => {
    const misses: string[] = [];
    for (const card of cards) {
      for (let i = 0; i < card.length; i++) {
        for (let r = 0; r <= 9; r++) {
          if (String(r) === card[i]) continue;
          const changed = card.slice(0, i) + r + card.slice(i + 1);
          if (passesLuhn(changed)) misses.push(changed);
        }
      }
    }
    assert.deepEqual(misses, []);
  });
});

describe("isFormattedPhone (libphonenumber-js/min, default region US)", () => {
  const valid: Row[] = [
    ["us-paren", "(404) 555-0123"],
    ["us-dashes", "404-555-0123"],
    ["us-dots", "404.555.0123"],
    ["us-no-space", "(404)555-0123"],
    ["us-plus1", "+1 404 555 0123"],
    ["us-plus1-dashes", "+1-202-555-0143"],
    ["double-spaced", "404  555  0123"],
    ["toll-free", "(800) 555-0199"],
    ["extension", "+1 404 555 0123 ext 12"],
    ["uk", "+44 20 7946 0958"],
    ["cn-mobile", "+86 138 0013 8000"],
    ["fr-mobile", "+33 6 12 34 56 78"],
    ["fr-8-digit-group", "+33 6 12345678"],
    ["de", "+49 30 901820"],
    ["niue-short", "+683 4002"],
  ];
  const invalid: Row[] = [
    ["bank10", "0001234567"],
    ["acct15+", "+000123456789012"],
    ["acct15+-grouped", "+000 123 456 789 012"],
    ["bare-us", "4045550123"],
    ["bare-intl", "+4915123456789"],
    ["9-digit-group", "+33 612345678"],
    ["no-separator-short", "+6834002"],
    ["seven-digit", "555-0100"],
    ["area-555", "(555) 010-0000"],
    ["area-555-plus1", "+1 (555) 123 4567"],
    ["too-short", "404 555 012"],
    ["empty", ""],
  ];

  it("accepts valid phones written with separators", () => {
    assert.deepEqual(valid.filter(([, v]) => !isFormattedPhone(v)).map(([n]) => n), []);
  });

  it("rejects invalid numbers, bare runs, and 9+ digit groups", () => {
    assert.deepEqual(invalid.filter(([, v]) => isFormattedPhone(v)).map(([n]) => n), []);
  });
});

describe("findFullNumber: QA #6 leaks, one per shape", () => {
  const leaks: Row[] = [
    ["amex", "378282246310005"],
    ["amex+", "+378282246310005"],
    ["amex-4-6-5", "3782 822463 10005"],
    ["amex+1-3s", "+1 378 282 246 310 005"],
    ["amex-3s", "378 282 246 310 005"],
    ["card+4-6-5", "+3782 822463 10005"],
    ["visa-3s", "411 111 111 111 1111"],
    ["visa-yearlike(nonLuhn)", "2020 2021 2022 2023"],
    ["luhn-yearlike", "2019 2020 2021 2004"],
    ["luhn-yearlike-dash", "2019-2020-2021-2004"],
    ["amt-card-commas", "$4,111,111,111,111,111.00"],
    ["ssn-cents", "123-45-6789.00"],
    ["ssn-dollar", "$123-45-6789"],
    ["ssn-phone", "+1 123 45 6789"],
    ["ssn-3-3-3", "123 456 789"],
    ["acct15", "000123456789012"],
    ["acct15+", "+000123456789012"],
    ["acct15-in-text+", "acct +000123456789012 at Chase"],
    ["acct15+-grouped", "+000 123 456 789 012"],
    ["acct10-grouped", "0001 234 567"],
    ["mixed-sep", "4111-1111 1111.1111"],
    ["fullwidth", "\uff14\uff11\uff11\uff11\uff11\uff11\uff11\uff11\uff11\uff11\uff11\uff11\uff11\uff11\uff11\uff11"],
    ["arabic-indic", "\u0664\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661"],
    ["zwsp", "4111\u200b1111\u200b1111\u200b1111"],
    ["nbsp", "4111\u00a01111\u00a01111\u00a01111"],
    ["double-space", "4111  1111  1111  1111"],
    ["spaced-dash", "4111 - 1111 - 1111 - 1111"],
    ["en-dash", "4111\u20131111\u20131111\u20131111"],
    ["comma-groups", "4111, 1111, 1111, 1111"],
    ["underscore", "4111_1111_1111_1111"],
    ["tab", "4111\t1111\t1111\t1111"],
    ["bank10", "0001234567"],
    ["bank10-text", "acct 0001234567 at Chase"],
    ["acct11-1", "12345678901"],
    ["ssn-nbsp", "123\u00a045\u00a06789"],
    ["ssn-en-dash", "123\u201345\u20136789"],
    ["amt9-cents", "123456789.00"],
    ["email-card-underscore", "4111_1111_1111_1111@example.com"],
    ["email-card-plus", "x+378282246310005@example.com"],
  ];

  it("blocks every leaked shape", () => {
    assert.deepEqual(blocked(leaks), []);
  });

  it("blocks every leaked shape inside a sentence", () => {
    assert.deepEqual(blocked(leaks.map(([n, v]) => [n, `Note: ${v} (from the statement).`] as const)), []);
  });
});

describe("findFullNumber: rule 1, Luhn-valid 13-19 digit runs, no exemptions", () => {
  it("blocks a Luhn-valid run even when every part is a well-formed token", () => {
    assert.equal(findFullNumber("2026-09-29 12305"), "full_number");
    assert.equal(findFullNumber("2026-09-29 $1,250.00 12305"), "full_number");
    assert.equal(findFullNumber("2019, 2020, 2021, 2004"), "full_number");
    assert.equal(findFullNumber("$123,456,789,007.00"), "full_number");
    assert.equal(findFullNumber("+86 138 0013 8002"), "full_number");
  });

  it("only counts 13 to 19 digits as a card", () => {
    // Both Luhn-valid; the date is set aside, leaving 4 and 6 digits.
    assert.equal(findFullNumber("2026-09-29 1200"), null);
    assert.equal(findFullNumber("2026-09-29 $1,250.00 123405"), null);
    assert.equal(findFullNumber("1999 2000 2001 2002 2002"), null);
    assert.equal(findFullNumber("+44 20 7946 0907"), null);
  });

  it("does not set aside a well-formed token whose own digits are a card", () => {
    assert.equal(findFullNumber("Box 7, $123,456,789,007.00"), "full_number");
    assert.equal(findFullNumber("Box 7, 2019, 2020, 2021, 2004"), "full_number");
    assert.equal(findFullNumber("Box 7, +86 138 0013 8002"), "full_number");
    assert.equal(findFullNumber("Box 7, +86 138 0013 8000"), null);
    // "ext" joins the 5 onto the phone's digits, which then fail Luhn.
    assert.equal(findFullNumber("Box 7, +86 138 0013 8002 ext 5"), null);
  });

  it("checks every loose run for a card, not just the first", () => {
    assert.equal(findFullNumber("2026-09-29 12305 and 7"), "full_number");
    assert.equal(findFullNumber("7 and 2026-09-29 12305"), "full_number");
  });
});

describe("findFullNumber: rule 2, SSN layout", () => {
  it("blocks 3-2-4 digits with any separators", () => {
    for (const ssn of [
      "123-45-6789",
      "123 45 6789",
      "123.45-6789",
      "123/45/6789",
      "123 - 45 - 6789",
      "123-45-6789.00",
      // The cents would set the last group aside; the SSN layout still counts.
      "123 - 45-6789.00",
      "123-45 - 6789.00",
    ]) {
      assert.equal(findFullNumber(ssn), "ssn", ssn);
    }
  });

  it("needs a separator in both places, and exactly 3-2-4 digits", () => {
    // Set aside as ZIP+4 or an amount unless read as an SSN.
    assert.equal(findFullNumber("12345-6789"), null);
    assert.equal(findFullNumber("123-456789.00"), null);
    // 10 digits: a full number, not an SSN.
    assert.equal(findFullNumber("1123-45-6789"), "full_number");
    assert.equal(findFullNumber("123-45-67890"), "full_number");
    assert.equal(findFullNumber("x123-45-67890"), "full_number");
  });
});

describe("findFullNumber: rule 3, 9+ digits joined across separators", () => {
  const rejects: Row[] = [
    ["ssn-3-3-3", "123 456 789"],
    ["acct10-3s", "0001 234 567"],
    ["acct15+-3s", "+000 123 456 789 012"],
    ["notes", "Checking acct 0001 234 567 at Example Bank"],
    ["split-by-punct", "12345.6789"],
    ["joined-by-slashes", "1234/5678/9"],
    ["bare-us-phone", "call 4045550123"],
    ["bare-intl-phone", "+4915123456789"],
    ["phone-then-digits", "(404) 555-0123 123456789"],
    ["four-spaced-years", "2020 2021 2022 2023"],
    ["year-and-digits", "2021 2022 4111 1111"],
    ["zip-with-space", "30301 1234"],
    ["zip-long", "30301-12345"],
    ["zip-short-lead", "3030-11234"],
    ["zip-after-digit", "130301-1234"],
  ];
  const allows: Row[] = [
    ["eight", "12345678"],
    ["nine-split-by-letters", "1234 y 56789"],
    ["phone-paren", "(404) 555-0123"],
    ["phone-intl", "+1 404 555 0123"],
    ["uk", "+44 20 7946 0958"],
    ["cn", "+86 138 0013 8000"],
    ["two-phones", "404 555 0123 or 404 555 0199"],
    ["two-phones-mixed", "Call (404) 555-0123, +44 20 7946 0958"],
    ["phone-and-last4", "(404) 555-0123, card ending 1234"],
    ["zip4", "30301-1234"],
    ["zip4-in-address", "Atlanta, GA 30301-1234"],
    ["policy", "POL-AB12C-7788"],
    ["vin-honda", "1HGCM82633A004352"],
    ["vin-acura", "JH4KA7561PC008269"],
    ["vin-in-text", "VIN 1HGCM82633A004352 (2003 Accord)"],
    ["serial", "SN: C02XK1ABJG5H"],
    ["policy-id", "HO3-4471-AZ"],
    ["date", "2026-09-29"],
    ["last4", "1234"],
    ["", ""],
  ];

  it("blocks 9+ digits once well-formed tokens are set aside", () => {
    assert.deepEqual(blocked(rejects), []);
  });

  it("allows the must-pass values", () => {
    assert.deepEqual(allowed(allows), []);
  });

  it("names 9 digits as an SSN and longer runs as a full number", () => {
    assert.equal(findFullNumber("123 456 789"), "ssn");
    assert.equal(findFullNumber("1234 5678 90"), "full_number");
  });

  it("keeps the digits on either side of a set-aside token apart", () => {
    assert.equal(findFullNumber("12345 2026-09-29 6789"), null);
    assert.equal(findFullNumber("12345, (404) 555-0123, 6789"), null);
    assert.equal(findFullNumber("2026-09-29 1 2027-09-29"), null);
    assert.equal(findFullNumber("2019, 2020 / 1 / 2021, 2022"), null);
    assert.equal(findFullNumber("404 555 0123, 1, 404 555 0199, 2, (404) 555-0100"), null);
  });

  it("ends a run at a word, and joins across a single letter only for Luhn and SSN", () => {
    assert.equal(findFullNumber("4111 1111 ab 1111 1111"), null);
    assert.equal(findFullNumber("4111 1111 a 1111 1111"), "full_number");
  });
});

describe("findFullNumber: letters and extension markers", () => {
  it("reads a single letter between digit groups as a separator for the Luhn and SSN checks", () => {
    assert.equal(findFullNumber("4111a1111b1111c1111"), "full_number");
    assert.equal(findFullNumber("4111 a 1111 b 1111 c 1111"), "full_number");
    assert.equal(findFullNumber("4111A1111B1111C1111"), "full_number");
    assert.equal(findFullNumber("123a45b6789"), "ssn");
    assert.equal(findFullNumber("123 A 45 B 6789"), "ssn");
  });

  it("does not join digits across a word of two or more letters", () => {
    assert.equal(findFullNumber("4111ab1111cd1111ef1111"), null);
    assert.equal(findFullNumber("123ab45cd6789"), null);
    assert.equal(findFullNumber("123 45ab 6789"), null);
  });

  it("does not use single letters to join digits for the 9+ rule", () => {
    assert.equal(findFullNumber("12345 y 6789"), null);
    assert.equal(findFullNumber("1G1ZT53826F10914"), null);
  });

  it("treats an extension marker on its own as a separator for every check", () => {
    for (const joined of ["12345 x 6789", "12345x6789", "12345 X 6789", "12345 ext 6789", "12345 EXT. 6789"]) {
      assert.equal(findFullNumber(joined), "ssn", joined);
    }
    assert.equal(findFullNumber("4111x1111x1111x1111"), "full_number");
    assert.equal(findFullNumber("4111 ext 1111 ext 1111 ext 1111"), "full_number");
    for (const apart of ["12345 xx 6789", "12345 next 6789", "12345 extra 6789", "12345 exts 6789", "12345 xy 6789"]) {
      assert.equal(findFullNumber(apart), null, apart);
    }
  });

  it("allows a formatted phone with an extension", () => {
    assert.equal(findFullNumber("Call (404) 555-0123 ext 12"), null);
    assert.equal(findFullNumber("(404) 555-0123 x12"), null);
  });
});

describe("hasVinCheckDigit", () => {
  it("accepts VINs whose ISO 3779 check digit at position 9 validates", () => {
    for (const vin of ["1HGCM82633A004352", "JH4KA7561PC008269", "AB123456789012345", "ab123456789012345", "AB000003X12345678"]) {
      assert.equal(hasVinCheckDigit(vin), true, vin);
    }
  });

  it("rejects a wrong check digit, including 0 where the sum gives X", () => {
    for (const vin of ["123456789ABCDEFGH", "1HGCM82653A004352", "JH4KA7561PC008260", "AB000003012345678", "AB123456789012346"]) {
      assert.equal(hasVinCheckDigit(vin), false, vin);
    }
  });
});

describe("findFullNumber: VINs", () => {
  it("sets aside 17 letters and digits with no I, O, or Q when the check digit validates", () => {
    for (const ok of [
      "1HGCM82633A004352",
      "JH4KA7561PC008269",
      "AB123456789012345",
      "ab123456789012345",
      "Title: AB123456789012345.",
      "12345678X12345AB5",
      "AB000003X12345678",
    ]) {
      assert.equal(findFullNumber(ok), null, ok);
    }
  });

  it("blocks a VIN-shaped token with a bad check digit when it holds an SSN or 9+ digits", () => {
    for (const [bad, kind] of [
      ["123456789ABCDEFGH", "ssn"],
      ["VIN 123456789ABCDEFGH on the title", "ssn"],
      ["WBAXY123456789ABC", "ssn"],
      ["ABCDEFGH123456789", "ssn"],
      ["JH4KA123456789PCX", "ssn"],
      ["AB000003012345678", "full_number"],
      ["AB123456789012346", "full_number"],
    ] as const) {
      assert.equal(findFullNumber(bad), kind, bad);
    }
  });

  it("only sets aside the VIN shape, even when the check digit would validate", () => {
    for (const bad of [
      "AB12345678901234",
      "AB1234567890123456",
      "AI123456889012345",
      "AO123456889012345",
      "AQ123456889012345",
      "12345678712345678",
      "ZAB123456789012345",
      "1AB123456789012345",
      "AB123456789012345C",
    ]) {
      assert.notEqual(findFullNumber(bad), null, bad);
    }
  });

  it("still blocks a VIN-shaped value whose single-letter-joined digits pass Luhn", () => {
    // Every letter stands alone, so the 14 digits form one loose run, and it is Luhn-valid.
    assert.equal(passesLuhn("11538104123456"), true);
    assert.equal(findFullNumber("1G1Y53810F4123456"), "full_number");
  });
});

describe("findFullNumber: dates", () => {
  it("sets aside ISO and US dates, and date ranges", () => {
    for (const ok of [
      "2026-09-29 - 2027-09-29",
      "Policy term 2026-09-29 - 2027-09-29, renews yearly",
      "2026/09/29 - 2027/09/29",
      "2026.09.29 2027.09.29",
      "09/29/2026 - 09/29/2027",
      "2026.9.1 - 2027.12.30",
      "1/1/1999 - 12/31/2000",
      "2026-10-19 - 2026-11-20",
    ]) {
      assert.equal(findFullNumber(ok), null, ok);
    }
  });

  it("only sets aside real dates", () => {
    // Each is 8 date digits plus one more: 9 digits unless the date is set aside.
    for (const bad of [
      "2026-13-29 1",
      "2026-00-29 1",
      "2026-09-32 1",
      "2026-09-40 1",
      "2026-09-00 1",
      "2126-09-29 1",
      "1826-09-29 1",
      "2026-09/29 1",
      "13/29/2026 1",
      "09/32/2026 1",
      "09/29/2126 1",
      "09/29-2026 1",
      "11999-09-29",
      "1999-09-291 1",
    ]) {
      assert.notEqual(findFullNumber(bad), null, bad);
    }
    assert.equal(findFullNumber("2026-09-29 1"), null);
    assert.equal(findFullNumber("09/29/2026 1"), null);
  });
});

describe("findFullNumber: amounts", () => {
  it("sets aside dollar amounts and amounts with cents", () => {
    for (const ok of [
      "$1,250.00",
      "$123,456,789.00",
      "$123,456,789",
      "$1,234,567,890.12",
      "1,234,567,890.12",
      "123,456,789.00",
      "12,345.67",
      "9,250.00",
      "12345678.90",
      "$12345678.90",
      "$12345678 1234",
      "$500, $750, $900",
      "Face value $250,000.00, premium $1,250.00",
    ]) {
      assert.equal(findFullNumber(ok), null, ok);
    }
  });

  it("only sets aside correctly grouped amounts of 12 whole-dollar digits or fewer", () => {
    for (const bad of [
      "123456789.00",
      "$123456789",
      "1,234,567,890",
      "$1234,567,890.00",
      "$1,234,567,890,123",
      "$1,234,567,890,123.00",
      "$1,23,456,789",
      "$1,234,567.891",
      "92345678.901",
      "12.34567890.12",
      "4,111,111,111,111,112.00",
      "123,456,789.5",
    ]) {
      assert.notEqual(findFullNumber(bad), null, bad);
    }
  });
});

describe("findFullNumber: year lists", () => {
  it("sets aside comma lists, and five or more spaced years", () => {
    for (const ok of [
      "2019, 2020, 2021",
      "2019, 2021, 2024",
      "2019,2020,2021",
      "2019 , 2020 , 2021",
      "1999, 2000, 2001, 2002",
      "1999 2000 2001 2002 2003",
      "1999  2000  2001  2002  2003",
      "Returns filed 2019, 2020, 2021, 2022, 2023, 2024",
    ]) {
      assert.equal(findFullNumber(ok), null, ok);
    }
  });

  it("only sets aside lists of real years", () => {
    for (const bad of [
      "2020 2021 2022 2023",
      "2119, 2120, 2121",
      "1999, 2100, 2001",
      "12019, 2020",
      "2019, 20201",
      "2019; 2020; 2021",
    ]) {
      assert.notEqual(findFullNumber(bad), null, bad);
    }
  });
});

describe("looksLikeFullNumber", () => {
  it("is true exactly when findFullNumber finds something", () => {
    assert.equal(looksLikeFullNumber("0001 234 567"), true);
    assert.equal(looksLikeFullNumber("2026-09-29 - 2027-09-29"), false);
  });
});

/** The four Hangul fillers: letters (Lo) that render as blank space. */
const HANGUL_FILLERS = [
  ["U+3164 HANGUL FILLER", "\u3164"],
  ["U+FFA0 HALFWIDTH HANGUL FILLER", "\uFFA0"],
  ["U+115F HANGUL CHOSEONG FILLER", "\u115F"],
  ["U+1160 HANGUL JUNGSEONG FILLER", "\u1160"],
] as const;

describe("normalizeForScan: default-ignorables and Hangul fillers", () => {
  it("turns each Hangul filler into a space", () => {
    for (const [name, f] of HANGUL_FILLERS) assert.equal(normalizeForScan(`12${f}34${f}`), "12 34 ", name);
  });

  it("removes every default-ignorable code point", () => {
    for (const di of ["\u034F", "\u200B", "\u17B4", "\u180E", "\u200E", "\u2064", "\uFE0F", "\u{E0001}", "\u{1D173}"]) {
      assert.equal(normalizeForScan(`12${di}34`), "1234", JSON.stringify(di));
    }
    assert.equal(normalizeForScan("Pat\u200D's plan"), "Pat's plan");
  });
});

describe("findFullNumber: Hangul fillers are separators for every check", () => {
  for (const [name, f] of HANGUL_FILLERS) {
    it(`blocks with ${name}`, () => {
      const rows: [string, string, "full_number" | "ssn"][] = [
        ["between the groups of a Luhn card", `4111${f}1111${f}1111${f}1111`, "full_number"],
        ["two between the groups of a Luhn card", `4111${f}${f}1111${f}${f}1111${f}${f}1111`, "full_number"],
        ["next to single letters in a Luhn card", `4111a${f}b1111c1111d1111`, "full_number"],
        ["between the 3-2-4 groups of an SSN", `123${f}45${f}6789`, "ssn"],
        ["two between the 3-2-4 groups of an SSN", `123${f}${f}45${f}${f}6789`, "ssn"],
        ["inside a bare 9-digit run", `12345${f}6789`, "ssn"],
        ["inside a bare 12-digit run", `1234${f}5678${f}9012`, "full_number"],
        ["in notes around a bare run", `Acct 0001${f}2345${f}6789 at Example Bank`, "full_number"],
      ];
      for (const [what, value, kind] of rows) assert.equal(findFullNumber(value), kind, what);
    });
  }

  it("blocks ZWSP, ZWJ, and soft hyphens between digits", () => {
    assert.equal(findFullNumber("123\u200B45\u200D67\u00AD89"), "ssn");
    assert.equal(findFullNumber("4111\u200B1111\u200D1111\u00AD1111"), "full_number");
    assert.equal(findFullNumber("1\u200B2\u200B3\u200B4\u200B5\u200B6\u200B7\u200B8\u200B9\u200B0"), "full_number");
    assert.equal(findFullNumber("123\u200D-45\u00AD-6789"), "ssn");
  });
});

/**
 * QA's two repros, then four generated joins: a valid US phone plus a 6-digit
 * extension whose 16 digits pass Luhn. The +1 and "1-" rows are Luhn-valid
 * only without the country code, and "extension" is a word that ends a run,
 * so only the national-number-plus-extension check catches them.
 */
const LUHN_EXTENSIONS = [
  "(404) 683-5510 x373597",
  "404-683-5510 ext. 373597",
  "+1 312-867-5309 extension 179190",
  "1-312-867-5309 x179190",
  "312.867.5309 ext 179190",
  "(312) 867-5309 #179190",
];

describe("findFullNumber: phone extensions", () => {
  it("blocks a phone whose digits and extension, joined, pass Luhn", () => {
    assert.equal(passesLuhn("4046835510373597"), true);
    assert.equal(passesLuhn("3128675309179190"), true);
    assert.equal(passesLuhn("13128675309179190"), false);
    for (const v of LUHN_EXTENSIONS) {
      assert.equal(findFullNumber(v), "full_number", v);
      assert.equal(findFullNumber(`Pat's desk line is ${v}, after 5pm.`), "full_number", v);
    }
  });

  it("still sets aside a phone whose extension does not make a card", () => {
    for (const ok of ["(404) 555-0123 ext 12", "+1 312-867-5309 extension 179191", "Desk: 1-312-867-5309 x179191"]) {
      assert.equal(findFullNumber(ok), null, ok);
    }
  });

  it("blocks a valid long international number whose national number passes Luhn", () => {
    // 13 national digits, Luhn-valid on their own, but not with the 49 in front.
    assert.equal(passesLuhn("2303092261144"), true);
    assert.equal(passesLuhn("492303092261144"), false);
    assert.equal(findFullNumber("+49 2303 0922 6114 4"), "full_number");
  });
});
