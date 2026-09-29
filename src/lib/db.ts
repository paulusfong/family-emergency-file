import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { resolveDbCredentials } from "./db-credentials";
import * as schema from "./schema";

export const client = createClient(resolveDbCredentials(process.env));

export const db = drizzle({ client, schema });
export type DB = typeof db;
