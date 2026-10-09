"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createAutosaver, type AutosaveState } from "@/lib/autosave";
import { reportLostSave } from "@/lib/lost-save";
import type {
  EntryTypeDef,
  EntryValues,
  FieldDef,
  SaveEntryInput,
  SaveEntryResult,
} from "@/lib/entry-fields";

type Props = {
  sectionKey: string;
  def: EntryTypeDef;
  entryId: string | null;
  initialValues: EntryValues;
  save: (input: SaveEntryInput) => Promise<SaveEntryResult>;
  delayMs?: number;
};

export const OFFLINE_STATUS = "You're offline. Changes will save when you reconnect.";
export const OFFLINE_MESSAGE =
  "You're offline, so changes aren't saved yet. They save when you reconnect, or press Retry.";

/** Statuses where the latest edit is not on the server yet. */
const UNSAVED_STATUSES = new Set<AutosaveState["status"]>(["pending", "saving", "error"]);

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
  const [values, setValues] = useState<EntryValues>(initialValues);
  const [state, setState] = useState<AutosaveState>({ status: entryId ? "saved" : "idle" });
  const sectionHref = `/app/sections/${sectionKey}`;

  const [{ saver, setMounted }] = useState(() => {
    let currentId = entryId;
    // A save flushed on unmount may finish on the next page: leave its URL alone.
    let mounted = false;
    const saver = createAutosaver<EntryValues>({
      initial: initialValues,
      persisted: entryId !== null,
      canSave: (v) => Boolean(v.label?.trim()),
      delayMs,
      onState: setState,
      // The flush on leaving the page failed: the /app layout's notice shows it.
      onLost: (error, v) =>
        reportLostSave({
          message: `Your last change to “${v.label}” wasn't saved. ${error}`,
          href: currentId === null ? null : `${sectionHref}/entries/${currentId}`,
        }),
      save: async (v) => {
        const res = await save({ sectionKey, entryType: def.type, entryId: currentId, values: v });
        if (res.ok && currentId === null) {
          currentId = res.entryId;
          if (mounted) window.history.replaceState(null, "", `${sectionHref}/entries/${res.entryId}`);
        }
        return res;
      },
    });
    return { saver, setMounted: (value: boolean) => void (mounted = value) };
  });

  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setMounted(true);
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
      setMounted(false);
      saver.dispose();
    };
  }, [saver, setMounted]);

  // Closing or reloading the tab with an edit not yet saved asks first,
  // including typed content that cannot save yet because the label is blank.
  const typed = Object.values(values).some((v) => Boolean(v?.trim()));
  const unsaved = UNSAVED_STATUSES.has(state.status) || (state.status === "blocked" && typed);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const change = (name: string, value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    saver.schedule(next);
  };

  const errors = state.fieldErrors ?? {};
  const failed = state.status === "error";
  // Offline never reads as saved: the status says so and a toast offers Retry.
  const statusText = offline && !failed
    ? OFFLINE_STATUS
    : state.status === "blocked"
      ? `Fill in “${def.labelField.label}” to start saving.`
      : STATUS_TEXT[state.status];
  const toast = failed ? state.error : offline ? OFFLINE_MESSAGE : null;

  const renderField = (field: FieldDef, label: string, required = false) => {
    const fieldId = `field-${field.name}`;
    const error = errors[field.name];
    const describedBy = [field.hint ? `${fieldId}-hint` : "", error ? `${fieldId}-error` : ""]
      .filter(Boolean)
      .join(" ");
    const common = {
      id: fieldId,
      name: field.name,
      value: values[field.name] ?? "",
      placeholder: field.placeholder,
      autoComplete: "off",
      required,
      "aria-invalid": error ? true : undefined,
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
      {renderField(
        {
          name: "label",
          label: def.labelField.label,
          kind: "text",
          placeholder: def.labelField.placeholder,
        },
        `${def.labelField.label} (required)`,
        true,
      )}
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
