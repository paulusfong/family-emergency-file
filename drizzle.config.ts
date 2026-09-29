import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:./data/fef.sqlite";
const authToken =
  process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN ?? undefined;

export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: authToken ? { url, authToken } : { url },
});
