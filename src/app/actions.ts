"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { normalizeEmail } from "@/lib/email";
import { ensureHouseholdFile } from "@/lib/household";

/**
 * Request a magic link. Unknown and known addresses get the same neutral
 * "sent" message (no account enumeration); only a real delivery failure is
 * reported, so the user knows to retry.
 */
export async function requestMagicLink(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  if (!email) redirect("/sign-in?error=email");

  try {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: "/app" },
      headers: await headers(),
    });
  } catch (err) {
    console.error("magic-link send failed", err);
    redirect("/sign-in?error=send");
  }

  redirect("/sign-in?sent=1");
}

export async function confirmMagicLink(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/sign-in");

  try {
    const result = await auth.api.magicLinkVerify({
      query: { token },
      headers: await headers(),
    });
    const userId = result?.user?.id;
    if (userId) {
      await ensureHouseholdFile(userId);
    }
  } catch {
    redirect("/sign-in?error=invalid");
  }
  redirect("/app");
}

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}
