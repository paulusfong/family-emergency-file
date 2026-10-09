import Link from "next/link";

/**
 * First-run privacy sheet (PRD F1.2, FEF-16): what this file is, and what it
 * is not. Shown on the dashboard until the owner dismisses it; the dismissal
 * is stored on the household file, so it follows them across devices.
 */
export function PrivacySheet({ dismiss }: { dismiss: () => Promise<void> }) {
  return (
    <section className="onboarding" aria-labelledby="privacy-sheet-title">
      <p className="onboarding-kicker">Before you start</p>
      <h2 id="privacy-sheet-title">Access plans, never passwords</h2>
      <p>
        This file is a map for the person who would step in if something happened to you. It records
        where things are and who to call, not the secrets themselves.
      </p>
      <ul>
        <li>
          Write where a login lives, like “the family vault in our password manager.” Never the password,
          PIN, or security answers.
        </li>
        <li>Keep account, card, and ID numbers to the last 4 digits.</li>
        <li>If something you type looks like a password or a full number, you’ll see a warning before it saves.</li>
      </ul>
      <p>
        A good first stop is <Link href="/app/sections/S2">S2 Key contacts</Link> or{" "}
        <Link href="/app/sections/S3">S3 Banking &amp; cash</Link>.
      </p>
      <form action={dismiss}>
        <button type="submit">Got it</button>
      </form>
    </section>
  );
}
