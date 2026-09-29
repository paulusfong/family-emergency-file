import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { ensureHouseholdFile } from "./household";
import { unauthenticatedRedirect } from "./session-gate";

export async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getSessionUser();
  const dest = unauthenticatedRedirect(user);
  if (dest) redirect(dest);
  return user!;
}

/** Auth gate + ensure household file exists for the signed-in user. */
export async function requireHousehold() {
  const user = await requireUser();
  const file = await ensureHouseholdFile(user.id);
  return { user, file };
}
