import Link from "next/link";
import { Shell } from "@/components/shell";
import { CONFIRM_WORD } from "@/lib/account";
import { requireUser } from "@/lib/session";
import { deleteAccount } from "./actions";

export default async function DeleteAccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;

  return (
    <Shell signedIn>
      <section className="panel">
        <p className="hint">
          <Link href="/app/settings">← Settings</Link>
        </p>
        <h1>Delete your account</h1>
        <p className="lede">
          This permanently deletes the account for <strong>{user.email}</strong> and your whole Family Emergency File.
        </p>
        <ul className="delete-list">
          <li>All twelve sections, every checklist item, and every entry</li>
          <li>Your export history and your sign-in sessions on every device</li>
        </ul>
        <p>
          It cannot be undone, and we cannot recover it. If you want a copy, <Link href="/app/export">export your file</Link>{" "}
          first.
        </p>
        <form action={deleteAccount} className="delete-form">
          <div className="field">
            <label htmlFor="confirm">Type {CONFIRM_WORD} to confirm</label>
            <input
              id="confirm"
              name="confirm"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "confirm-error" : undefined}
            />
            {error ? (
              <p className="field-error" id="confirm-error" role="alert">
                Type {CONFIRM_WORD} in capital letters to delete your account.
              </p>
            ) : null}
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-danger">
              Delete my account and file
            </button>
            <Link href="/app/settings">Cancel</Link>
          </div>
        </form>
      </section>
    </Shell>
  );
}
