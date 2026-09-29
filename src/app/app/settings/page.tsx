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
        <p>Account delete, export, and review reminders come in later PRs.</p>
        <form action={signOut} style={{ marginTop: "1.5rem" }}>
          <button type="submit" className="btn-ghost">
            Sign out
          </button>
        </form>
      </section>
    </Shell>
  );
}
