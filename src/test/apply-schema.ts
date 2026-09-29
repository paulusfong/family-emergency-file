import fs from "node:fs";
import path from "node:path";
import type { Client } from "@libsql/client";

/** Apply drizzle/0000_init.sql (generated from src/lib/schema.ts) to a test DB. */
export async function applySchema(client: Client) {
  const sqlFile = fs.readFileSync(
    path.join(process.cwd(), "drizzle/0000_init.sql"),
    "utf8",
  );
  for (const statement of sqlFile
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await client.execute(statement);
  }
}
