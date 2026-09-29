/** Session cookie names used by better-auth (plain + __Secure- prefix). */
export const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

/** True when any better-auth session cookie value is present. */
export function hasSessionCookie(
  getCookie: (name: string) => { value: string } | undefined,
): boolean {
  return SESSION_COOKIE_NAMES.some((name) => Boolean(getCookie(name)?.value));
}

/** Build the /sign-in redirect target for an unauthenticated /app hit. */
export function signInRedirectUrl(requestUrl: string, pathname: string): string {
  const signIn = new URL("/sign-in", requestUrl);
  signIn.searchParams.set("next", pathname);
  return signIn.toString();
}
