/**
 * Preloaded into every test process (see package.json "test").
 *
 * 1. Never let unit tests reach a remote libSQL/Turso database from the ambient
 *    shell env: drop auth tokens and point DATABASE_URL at a throwaway file.
 *    Tests that need their own DB still override DATABASE_URL before importing.
 * 2. Register loader hooks that stub .css imports.
 */
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

delete process.env.DATABASE_AUTH_TOKEN;
delete process.env.TURSO_AUTH_TOKEN;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-test-"));
process.env.DATABASE_URL = `file:${path.join(dir, "default.sqlite")}`;

register("./css-hooks.mjs", import.meta.url);
