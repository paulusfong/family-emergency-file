import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_DATABASE_URL,
  assertLocalUnlessAllowed,
  resolveDbCredentials,
} from "./db-credentials";

describe("resolveDbCredentials", () => {
  it("creates the parent directory for a file URL and omits authToken", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fef-cred-")), "nested", "deeper");
    const url = `file:${path.join(dir, "a.sqlite")}`;
    assert.deepEqual(resolveDbCredentials({ DATABASE_URL: url }), { url });
    assert.ok(fs.statSync(dir).isDirectory());
  });

  it("defaults to ./data/fef.sqlite", () => {
    assert.equal(DEFAULT_DATABASE_URL, "file:./data/fef.sqlite");
    assert.deepEqual(resolveDbCredentials({}), { url: "file:./data/fef.sqlite" });
    assert.ok(fs.statSync(path.resolve("data")).isDirectory());
  });

  it("passes DATABASE_AUTH_TOKEN, else TURSO_AUTH_TOKEN, for remote URLs", () => {
    const url = "libsql://example.turso.io";
    assert.deepEqual(resolveDbCredentials({ DATABASE_URL: url, DATABASE_AUTH_TOKEN: "a", TURSO_AUTH_TOKEN: "b" }), { url, authToken: "a" });
    assert.deepEqual(resolveDbCredentials({ DATABASE_URL: url, TURSO_AUTH_TOKEN: "b" }), { url, authToken: "b" });
    assert.deepEqual(resolveDbCredentials({ DATABASE_URL: url }), { url });
  });

  it("never creates directories for non-file URLs", () => {
    const cwd = process.cwd();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fef-remote-"));
    process.chdir(scratch);
    try {
      resolveDbCredentials({ DATABASE_URL: "https://remote.example/nested/dir/db" });
      assert.deepEqual(fs.readdirSync(scratch), []);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("assertLocalUnlessAllowed", () => {
  it("allows file URLs", () => {
    const creds = { url: "file:./data/fef.sqlite" };
    assert.equal(assertLocalUnlessAllowed(creds, {}), creds);
  });

  it("refuses remote URLs unless FEF_ALLOW_REMOTE_DB=1", () => {
    const creds = { url: "libsql://prod.turso.io", authToken: "t" };
    assert.throws(() => assertLocalUnlessAllowed(creds, {}), /Refusing to run drizzle-kit/);
    assert.throws(() => assertLocalUnlessAllowed(creds, { FEF_ALLOW_REMOTE_DB: "true" }), /FEF_ALLOW_REMOTE_DB=1/);
    assert.equal(assertLocalUnlessAllowed(creds, { FEF_ALLOW_REMOTE_DB: "1" }), creds);
  });
});

describe("db module", () => {
  it("builds a drizzle client on the test-local database", async () => {
    const mod = await import("./db");
    assert.match(process.env.DATABASE_URL ?? "", /^file:/);
    const rs = await mod.client.execute("select 1 as one");
    assert.equal(rs.rows[0].one, 1);
    assert.ok(mod.db);
  });
});
