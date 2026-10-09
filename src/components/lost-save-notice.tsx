"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { dismissLostSave, getLostSave, subscribeLostSave } from "@/lib/lost-save";

const noLostSave = () => null;

/** Shows a save that failed after the person left its editor (see lib/lost-save). */
export function LostSaveNotice() {
  const lost = useSyncExternalStore(subscribeLostSave, getLostSave, noLostSave);
  if (!lost) return null;
  return (
    <div className="toast toast-error" role="alert">
      <p>{lost.message}</p>
      {lost.href ? (
        <Link href={lost.href} onClick={dismissLostSave}>
          Open it again
        </Link>
      ) : null}
      <button type="button" onClick={dismissLostSave}>
        Dismiss
      </button>
    </div>
  );
}
