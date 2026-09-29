"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ensureHouseholdFile } from "@/lib/household";

export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) redirect("/sign-in");

  try {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: "/app" },
      headers: await headers(),
    });
  } catch (err) {
    console.error("magic-link request failed", err);
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
