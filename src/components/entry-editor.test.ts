import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { installNextMocks } from "../test/next-harness";

GlobalRegistrator.register({ url: "http://localhost:3000/app/sections/S3/entries/new" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installNextMocks();

describe("EntryEditor", async () => {
  const React = (await import("react")).default;
  const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
  const { EntryEditor } = await import("./entry-editor");
  const { ENTRY_TYPE_DEFS } = await import("@/lib/entry-fields");
  const { NETWORK_ERROR } = await import("@/lib/autosave");
  type Save = Parameters<typeof EntryEditor>[0]["save"];
  type Input = Parameters<Save>[0];

  const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
  // Compare booleans, never DOM nodes: a failing assert.equal(node, null) makes
  // node:assert inspect happy-dom's object graph and can grow to many GB.
  const hasAlert = () => screen.queryByRole("alert") !== null;

  function mount(opts: {
    save: Save;
    type?: keyof typeof ENTRY_TYPE_DEFS;
    entryId?: string | null;
    initialValues?: Record<string, string>;
  }) {
    return render(
      React.createElement(EntryEditor, {
        sectionKey: "S3",
        def: ENTRY_TYPE_DEFS[opts.type ?? "account"],
        entryId: opts.entryId ?? null,
        initialValues: opts.initialValues ?? {},
        save: opts.save,
        delayMs: 5,
      }),
    );
  }

  function recorder(result: (i: Input, n: number) => Awaited<ReturnType<Save>> | Promise<never>) {
    const calls: Input[] = [];
    const save: Save = async (input) => {
      calls.push(structuredClone(input));
      return result(input, calls.length);
    };
    return { calls, save };
  }

  before(() => {
    window.history.replaceState(null, "", "/app/sections/S3/entries/new");
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/app/sections/S3/entries/new");
  });

  it("renders metadata inputs only, with a numeric last-4 and no password field", () => {
    const { container } = mount({ save: async () => ({ ok: true, entryId: "x" }) });
    assert.equal(container.querySelectorAll('input[type="password"]').length, 0);
    const label = screen.getByLabelText("Account nickname (required)") as HTMLInputElement;
    assert.equal(label.required, true);
    assert.equal(label.placeholder, "Example: Joint checking");
    const last4 = screen.getByLabelText("Last 4 digits (optional)") as HTMLInputElement;
    assert.equal(last4.type, "text");
    assert.equal(last4.getAttribute("inputmode"), "numeric");
    assert.equal(last4.maxLength, 4);
    assert.equal(last4.getAttribute("aria-describedby"), "field-last4-hint");
    assert.match(screen.getByText(/Only the last 4/).id, /field-last4-hint/);
    assert.equal(label.getAttribute("aria-describedby"), null);
    assert.equal(label.getAttribute("autocomplete"), "off");
    assert.equal(screen.getByLabelText("Access plan").tagName, "TEXTAREA");
    assert.equal(screen.getByRole("status").textContent, "Changes save automatically.");
    assert.equal(screen.getByRole("link", { name: "Done" }).getAttribute("href"), "/app/sections/S3");
    assert.equal(hasAlert(), false);
  });

  it("uses email and tel inputs for contacts", () => {
    mount({ type: "contact", save: async () => ({ ok: true, entryId: "x" }) });
    assert.equal((screen.getByLabelText("Email") as HTMLInputElement).type, "email");
    assert.equal((screen.getByLabelText("Phone") as HTMLInputElement).type, "tel");
    assert.equal(screen.getByLabelText("Phone").getAttribute("inputmode"), null);
    assert.equal(screen.getByLabelText("Phone").getAttribute("maxlength"), null);
  });

  it("waits for the required label before autosaving", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "new-1" }));
    mount({ save });
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Example Bank" } });
    assert.equal(screen.getByRole("status").textContent, "Fill in “Account nickname” to start saving.");
    await wait(20);
    assert.deepEqual(calls, []);
    fireEvent.blur(screen.getByLabelText("Institution"));
    await wait(0);
    assert.deepEqual(calls, []);
  });

  it("creates on the first autosave, then updates the same entry", async () => {
    const { calls, save } = recorder((_i, n) => ({ ok: true, entryId: n === 1 ? "new-1" : "ignored" }));
    mount({ save });
    fireEvent.change(screen.getByLabelText("Account nickname (required)"), { target: { value: "Joint checking" } });
    assert.equal(screen.getByRole("status").textContent, "Unsaved changes…");
    await wait(20);
    assert.deepEqual(calls[0], {
      sectionKey: "S3",
      entryType: "account",
      entryId: null,
      values: { label: "Joint checking" },
    });
    assert.equal(window.location.pathname, "/app/sections/S3/entries/new-1");
    assert.equal(screen.getByRole("status").textContent, "All changes saved.");

    fireEvent.change(screen.getByLabelText("Last 4 digits (optional)"), { target: { value: "0000" } });
    fireEvent.blur(screen.getByLabelText("Last 4 digits (optional)"));
    await wait(0);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], {
      sectionKey: "S3",
      entryType: "account",
      entryId: "new-1",
      values: { label: "Joint checking", last4: "0000" },
    });
    assert.equal(window.location.pathname, "/app/sections/S3/entries/new-1");
  });

  it("shows an error toast when a save fails and recovers on retry", async () => {
    let offline = true;
    const { calls, save } = recorder(() => {
      if (offline) return Promise.reject(new TypeError("Failed to fetch"));
      return { ok: true, entryId: "e-1" };
    });
    mount({ save, entryId: "e-1", initialValues: { label: "Joint checking" } });
    assert.equal(screen.getByRole("status").textContent, "All changes saved.");
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Branch on Main St" } });
    await wait(20);
    const toast = screen.getByRole("alert");
    assert.equal(toast.className, "toast toast-error");
    assert.match(toast.textContent!, new RegExp(NETWORK_ERROR.slice(0, 30)));
    assert.equal(screen.getByRole("status").textContent, "Not saved.");
    assert.equal(window.location.pathname, "/app/sections/S3/entries/new");

    offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await wait(0);
    assert.equal(hasAlert(), false);
    assert.equal(screen.getByRole("status").textContent, "All changes saved.");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].entryId, "e-1");
  });

  it("does not rewrite the URL when a first save fails", async () => {
    const { save } = recorder(() => ({ ok: false, status: 500, error: "Couldn't save right now. Please retry." }));
    mount({ save });
    fireEvent.change(screen.getByLabelText("Account nickname (required)"), { target: { value: "X" } });
    fireEvent.submit(screen.getByRole("form"));
    await wait(0);
    assert.match(screen.getByRole("alert").textContent!, /Couldn't save right now/);
    assert.equal(window.location.pathname, "/app/sections/S3/entries/new");
  });

  it("shows server field errors inline and marks the field invalid", async () => {
    const { save } = recorder(() => ({
      ok: false,
      status: 400,
      error: "Some fields need a fix before this can save.",
      fieldErrors: { last4: "Enter exactly 4 digits, or leave it blank." },
    }));
    mount({ save, entryId: "e-2", initialValues: { label: "Card" } });
    const last4 = screen.getByLabelText("Last 4 digits (optional)");
    fireEvent.change(last4, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await wait(0);
    assert.equal(last4.getAttribute("aria-invalid"), "true");
    assert.equal(last4.getAttribute("aria-describedby"), "field-last4-hint field-last4-error");
    assert.equal(document.getElementById("field-last4-error")!.textContent, "Enter exactly 4 digits, or leave it blank.");
    assert.match(screen.getByRole("alert").textContent!, /need a fix/);
    const label = screen.getByLabelText("Account nickname (required)");
    assert.equal(label.getAttribute("aria-invalid"), null);
  });

  it("edits note text in a textarea and stops after unmount", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "n-1" }));
    const view = mount({ type: "note", save, entryId: "n-1", initialValues: { label: "First week" } });
    assert.equal((screen.getByLabelText("Title (required)") as HTMLInputElement).value, "First week");
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Call Pat first" } });
    view.unmount();
    await wait(20);
    assert.deepEqual(calls, []);
  });
});
