import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveDbCredentials } from "./db";

describe("db module", () => {
  it("exports drizzle client", async () => {
    const mod = await import("./db");
    assert.ok(mod.db);
    assert.ok(mod.client);
  });

  it("resolveDbCredentials defaults and auth token branches", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-cred-"));
    const fileUrl = `file:${path.join(dir, "a.sqlite")}`;
    const plain = resolveDbCredentials({ DATABASE_URL: fileUrl });
    assert.equal(plain.url, fileUrl);
    assert.equal(plain.authToken, undefined);

    const withToken = resolveDbCredentials({
      DATABASE_URL: "libsql://example.turso.io",
      DATABASE_AUTH_TOKEN: "tok",
    });
    assert.equal(withToken.url, "libsql://example.turso.io");
    assert.equal(withToken.authToken, "tok");

    const turso = resolveDbCredentials({
      DATABASE_URL: "libsql://example.turso.io",
      TURSO_AUTH_TOKEN: "t2",
    });
    assert.equal(turso.authToken, "t2");

    const fallback = resolveDbCredentials({});
    assert.match(fallback.url, /fef\.sqlite/);

    const remoteNoToken = resolveDbCredentials({
      DATABASE_URL: "libsql://example.turso.io",
    });
    assert.equal(remoteNoToken.authToken, undefined);
  });
});
