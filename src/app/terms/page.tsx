import { Shell } from "@/components/shell";
import { getSessionUser } from "@/lib/session";

export default async function TermsPage() {
  const user = await getSessionUser();

  return (
    <Shell signedIn={Boolean(user)}>
      <section className="panel">
        <h1>Terms</h1>
        <p className="lede">Stub terms for soft-launch foundations.</p>
        <ul>
          <li>This app is a personal planning aid, not legal, financial, or medical advice.</li>
          <li>You are responsible for the accuracy of information you enter.</li>
          <li>The service is provided as-is during soft launch.</li>
        </ul>
      </section>
    </Shell>
  );
}
