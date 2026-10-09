import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { installNextMocks } from "../test/next-harness";

GlobalRegistrator.register({ url: "http://localhost:3000/app/export" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installNextMocks();

describe("EncryptedExport", async () => {
  const React = (await import("react")).default;
  const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
  const { EncryptedExport, EXPORT_JSON_URL } = await import("./encrypted-export");

  // Compare strings and booleans only, never DOM nodes (see entry-editor.test.ts).
  const status = () => screen.getByRole("status").textContent;
  const pass = () => screen.getByLabelText("Passphrase") as HTMLInputElement;
  const again = () => screen.getByLabelText("Type it again") as HTMLInputElement;
  const submit = () => act(async () => void fireEvent.submit(screen.getByRole("form", { name: "Encrypted export" })));
  const fill = (a: string, b: string) => {
    fireEvent.change(pass(), { target: { value: a } });
    fireEvent.change(again(), { target: { value: b } });
  };

  afterEach(() => cleanup());

  it("uses unnamed password inputs so the passphrase is never submitted", () => {
    render(React.createElement(EncryptedExport, { fileName: "f.json.age" }));
    assert.deepEqual(
      [pass(), again()].map((i) => [i.type, i.name, i.autocomplete]),
      [
        ["password", "", "new-password"],
        ["password", "", "new-password"],
      ],
    );
    assert.equal(pass().getAttribute("aria-describedby"), "export-passphrase-hint");
    assert.equal(status(), "");
    assert.equal(EXPORT_JSON_URL, "/app/export/json?for=age");
  });

  it("checks the passphrase before fetching anything", async () => {
    let fetched = 0;
    render(React.createElement(EncryptedExport, { fileName: "f.json.age", fetchJson: async () => String(++fetched) }));
    fill("short", "short");
    await submit();
    assert.equal(status(), "Use at least 12 characters. Four or five random words work well.");
    assert.equal(screen.getByRole("status").className, "export-status export-error");
    fill("correct horse battery", "correct horse batterx");
    await submit();
    assert.equal(status(), "The two passphrases do not match.");
    assert.equal(fetched, 0);
  });

  it("encrypts the fetched JSON with the passphrase, saves it, and clears the fields", async () => {
    const seen: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    render(
      React.createElement(EncryptedExport, {
        fileName: "family-emergency-file-2026-09-29.json.age",
        fetchJson: async () => '{"a":1}',
        encrypt: async (plaintext, passphrase) => {
          seen.push(["encrypt", plaintext, passphrase]);
          await gate;
          return new Uint8Array([1, 2, 3]);
        },
        download: (bytes, fileName) => seen.push(["download", [...bytes], fileName]),
      }),
    );
    fill("correct horse battery", "correct horse battery");
    await submit();
    assert.equal(status(), "Encrypting in your browser…");
    const button = screen.getByRole("button") as HTMLButtonElement;
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, "Encrypting…");
    await act(async () => release());
    assert.deepEqual(seen, [
      ["encrypt", '{"a":1}', "correct horse battery"],
      ["download", [1, 2, 3], "family-emergency-file-2026-09-29.json.age"],
    ]);
    assert.equal(
      status(),
      "Saved family-emergency-file-2026-09-29.json.age. Keep the passphrase somewhere safe, such as your password manager: without it the file cannot be opened.",
    );
    assert.equal(screen.getByRole("status").className, "export-status export-done");
    assert.deepEqual([pass().value, again().value], ["", ""]);
    assert.equal((screen.getByRole("button") as HTMLButtonElement).disabled, false);
    assert.equal(screen.getByRole("button").textContent, "Encrypt and download");
  });

  it("fetches the no-store JSON export by default and saves a blob download", async () => {
    const requests: unknown[] = [];
    const clicks: string[] = [];
    const origFetch = globalThis.fetch;
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      requests.push([url, init]);
      return new Response('{"b":2}', { status: 200 });
    }) as typeof fetch;
    URL.createObjectURL = (blob: Blob) => {
      requests.push(["blob", blob.type, blob.size]);
      return "blob:fake";
    };
    URL.revokeObjectURL = (url: string) => void requests.push(["revoke", url]);
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(`${this.href} ${this.download}`);
    };
    try {
      render(
        React.createElement(EncryptedExport, {
          fileName: "f.json.age",
          encrypt: async (plaintext) => new TextEncoder().encode(`enc:${plaintext}`),
        }),
      );
      fill("correct horse battery", "correct horse battery");
      await submit();
      await act(async () => {});
      assert.deepEqual(requests, [
        ["/app/export/json?for=age", { cache: "no-store", credentials: "same-origin" }],
        ["blob", "application/octet-stream", 11],
        ["revoke", "blob:fake"],
      ]);
      assert.deepEqual(clicks, ["blob:fake f.json.age"]);
    } finally {
      globalThis.fetch = origFetch;
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = origClick;
    }
  });

  it("reports a failed export fetch and keeps the passphrase for a retry", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("no", { status: 401 })) as typeof fetch;
    let encrypted = 0;
    try {
      render(
        React.createElement(EncryptedExport, {
          fileName: "f.json.age",
          encrypt: async () => {
            encrypted++;
            return new Uint8Array();
          },
        }),
      );
      fill("correct horse battery", "correct horse battery");
      await submit();
      await act(async () => {});
      assert.equal(status(), "Could not create the encrypted file. Check your connection and try again.");
      assert.equal(encrypted, 0);
      assert.equal(pass().value, "correct horse battery");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
