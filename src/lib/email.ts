const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim + lowercase; returns null when the value is not a plausible address. */
export function normalizeEmail(raw: unknown): string | null {
  const email = String(raw).trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}
