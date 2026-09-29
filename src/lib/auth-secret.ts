/** Fail closed: never ship a hardcoded production fallback secret. */
export function resolveAuthSecret(env: Record<string, string | undefined>): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    if (env.NODE_ENV === "development") {
      throw new Error(
        "BETTER_AUTH_SECRET is missing or shorter than 32 characters. Set it in .env.local for local development.",
      );
    }
    throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters");
  }
  return secret;
}
