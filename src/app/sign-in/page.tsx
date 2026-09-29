import { requestMagicLink } from "@/app/actions";
import { Shell } from "@/components/shell";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect("/app");
  const { sent, error } = await searchParams;

  return (
    <Shell>
      <section className="panel">
        <h1>Sign in</h1>
        <p className="lede">
          Enter your email and we will send a one-time magic link. No password.
        </p>
        {sent ? (
          <p className="flash">
            Check your email for a sign-in link. In local dev without Resend,
            the link is printed in the server console and written to{" "}
            <code>tmp/last-magic-link.txt</code>.
          </p>
        ) : null}
        {error ? (
          <p className="error">That link is invalid or expired. Request a new one.</p>
        ) : null}
        <form action={requestMagicLink}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
          />
          <p>
            <button type="submit">Send magic link</button>
          </p>
        </form>
      </section>
    </Shell>
  );
}
