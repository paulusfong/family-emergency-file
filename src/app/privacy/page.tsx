import { Shell } from "@/components/shell";
import { getSessionUser } from "@/lib/session";

export default async function PrivacyPage() {
  const user = await getSessionUser();

  return (
    <Shell signedIn={Boolean(user)}>
      <section className="panel">
        <h1>Privacy</h1>
        <p className="lede">Stub policy for soft-launch foundations.</p>
        <ul>
          <li>We store the email you use to sign in and the household file you create.</li>
          <li>Magic-link tokens are short-lived and hashed at rest.</li>
          <li>Do not store passwords in this app — record where access lives, not the secrets.</li>
          <li>Account delete and data export arrive in a later release.</li>
        </ul>
      </section>
    </Shell>
  );
}
