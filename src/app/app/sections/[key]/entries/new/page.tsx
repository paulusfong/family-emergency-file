import Link from "next/link";
import { EntryEditor } from "@/components/entry-editor";
import { Shell } from "@/components/shell";
import { ENTRY_TYPE_DEFS, isEntryType } from "@/lib/entry-fields";
import { SECTION_PRIMARY_TYPE, type SectionKey } from "@/lib/sections";
import { saveEntry } from "../../../actions";
import { loadOwnedSection } from "../../../load";

export default async function NewEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { key } = await params;
  const { type } = await searchParams;
  const { def } = await loadOwnedSection(key);
  const entryType = isEntryType(type) ? type : SECTION_PRIMARY_TYPE[def.key as SectionKey];
  const typeDef = ENTRY_TYPE_DEFS[entryType];

  return (
    <Shell signedIn>
      <section className="panel">
        <p>
          <Link href={`/app/sections/${def.key}`}>
            ← {def.key} {def.title}
          </Link>
        </p>
        <h1>New {typeDef.title.toLowerCase()}</h1>
        <p className="lede">
          Record where things are and who to call. Never passwords, PINs, or full account numbers.
        </p>
        <EntryEditor sectionKey={def.key} def={typeDef} entryId={null} initialValues={{}} save={saveEntry} />
      </section>
    </Shell>
  );
}
