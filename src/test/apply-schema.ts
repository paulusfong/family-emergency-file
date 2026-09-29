import fs from "node:fs";
import path from "node:path";
import type { Client } from "@libsql/client";

/** Apply every drizzle/*.sql migration, in journal order, to a test DB. */
export async function applySchema(client: Client) {
  const dir = path.join(process.cwd(), "drizzle");
  const journal = JSON.parse(
    fs.readFileSync(path.join(dir, "meta/_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    const sqlText = fs.readFileSync(path.join(dir, `${tag}.sql`), "utf8");
    for (const statement of sqlText
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await client.execute(statement);
    }
  }
}
