type Env = Record<string, string | undefined>;

export const DEFAULT_BASE_URL = "http://localhost:3000";

/**
 * App origin used in magic-link URLs. Fails closed in production (or on Vercel)
 * so links never point at localhost; defaults to local dev otherwise.
 */
export function resolveBaseURL(env: Env): string {
  const url = env.BETTER_AUTH_URL;
  if (url) return url;
  if (env.NODE_ENV === "production" || env.VERCEL === "1") {
    throw new Error("BETTER_AUTH_URL must be set in production");
  }
  return DEFAULT_BASE_URL;
}
