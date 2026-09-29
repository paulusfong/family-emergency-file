"use client";

import { useState, type FormEvent } from "react";
import { encryptExport, passphraseError } from "@/lib/encrypt-export";

type Status = { kind: "idle" | "working" | "done" | "error"; message: string };

export const EXPORT_JSON_URL = "/app/export/json?for=age";

async function fetchPlaintext() {
  const res = await fetch(EXPORT_JSON_URL, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  return res.text();
}

function saveBytes(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Passphrase fields have no name and the form never posts: the passphrase
 * stays in this component's state, is used by encryptExport in the browser,
 * and is cleared once the file is saved.
 */
export function EncryptedExport({
  fileName,
  fetchJson = fetchPlaintext,
  encrypt = encryptExport,
  download = saveBytes,
}: {
  fileName: string;
  fetchJson?: () => Promise<string>;
  encrypt?: (plaintext: string, passphrase: string) => Promise<Uint8Array>;
  download?: (bytes: Uint8Array, fileName: string) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const error = passphraseError(passphrase, confirm);
    if (error) {
      setStatus({ kind: "error", message: error });
      return;
    }
    setStatus({ kind: "working", message: "Encrypting in your browser…" });
    try {
      const bytes = await encrypt(await fetchJson(), passphrase);
      download(bytes, fileName);
      setPassphrase("");
      setConfirm("");
      setStatus({
        kind: "done",
        message: `Saved ${fileName}. Keep the passphrase somewhere safe, such as your password manager: without it the file cannot be opened.`,
      });
    } catch {
      setStatus({ kind: "error", message: "Could not create the encrypted file. Check your connection and try again." });
    }
  }

  const working = status.kind === "working";
  return (
    <form className="encrypted-export" onSubmit={onSubmit} aria-label="Encrypted export">
      <div className="field">
        <label htmlFor="export-passphrase">Passphrase</label>
        <input
          id="export-passphrase"
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.currentTarget.value)}
          aria-describedby="export-passphrase-hint"
        />
        <p className="field-hint" id="export-passphrase-hint">
          At least 12 characters. It is used in this browser only and is never sent to us.
        </p>
      </div>
      <div className="field">
        <label htmlFor="export-passphrase-confirm">Type it again</label>
        <input
          id="export-passphrase-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
        />
      </div>
      <button type="submit" disabled={working}>
        {working ? "Encrypting…" : "Encrypt and download"}
      </button>
      <p className={`export-status export-${status.kind}`} role="status" aria-live="polite">
        {status.message}
      </p>
    </form>
  );
}
