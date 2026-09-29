import { requestMagicLink } from "@/app/actions";
import { Shell } from "@/components/shell";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

const SIGN_IN_ERRORS: Record<string, string> = {
  invalid: "That link is invalid or expired. Request a new one.",
  email: "Enter a valid email address.",
  send: "We couldn't send the sign-in email. Please try again in a few minutes.",
};

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
          <p className="flash" role="status">
            If that address can receive email, a sign-in link is on its way.
            In local dev without Resend, the link is printed in the server
            console and written to <code>tmp/last-magic-link.txt</code>.
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {SIGN_IN_ERRORS[error] ?? SIGN_IN_ERRORS.invalid}
          </p>
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
