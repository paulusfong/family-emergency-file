/**
 * Pre-launch scan: runs the server's validateEntry checks (full numbers,
 * labelled credentials, field formats) over every stored entry and prints the
 * row id and field name of each failure. It never prints a stored value.
 *
 *   npm run scan:full-numbers
 *
 * Reads DATABASE_URL (default file:./data/fef.sqlite). Only a file: URL is
 * scanned unless FEF_ALLOW_REMOTE_DB=1. Exit 0 when every row passes, 1 when
 * any row fails, 2 when the scan cannot run.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { isEntryType, readPayload, validateEntry } from "../src/lib/entry-fields.ts";

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
 * Failures as { id, field } pairs, in row order. An unknown entry type fails
 * as field "entry_type"; every other failure names the field validateEntry
 * rejected ("label" included).
 */
export function scanRows(rows) {
  const findings = [];
  for (const row of rows) {
    const id = String(row.id);
    const type = row.entry_type;
    if (!isEntryType(type)) {
      findings.push({ id, field: "entry_type" });
      continue;
    }
    const values = { ...readPayload(type, String(row.payload_json)), label: row.label };
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
    out(`Scanned ${rows.length} entries: ${flagged} failed validateEntry (${findings.length} fields).`);
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
