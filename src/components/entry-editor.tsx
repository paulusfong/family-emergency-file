"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createAutosaver, type AutosaveState } from "@/lib/autosave";
import type {
  EntryTypeDef,
  EntryValues,
  FieldDef,
  SaveEntryInput,
  SaveEntryResult,
} from "@/lib/entry-fields";
import { pendingFindings } from "@/lib/privacy-warn";

type Props = {
  sectionKey: string;
  def: EntryTypeDef;
  entryId: string | null;
  initialValues: EntryValues;
  save: (input: SaveEntryInput) => Promise<SaveEntryResult>;
  delayMs?: number;
};

type Draft = { values: EntryValues; confirmed: Record<string, string> };
export const OFFLINE_STATUS = "You're offline. Changes will save when you reconnect.";
export const OFFLINE_MESSAGE =
  "You're offline, so changes aren't saved yet. They save when you reconnect, or press Retry.";

const STATUS_TEXT: Record<AutosaveState["status"], string> = {
  idle: "Changes save automatically.",
  blocked: "",
  pending: "Unsaved changes…",
  saving: "Saving…",
  saved: "All changes saved.",
  error: "Not saved.",
};

function inputType(field: FieldDef) {
  if (field.kind === "email") return "email";
  if (field.kind === "phone") return "tel";
  return "text";
}

export function EntryEditor({ sectionKey, def, entryId, initialValues, save, delayMs }: Props) {
  const labelDef: FieldDef = {
    name: "label",
    label: def.labelField.label,
    kind: "text",
    placeholder: def.labelField.placeholder,
  };
  const allFields = [labelDef, ...def.fields];

  // The draft pairs the values with the ones the person confirmed are not
  // secrets. Values loaded from a saved entry count as confirmed.
  const [draft, setDraft] = useState<Draft>({ values: initialValues, confirmed: { ...initialValues } });
  const { values, confirmed } = draft;
  const [state, setState] = useState<AutosaveState>({ status: entryId ? "saved" : "idle" });
  const sectionHref = `/app/sections/${sectionKey}`;

  const [saver] = useState(() => {
    let currentId = entryId;
    return createAutosaver<Draft>({
      initial: draft,
      persisted: entryId !== null,
      canSave: (d) =>
        Boolean(d.values.label?.trim()) && Object.keys(pendingFindings(allFields, d.values, d.confirmed)).length === 0,
      delayMs,
      onState: setState,
      save: async (d) => {
        const res = await save({ sectionKey, entryType: def.type, entryId: currentId, values: d.values });
        if (res.ok && currentId === null) {
          currentId = res.entryId;
          window.history.replaceState(null, "", `${sectionHref}/entries/${res.entryId}`);
        }
        return res;
      },
    });
  });

  const [offline, setOffline] = useState(false);

  useEffect(() => {
    saver.resume();
    const sync = () => setOffline(!window.navigator.onLine);
    const reconnect = () => {
      sync();
      void saver.flush();
    };
    sync();
    window.addEventListener("offline", sync);
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("offline", sync);
      window.removeEventListener("online", reconnect);
      saver.dispose();
    };
  }, [saver]);

  const update = (next: Draft) => {
    setDraft(next);
    saver.schedule(next);
  };
  const change = (name: string, value: string) => update({ values: { ...values, [name]: value }, confirmed });
  const confirmNotSecret = (name: string) =>
    update({ values, confirmed: { ...confirmed, [name]: values[name] } });

  const errors = state.fieldErrors ?? {};
  const findings = pendingFindings(allFields, values, confirmed);
  const blockedText = values.label?.trim()
    ? "Review the flagged field before this saves."
    : `Fill in “${def.labelField.label}” to start saving.`;
  const failed = state.status === "error";
  // Offline never reads as saved: the status says so and a toast offers Retry.
  const statusText = offline && !failed
    ? OFFLINE_STATUS
    : state.status === "blocked"
      ? blockedText
      : STATUS_TEXT[state.status];
  const toast = failed ? state.error : offline ? OFFLINE_MESSAGE : null;

  const renderField = (field: FieldDef, label: string, required = false) => {
    const fieldId = `field-${field.name}`;
    const error = errors[field.name];
    const finding = findings[field.name];
    const describedBy = [
      field.hint ? `${fieldId}-hint` : "",
      finding ? `${fieldId}-privacy` : "",
      error ? `${fieldId}-error` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const common = {
      id: fieldId,
      name: field.name,
      value: values[field.name] ?? "",
      placeholder: field.placeholder,
      autoComplete: "off",
      required,
      "aria-invalid": error || finding?.level === "block" ? true : undefined,
      "data-privacy": finding?.level,
      "aria-describedby": describedBy || undefined,
      onBlur: () => void saver.flush(),
    };
    return (
      <div className="field" key={field.name}>
        <label htmlFor={fieldId}>{label}</label>
        {field.kind === "textarea" ? (
          <textarea
            {...common}
            rows={4}
            onChange={(e) => change(field.name, e.currentTarget.value)}
          />
        ) : (
          <input
            {...common}
            type={inputType(field)}
            inputMode={field.kind === "last4" ? "numeric" : undefined}
            maxLength={field.kind === "last4" ? 4 : undefined}
            onChange={(e) => change(field.name, e.currentTarget.value)}
          />
        )}
        {field.hint ? (
          <p className="field-hint" id={`${fieldId}-hint`}>
            {field.hint}
          </p>
        ) : null}
        {finding ? (
          <div className="field-warning" id={`${fieldId}-privacy`} role="alert">
            <p>{finding.message}</p>
            {finding.level === "warn" ? (
              <button type="button" className="secondary" onClick={() => confirmNotSecret(field.name)}>
                It’s not a secret, save it
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="field-error" id={`${fieldId}-error`}>
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form
      className={toast ? "entry-form has-toast" : "entry-form"}
      aria-label={`${def.title} details`}
      onSubmit={(e) => {
        e.preventDefault();
        void saver.flush();
      }}
    >
      {renderField(labelDef, `${def.labelField.label} (required)`, true)}
      {def.fields.map((f) => renderField(f, f.label))}

      <div className="form-actions">
        <button type="submit">Save now</button>
        <Link href={sectionHref}>Done</Link>
        <p className={`save-status save-${state.status}`} role="status" aria-live="polite">
          {statusText}
        </p>
      </div>

      {toast ? (
        <div className="toast toast-error" role="alert">
          <p>{toast}</p>
          <button type="button" onClick={() => void saver.flush()}>
            Retry
          </button>
        </div>
      ) : null}
    </form>
  );
}
