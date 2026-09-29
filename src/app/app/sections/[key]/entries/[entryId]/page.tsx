import Link from "next/link";
import { notFound } from "next/navigation";
import { EntryEditor } from "@/components/entry-editor";
import { Shell } from "@/components/shell";
import { getEntry } from "@/lib/entries";
import { ENTRY_TYPE_DEFS, readPayload } from "@/lib/entry-fields";
import { removeEntry, saveEntry } from "../../../actions";
import { loadOwnedSection } from "../../../load";

export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ key: string; entryId: string }>;
}) {
  const { key, entryId } = await params;
  const { def, section } = await loadOwnedSection(key);
  const entry = await getEntry(section.id, entryId);
  if (!entry) notFound();
  const typeDef = ENTRY_TYPE_DEFS[entry.entryType];
  const initialValues = { label: entry.label, ...readPayload(entry.entryType, entry.payloadJson) };

  return (
    <Shell signedIn>
      <section className="panel">
        <p>
          <Link href={`/app/sections/${def.key}`}>
            ← {def.key} {def.title}
          </Link>
        </p>
        <h1>{entry.label}</h1>
        <p className="lede">{typeDef.title}. Changes save automatically.</p>
        <EntryEditor
          sectionKey={def.key}
          def={typeDef}
          entryId={entry.id}
          initialValues={initialValues}
          save={saveEntry}
        />
        <form action={removeEntry} className="danger-zone">
          <input type="hidden" name="sectionKey" value={def.key} />
          <input type="hidden" name="entryId" value={entry.id} />
          <button type="submit" className="danger">
            Delete entry
          </button>
        </form>
      </section>
    </Shell>
  );
}
