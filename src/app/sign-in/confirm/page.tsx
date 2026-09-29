import { confirmMagicLink } from "@/app/actions";
import { Shell } from "@/components/shell";
import { redirect } from "next/navigation";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect("/sign-in");

  return (
    <Shell>
      <section className="panel">
        <h1>Confirm sign-in</h1>
        <p className="lede">Click below to finish signing in with your magic link.</p>
        <form action={confirmMagicLink}>
          <input type="hidden" name="token" value={token} />
          <button type="submit">Continue to dashboard</button>
        </form>
      </section>
    </Shell>
  );
}
