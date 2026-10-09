"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CONFIRM_WORD, deleteUserData } from "@/lib/account";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/session";

/**
 * Hard delete: the person must type DELETE. Everything goes in one batch
 * (a single transaction), then the session cookie is cleared.
 */
export async function deleteAccount(formData: FormData) {
  const user = await requireUser();
  if (String(formData.get("confirm")).trim() !== CONFIRM_WORD) {
    redirect("/app/settings/delete?error=confirm");
  }
  await deleteUserData(user.id);
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // The session row is already gone, so the cookie no longer signs anyone in.
  }
  redirect("/account-deleted");
}
