import Link from "next/link";
import { Shell } from "@/components/shell";
import { SECTION_DEFS } from "@/lib/schema";
import { requireHousehold } from "@/lib/session";
import { notFound } from "next/navigation";

export default async function SectionStubPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  await requireHousehold();
  const { key } = await params;
  const def = SECTION_DEFS.find((d) => d.key === key);
  if (!def) notFound();

  return (
    <Shell signedIn>
      <section className="panel">
        <p>
          <Link href="/app">← Dashboard</Link>
        </p>
        <h1>
          {def.key} {def.title}
        </h1>
        <p className="lede">Coming in the next PR — entry CRUD and checklist items.</p>
      </section>
    </Shell>
  );
}
