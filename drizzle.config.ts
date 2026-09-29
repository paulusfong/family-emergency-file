import { defineConfig } from "drizzle-kit";
import {
  assertLocalUnlessAllowed,
  resolveDbCredentials,
} from "./src/lib/db-credentials";

export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: assertLocalUnlessAllowed(
    resolveDbCredentials(process.env),
    process.env,
  ),
});
