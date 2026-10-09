"use server";

import { revalidatePath } from "next/cache";
import { acknowledgePrivacy } from "@/lib/household";
import { requireHousehold } from "@/lib/session";

/** Dismiss the first-run privacy sheet for the signed-in owner's file. */
export async function dismissPrivacySheet() {
  const { file } = await requireHousehold();
  await acknowledgePrivacy(file.id);
  revalidatePath("/app");
}
