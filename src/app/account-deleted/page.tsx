import Link from "next/link";
import { Shell } from "@/components/shell";

export default function AccountDeletedPage() {
  return (
    <Shell>
      <section className="panel deleted-copy">
        <h1>Your account is deleted</h1>
        <p className="lede">
          Your account and your whole Family Emergency File were permanently deleted: every section, checklist item, entry,
          and export record.
        </p>
        <p>
          You are signed out here, and any other device that was signed in has lost access. Sign-in links we already emailed
          no longer work.
        </p>
        <p>Copies you downloaded earlier are not affected. Delete them yourself if you no longer need them.</p>
        <p>
          <Link href="/">Back to the home page</Link>
        </p>
      </section>
    </Shell>
  );
}
