/** Pure gate used by requireUser and covered by unit tests. */
export function unauthenticatedRedirect(
  user: { id: string } | null | undefined,
): "/sign-in" | null {
  if (!user) return "/sign-in";
  return null;
}
