import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts)$/.test(d.name) && !d.name.includes(".test.") ? [full] : [];
  });
}

const files = sourceFiles(path.resolve("src"));
const tsx = files.filter((f) => f.endsWith(".tsx"));

describe("no secret inputs (FR-P1)", () => {
  it("scans the UI source tree", () => {
    assert.ok(tsx.length >= 10, `expected UI files, found ${tsx.length}`);
    assert.ok(tsx.some((f) => f.endsWith("entry-editor.tsx")));
  });

  /**
   * The one masked field is the encrypted-export passphrase (PR-FEF-4). It is
   * a client component with unnamed inputs and no form action, so no form can
   * submit it; it is used by age in the browser and never reaches the server.
   */
  const PASSPHRASE_ONLY = path.resolve("src/components/encrypted-export.tsx");

  it("has no password-type inputs anywhere in src except the client-side export passphrase", () => {
    const passwordType = /type\s*=\s*\{?\s*["'`]password["'`]/i;
    const withPassword = files.filter((f) => passwordType.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(withPassword, [PASSPHRASE_ONLY]);
    const text = fs.readFileSync(PASSPHRASE_ONLY, "utf8");
    assert.match(text, /^"use client";/);
    assert.doesNotMatch(text, /\bname=/);
    assert.doesNotMatch(text, /\baction=/);
    for (const f of files) {
      assert.doesNotMatch(fs.readFileSync(f, "utf8"), /kind:\s*["']password["']/i, f);
    }
  });

  it("has no form field named for a password, PIN, CVV, or full number", () => {
    const secretName = /name\s*[=:]\s*\{?\s*["'`](password|passcode|pin|cvv|ssn|accountNumber|cardNumber|policyNumber|routingNumber)["'`]/i;
    for (const f of files) {
      assert.doesNotMatch(fs.readFileSync(f, "utf8"), secretName, f);
    }
  });
});
