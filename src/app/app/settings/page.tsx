import Link from "next/link";
import { signOut } from "@/app/actions";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/session";

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <Shell signedIn>
      <section className="panel">
        <h1>Settings</h1>
        <p className="lede">Signed in as {user.email}</p>
        <h2>Export</h2>
        <p>
          Download your whole file as a printable PDF, JSON, or a passphrase-protected copy.{" "}
          <Link href="/app/export">Export your file</Link>
        </p>
        <form action={signOut} style={{ marginTop: "1.5rem" }}>
          <button type="submit" className="btn-ghost">
            Sign out
          </button>
        </form>
        <div className="danger-zone">
          <h2>Delete account</h2>
          <p>Permanently delete your account and everything in your file.</p>
          <Link className="btn btn-danger" href="/app/settings/delete">
            Delete account…
          </Link>
        </div>
      </section>
    </Shell>
  );
}
