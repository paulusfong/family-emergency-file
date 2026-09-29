import fs from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

export const DEFAULT_DATABASE_URL = "file:./data/fef.sqlite";

export type DbCredentials = { url: string; authToken?: string };

/** Resolve libSQL credentials and create the parent dir for local file DBs. */
export function resolveDbCredentials(env: Env): DbCredentials {
  const url = env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const authToken = env.DATABASE_AUTH_TOKEN ?? env.TURSO_AUTH_TOKEN;
  if (url.startsWith("file:")) {
    fs.mkdirSync(path.dirname(path.resolve(url.slice("file:".length))), {
      recursive: true,
    });
  }
  return authToken ? { url, authToken } : { url };
}

/**
 * drizzle-kit guard: refuse non-file databases unless FEF_ALLOW_REMOTE_DB=1, so
 * an ambient DATABASE_URL can never push this schema to someone else's DB.
 */
export function assertLocalUnlessAllowed(creds: DbCredentials, env: Env): DbCredentials {
  if (!creds.url.startsWith("file:") && env.FEF_ALLOW_REMOTE_DB !== "1") {
    throw new Error(
      "Refusing to run drizzle-kit against a non-file DATABASE_URL. Set FEF_ALLOW_REMOTE_DB=1 to target a remote database on purpose.",
    );
  }
  return creds;
}
