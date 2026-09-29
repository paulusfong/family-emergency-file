import Link from "next/link";
import { Shell } from "@/components/shell";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const user = await getSessionUser();
  if (user) redirect("/app");

  return (
    <Shell>
      <section className="panel">
        <h1>Your household, ready for the unexpected</h1>
        <p className="lede">
          Family Emergency File is a private checklist for mapping accounts,
          contacts, documents, and access plans — so a trusted person can act
          when you cannot. It is not a password manager and not legal advice.
        </p>
        <p>
          <Link className="btn" href="/sign-in">
            Sign in with email
          </Link>
        </p>
        <p className="disclaimer">
          Magic-link only. No passwords stored in this app.
        </p>
      </section>
    </Shell>
  );
}
