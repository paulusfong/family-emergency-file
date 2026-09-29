import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";

export function resolveDbCredentials(env: Record<string, string | undefined>): {
  url: string;
  authToken?: string;
} {
  const url = env.DATABASE_URL ?? "file:./data/fef.sqlite";
  const authToken =
    env.DATABASE_AUTH_TOKEN ?? env.TURSO_AUTH_TOKEN ?? undefined;
  if (url.startsWith("file:")) {
    const file = url.replace(/^file:/, "");
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return authToken ? { url, authToken } : { url };
}

const credentials = resolveDbCredentials(process.env);
export const client = createClient(credentials);

export const db = drizzle({ client, schema });
export type DB = typeof db;
