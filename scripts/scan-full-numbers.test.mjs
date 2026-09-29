import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createClient } from "@libsql/client";
import { applySchema } from "../src/test/apply-schema.ts";
import { DEFAULT_DATABASE_URL, main, rawFindings, resolveTarget, scanRows } from "./scan-full-numbers.mjs";

const SECRETS = {
  card: "4111 1111 1111 1111",
  ssn: "123-45-6789",
  ext: "(404) 683-5510 x373597",
  credential: "password: hunter2",
  bare: "4045550123",
};

const rows = [
  { id: "e-ok", entry_type: "account", label: "Joint checking", payload_json: '{"institution":"Example Bank","last4":"1111"}' },
  { id: "e-card", entry_type: "note", label: "Wallet", payload_json: JSON.stringify({ notes: `Card ${SECRETS.card}` }) },
  { id: "e-ssn", entry_type: "note", label: `SSN ${SECRETS.ssn}`, payload_json: "{}" },
  { id: "e-phone", entry_type: "contact", label: "Pat", payload_json: JSON.stringify({ phone: SECRETS.ext, email: "pat@example.com", notes: SECRETS.credential }) },
  { id: "e-bare", entry_type: "contact", label: "Sam", payload_json: JSON.stringify({ phone: SECRETS.bare }) },
  { id: "e-type", entry_type: "password_vault", label: "Old row", payload_json: "{}" },
  { id: "e-json", entry_type: "note", label: "Broken payload", payload_json: "{not json" },
  { id: "e-hidden", entry_type: "note", label: "Old field", payload_json: JSON.stringify({ cardNumber: SECRETS.card }) },
  { id: "e-num", entry_type: "account", label: "Numeric", payload_json: '{"last4":4111111111111111}' },
];

async function makeDb(withRows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-scan-"));
  const file = path.join(dir, "scan.sqlite");
  const client = createClient({ url: `file:${file}` });
  await applySchema(client);
  await client.execute("PRAGMA foreign_keys = OFF");
  for (const r of withRows) {
    await client.execute({
      sql: "INSERT INTO entries (id, section_id, entry_type, label, payload_json) VALUES (?, 'sec-1', ?, ?, ?)",
      args: [r.id, r.entry_type, r.label, r.payload_json],
    });
  }
  client.close();
  return file;
}

async function run(env) {
  const out = [];
  const err = [];
  const code = await main(env, (line) => out.push(line), (line) => err.push(line));
  return { code, out, err };
}

describe("scan-full-numbers: resolveTarget", () => {
  it("scans a file: URL that exists, and refuses a missing file", async () => {
    const file = await makeDb([]);
    assert.deepEqual(resolveTarget({ DATABASE_URL: `file:${file}` }), { url: `file:${file}` });
    const missing = resolveTarget({ DATABASE_URL: "file:/nonexistent/fef.sqlite" });
    assert.ok(missing instanceof Error);
    assert.equal(missing.message, "No database file at /nonexistent/fef.sqlite.");
  });

  it("defaults to the app's local DB when DATABASE_URL is unset or blank", () => {
    assert.equal(DEFAULT_DATABASE_URL, "file:./data/fef.sqlite");
    for (const env of [{}, { DATABASE_URL: "" }]) {
      const target = resolveTarget(env);
      const expected = path.resolve("data/fef.sqlite");
      if (target instanceof Error) assert.equal(target.message, `No database file at ${expected}.`);
      else assert.deepEqual(target, { url: DEFAULT_DATABASE_URL });
    }
  });

  it("refuses a remote URL unless FEF_ALLOW_REMOTE_DB=1", () => {
    for (const allow of [undefined, "0", "true"]) {
      const refused = resolveTarget({ DATABASE_URL: "libsql://fef.turso.io", FEF_ALLOW_REMOTE_DB: allow, DATABASE_AUTH_TOKEN: "t" });
      assert.ok(refused instanceof Error);
      assert.match(refused.message, /^Refusing to scan a non-file DATABASE_URL\. Set FEF_ALLOW_REMOTE_DB=1/);
    }
    const allowed = { DATABASE_URL: "libsql://fef.turso.io", FEF_ALLOW_REMOTE_DB: "1" };
    assert.deepEqual(resolveTarget(allowed), { url: "libsql://fef.turso.io" });
    assert.deepEqual(resolveTarget({ ...allowed, DATABASE_AUTH_TOKEN: "a" }), { url: "libsql://fef.turso.io", authToken: "a" });
    assert.deepEqual(resolveTarget({ ...allowed, TURSO_AUTH_TOKEN: "b" }), { url: "libsql://fef.turso.io", authToken: "b" });
    assert.deepEqual(resolveTarget({ ...allowed, DATABASE_AUTH_TOKEN: "", TURSO_AUTH_TOKEN: "b" }), {
      url: "libsql://fef.turso.io",
      authToken: "b",
    });
  });
});

describe("scan-full-numbers: scanRows", () => {
  it("names the id and field of every finding: raw payload first, then validateEntry", () => {
    assert.deepEqual(scanRows(rows), [
      { id: "e-card", field: "payload_json" },
      { id: "e-card", field: "notes" },
      { id: "e-ssn", field: "label" },
      { id: "e-phone", field: "payload_json" },
      { id: "e-phone", field: "phone" },
      { id: "e-phone", field: "notes" },
      { id: "e-bare", field: "payload_json" },
      { id: "e-bare", field: "phone" },
      { id: "e-type", field: "entry_type" },
      { id: "e-json", field: "payload_json:unparseable" },
      { id: "e-hidden", field: "payload_json" },
      { id: "e-num", field: "payload_json" },
      { id: "e-num", field: "last4:non-string" },
    ]);
  });

  it("scans the raw payload of a row with an unknown entry type", () => {
    assert.deepEqual(scanRows([{ id: "t", entry_type: "vault", label: "x", payload_json: '{"pin":[123,45,6789]}' }]), [
      { id: "t", field: "payload_json" },
      { id: "t", field: "payload_json:non-string" },
      { id: "t", field: "entry_type" },
    ]);
  });

  it("names each raw finding once per row", () => {
    assert.deepEqual(scanRows([{ id: "d", entry_type: "note", label: "x", payload_json: '{"a":1,"b":2}' }]), [
      { id: "d", field: "payload_json:non-string" },
    ]);
  });

  it("returns nothing for clean rows", () => {
    assert.deepEqual(scanRows([rows[0]]), []);
    assert.deepEqual(scanRows([]), []);
  });
});

describe("scan-full-numbers: rawFindings", () => {
  it("flags a full number anywhere in the raw text, even under a key the app drops", () => {
    assert.deepEqual(rawFindings("note", JSON.stringify({ notes: `Card ${SECRETS.card}` })), ["payload_json"]);
    assert.deepEqual(rawFindings("note", JSON.stringify({ oldNotes: SECRETS.ssn })), ["payload_json"]);
    assert.deepEqual(rawFindings("note", '{"notes":"Room 12, Box 30301"}'), []);
    assert.deepEqual(rawFindings("account", '{"institution":"Example Bank","last4":"1111","whereToFind":"Safe 2019"}'), []);
  });

  it("flags text that is not JSON, or not a JSON object", () => {
    assert.deepEqual(rawFindings("note", "{not json"), ["payload_json:unparseable"]);
    assert.deepEqual(rawFindings("note", `{not json ${SECRETS.card}`), ["payload_json", "payload_json:unparseable"]);
    assert.deepEqual(rawFindings("note", "null"), ["payload_json:not-an-object"]);
    assert.deepEqual(rawFindings("note", "7"), ["payload_json:not-an-object"]);
    assert.deepEqual(rawFindings("note", JSON.stringify([SECRETS.card])), ["payload_json", "payload_json:not-an-object"]);
    assert.deepEqual(rawFindings("note", "{}"), []);
  });

  it("flags non-string values that hold digits, by field name only when the type defines it", () => {
    assert.deepEqual(rawFindings("account", '{"last4":1234}'), ["last4:non-string"]);
    assert.deepEqual(rawFindings("note", '{"notes":["12"]}'), ["notes:non-string"]);
    assert.deepEqual(rawFindings("note", '{"secret99":{"n":12}}'), ["payload_json:non-string"]);
    assert.deepEqual(rawFindings("vault", '{"notes":12}'), ["payload_json:non-string"]);
    assert.deepEqual(rawFindings("note", '{"notes":true,"label":null,"x":["a"]}'), []);
  });
});

describe("scan-full-numbers: main", () => {
  it("prints only row ids and field names, never a stored value, and exits 1", async () => {
    const file = await makeDb(rows);
    const { code, out, err } = await run({ DATABASE_URL: `file:${file}` });
    assert.equal(code, 1);
    assert.deepEqual(err, []);
    assert.deepEqual(out, [
      "e-bare\tpayload_json",
      "e-bare\tphone",
      "e-card\tpayload_json",
      "e-card\tnotes",
      "e-hidden\tpayload_json",
      "e-json\tpayload_json:unparseable",
      "e-num\tpayload_json",
      "e-num\tlast4:non-string",
      "e-phone\tpayload_json",
      "e-phone\tphone",
      "e-phone\tnotes",
      "e-ssn\tlabel",
      "e-type\tentry_type",
      "Scanned 9 entries: 8 flagged (13 findings).",
    ]);
    const printed = out.join("\n");
    for (const secret of [...Object.values(SECRETS), "hunter2", "4111", "373597", "Joint checking", "Example Bank", "cardNumber"]) {
      assert.equal(printed.includes(secret), false, secret);
    }
  });

  it("exits 0 when every row passes", async () => {
    const file = await makeDb([rows[0]]);
    assert.deepEqual(await run({ DATABASE_URL: `file:${file}` }), {
      code: 0,
      out: ["Scanned 1 entries: 0 flagged (0 findings)."],
      err: [],
    });
  });

  it("exits 2 without connecting when the target is refused", async () => {
    assert.deepEqual(await run({ DATABASE_URL: "libsql://fef.turso.io" }), {
      code: 2,
      out: [],
      err: ["Refusing to scan a non-file DATABASE_URL. Set FEF_ALLOW_REMOTE_DB=1 to scan a remote database on purpose."],
    });
  });

  it("exits 2 when the database has no entries table", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-scan-"));
    const file = path.join(dir, "empty.sqlite");
    fs.writeFileSync(file, "");
    const { code, out, err } = await run({ DATABASE_URL: `file:${file}` });
    assert.equal(code, 2);
    assert.deepEqual(out, []);
    assert.equal(err.length, 1);
    assert.match(err[0], /^Scan failed: .*no such table: entries/);
  });
});
