/**
 * Pre-launch scan: runs the server's validateEntry checks (full numbers,
 * labelled credentials, field formats) over every stored entry, and the
 * full-number checks over the raw payload_json text too, so rows the app
 * cannot read are not skipped. It prints the row id and field name of each
 * finding, never a stored value (nor a key name the app does not define).
 *
 *   npm run scan:full-numbers
 *
 * Reads DATABASE_URL (default file:./data/fef.sqlite). Only a file: URL is
 * scanned unless FEF_ALLOW_REMOTE_DB=1. Exit 0 when every row passes, 1 when
 * any row is flagged, 2 when the scan cannot run.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { ENTRY_TYPE_DEFS, isEntryType, readPayload, validateEntry } from "../src/lib/entry-fields.ts";
import { findFullNumber } from "../src/lib/privacy-warn.ts";

export const DEFAULT_DATABASE_URL = "file:./data/fef.sqlite";

/** The libSQL config to scan, or an Error explaining why the scan refuses to run. */
export function resolveTarget(env) {
  const url = env.DATABASE_URL || DEFAULT_DATABASE_URL;
  if (url.startsWith("file:")) {
    const file = path.resolve(url.slice("file:".length));
    if (!fs.existsSync(file)) return new Error(`No database file at ${file}.`);
    return { url };
  }
  if (env.FEF_ALLOW_REMOTE_DB !== "1") {
    return new Error(
      "Refusing to scan a non-file DATABASE_URL. Set FEF_ALLOW_REMOTE_DB=1 to scan a remote database on purpose.",
    );
  }
  const authToken = env.DATABASE_AUTH_TOKEN || env.TURSO_AUTH_TOKEN;
  return authToken ? { url, authToken } : { url };
}

/**
 * What the app would not see in a stored payload: a full number anywhere in
 * the raw text ("payload_json"), text that is not JSON
 * ("payload_json:unparseable") or not a JSON object
 * ("payload_json:not-an-object"), and non-string values holding digits, which
 * readPayload drops ("<field>:non-string", or "payload_json:non-string" under
 * a key the entry type does not define).
 */
export function rawFindings(type, raw) {
  const fields = findFullNumber(raw) === null ? [] : ["payload_json"];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [...fields, "payload_json:unparseable"];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [...fields, "payload_json:not-an-object"];
  }
  const known = new Set(isEntryType(type) ? ENTRY_TYPE_DEFS[type].fields.map((f) => f.name) : []);
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" && /[0-9]/.test(JSON.stringify(value))) {
      fields.push(known.has(key) ? `${key}:non-string` : "payload_json:non-string");
    }
  }
  return fields;
}

/**
 * Findings as { id, field } pairs, in row order: the raw payload checks
 * (rawFindings), then an unknown entry type as field "entry_type", or every
 * field validateEntry rejected ("label" included).
 */
export function scanRows(rows) {
  const findings = [];
  for (const row of rows) {
    const id = String(row.id);
    const type = row.entry_type;
    const raw = String(row.payload_json);
    for (const field of new Set(rawFindings(type, raw))) findings.push({ id, field });
    if (!isEntryType(type)) {
      findings.push({ id, field: "entry_type" });
      continue;
    }
    const values = { ...readPayload(type, raw), label: row.label };
    const result = validateEntry(type, values);
    if (!result.ok) for (const field of Object.keys(result.fieldErrors)) findings.push({ id, field });
  }
  return findings;
}

/** Runs the scan and returns the exit code; output lines hold ids and field names only. */
export async function main(env = process.env, out = console.log, err = console.error) {
  const target = resolveTarget(env);
  if (target instanceof Error) {
    err(target.message);
    return 2;
  }
  const client = createClient(target);
  try {
    const { rows } = await client.execute("SELECT id, entry_type, label, payload_json FROM entries ORDER BY id");
    const findings = scanRows(rows);
    for (const { id, field } of findings) out(`${id}\t${field}`);
    const flagged = new Set(findings.map((f) => f.id)).size;
    out(`Scanned ${rows.length} entries: ${flagged} flagged (${findings.length} findings).`);
    return findings.length ? 1 : 0;
  } catch (error) {
    // The message names the table or connection problem; it never holds row values.
    err(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
