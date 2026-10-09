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
  const { NETWORK_ERROR, SERVER_ERROR } = await import("@/lib/autosave");
  const { CREDENTIAL_ERROR, FULL_NUMBER_ERROR, SECRET_WARNING } = await import("@/lib/privacy-warn");
  const { LostSaveNotice } = await import("./lost-save-notice");
  const { dismissLostSave, getLostSave } = await import("@/lib/lost-save");
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
    strict?: boolean;
  }) {
    const editor = React.createElement(EntryEditor, {
      sectionKey: "S3",
      def: ENTRY_TYPE_DEFS[opts.type ?? "account"],
      entryId: opts.entryId ?? null,
      initialValues: opts.initialValues ?? {},
      save: opts.save,
      delayMs: 5,
    });
    // next dev (and QA) run React in StrictMode, which mounts, unmounts, and
    // remounts every effect once.
    return render(opts.strict ? React.createElement(React.StrictMode, null, editor) : editor);
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
    dismissLostSave();
    window.history.replaceState(null, "", "/app/sections/S3/entries/new");
  });

  const unload = () => {
    const event = new window.Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

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

  it("edits note text in a textarea and saves the pending edit on unmount", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "n-1" }));
    const view = mount({ type: "note", save, entryId: "n-1", initialValues: { label: "First week" } });
    assert.equal((screen.getByLabelText("Title (required)") as HTMLInputElement).value, "First week");
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Call Pat first" } });
    view.unmount();
    await wait(20);
    assert.deepEqual(calls, [
      { sectionKey: "S3", entryType: "note", entryId: "n-1", values: { label: "First week", notes: "Call Pat first" } },
    ]);
  });

  it("does not save on unmount when nothing is pending, even under StrictMode", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "n-1" }));
    const view = mount({ type: "note", save, entryId: "n-1", initialValues: { label: "First week" }, strict: true });
    assert.equal(screen.getByRole("status").textContent, "All changes saved.");
    view.unmount();
    await wait(20);
    assert.deepEqual(calls, []);
  });

  // Paste warning. Read DOM state as strings/booleans (see hasAlert above).
  const warningText = (name: string) => document.getElementById(`field-${name}-privacy`)?.textContent ?? null;
  const confirmButton = () => screen.queryByRole("button", { name: "It’s not a secret, save it" });
  const statusText = () => screen.getByRole("status").textContent;

  it("holds the autosave on a password-like value until it is confirmed", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "new-1" }));
    mount({ save });
    fireEvent.change(screen.getByLabelText("Account nickname (required)"), { target: { value: "Joint checking" } });
    fireEvent.change(screen.getByLabelText("Access plan"), { target: { value: "Login Tr0ub4dor&3" } });
    const plan = screen.getByLabelText("Access plan");
    assert.equal(warningText("accessPlan"), `${SECRET_WARNING}It’s not a secret, save it`);
    assert.equal(plan.getAttribute("data-privacy"), "warn");
    assert.equal(plan.getAttribute("aria-invalid"), null);
    assert.equal(plan.getAttribute("aria-describedby"), "field-accessPlan-hint field-accessPlan-privacy");
    assert.equal(document.getElementById("field-accessPlan-privacy")?.getAttribute("role"), "alert");
    assert.equal(statusText(), "Review the flagged field before this saves.");
    fireEvent.submit(screen.getByRole("form"));
    await wait(20);
    assert.equal(calls.length, 0);

    fireEvent.click(confirmButton()!);
    assert.equal(warningText("accessPlan"), null);
    assert.equal(plan.getAttribute("data-privacy"), null);
    await wait(20);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].values, { label: "Joint checking", accessPlan: "Login Tr0ub4dor&3" });
    assert.equal(statusText(), "All changes saved.");
  });

  it("re-checks a confirmed field when it is edited again", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "new-1" }));
    mount({ save });
    fireEvent.change(screen.getByLabelText("Account nickname (required)"), { target: { value: "Joint checking" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "PIN is 4821" } });
    fireEvent.click(confirmButton()!);
    await wait(20);
    assert.equal(calls.length, 1);
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "PIN is 4822" } });
    assert.match(warningText("notes")!, /looks like a password, PIN/);
    await wait(20);
    assert.equal(calls.length, 1);
  });

  it("blocks a full number with no way to confirm it, and saves once it is fixed", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "new-1" }));
    mount({ save });
    fireEvent.change(screen.getByLabelText("Account nickname (required)"), { target: { value: "Card" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "4111 1111 1111 1111" } });
    const notes = screen.getByLabelText("Notes");
    assert.equal(warningText("notes"), FULL_NUMBER_ERROR);
    assert.equal(confirmButton() === null, true);
    assert.equal(notes.getAttribute("aria-invalid"), "true");
    assert.equal(notes.getAttribute("data-privacy"), "block");
    assert.equal(notes.getAttribute("aria-describedby"), "field-notes-privacy");
    fireEvent.blur(notes);
    await wait(20);
    assert.equal(calls.length, 0);

    fireEvent.change(notes, { target: { value: "Card ends 1111" } });
    assert.equal(warningText("notes"), null);
    await wait(20);
    assert.deepEqual(calls[0].values, { label: "Card", notes: "Card ends 1111" });
  });

  it("QA-1: blocks a card number typed into Phone or Email, with no way to confirm it", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "c-1" }));
    mount({ save, type: "contact" });
    fireEvent.change(screen.getByLabelText("Name (required)"), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "4111111111111111" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "4111111111111111@example.com" } });
    assert.equal(warningText("phone"), FULL_NUMBER_ERROR);
    assert.equal(warningText("email"), FULL_NUMBER_ERROR);
    assert.equal(confirmButton() === null, true);
    fireEvent.blur(screen.getByLabelText("Phone"));
    await wait(20);
    assert.equal(calls.length, 0);
    assert.equal(statusText(), "Review the flagged field before this saves.");

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+1 (404) 555-0199" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pat@example.com" } });
    assert.equal(warningText("phone"), null);
    assert.equal(warningText("email"), null);
    await wait(20);
    assert.deepEqual(calls[0].values, { label: "Pat", phone: "+1 (404) 555-0199", email: "pat@example.com" });
  });

  it("flags the label field too, and keeps the fill-in prompt when the label is empty", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "new-1" }));
    mount({ save });
    const label = screen.getByLabelText("Account nickname (required)");
    fireEvent.change(label, { target: { value: "P@ssw0rd99" } });
    assert.equal(warningText("label"), `${SECRET_WARNING}It’s not a secret, save it`);
    assert.equal(label.getAttribute("aria-describedby"), "field-label-privacy");
    fireEvent.change(label, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "password: x1" } });
    assert.equal(statusText(), "Fill in “Account nickname” to start saving.");
    await wait(20);
    assert.deepEqual(calls, []);
  });

  it("treats values loaded from a saved entry as already confirmed", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "e-1" }));
    mount({ save, entryId: "e-1", initialValues: { label: "Family email", notes: "Tr0ub4dor&3" } });
    assert.equal(warningText("notes"), null);
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Example Mail" } });
    await wait(20);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].values, { label: "Family email", notes: "Tr0ub4dor&3", institution: "Example Mail" });
  });

  it("blocks a labelled credential with no way to confirm it", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "new-1" }));
    mount({ save, type: "access_plan" });
    fireEvent.change(screen.getByLabelText("Account or service (required)"), { target: { value: "Family email" } });
    const login = screen.getByLabelText("Where the login lives");
    fireEvent.change(login, { target: { value: "password: Tr0ub4dor&3" } });
    assert.equal(warningText("loginLocation"), CREDENTIAL_ERROR);
    assert.equal(confirmButton() === null, true);
    assert.equal(login.getAttribute("aria-invalid"), "true");
    assert.equal(login.getAttribute("data-privacy"), "block");
    fireEvent.blur(login);
    fireEvent.submit(screen.getByRole("form"));
    await wait(20);
    assert.equal(calls.length, 0);
    assert.equal(statusText(), "Review the flagged field before this saves.");
  });

  it("does not re-save a stored value that is now blocked, even when another field changes", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "e-1" }));
    mount({ save, entryId: "e-1", initialValues: { label: "Family email", notes: "password: hunter2" } });
    assert.equal(warningText("notes"), CREDENTIAL_ERROR);
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Example Mail" } });
    await wait(20);
    assert.equal(calls.length, 0);
  });

  it("never sends a blocked value, even when it is typed while the first draft save is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: Input[] = [];
    const save: Save = async (input) => {
      calls.push(structuredClone(input));
      await gate;
      return { ok: true, entryId: "new-1" };
    };
    mount({ save, type: "access_plan" });
    fireEvent.change(screen.getByLabelText("Account or service (required)"), { target: { value: "Family email" } });
    await wait(20);
    assert.equal(calls.length, 1);
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "PIN=4821" } });
    fireEvent.submit(screen.getByRole("form"));
    await act(async () => release());
    await wait(20);
    assert.deepEqual(
      calls.map((c) => c.values),
      [{ label: "Family email" }],
    );
    assert.equal(statusText(), "Review the flagged field before this saves.");
  });

  it("does not rewrite the URL when a new entry's flushed save lands after unmount", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "new-9" }));
    const view = mount({ save });
    fireEvent.change(screen.getByLabelText("Account nickname (required)"), { target: { value: "Joint checking" } });
    view.unmount();
    await wait(20);
    assert.equal(calls.length, 1);
    assert.equal(window.location.pathname, "/app/sections/S3/entries/new");
  });

  it("asks before the tab closes while an edit is pending, saving, or failed", async () => {
    let fail = false;
    let release: () => void = () => {};
    const save: Save = async () => {
      if (fail) return { ok: false, status: 500, error: "Couldn't save right now. Please retry." };
      await new Promise<void>((r) => (release = r));
      return { ok: true, entryId: "e-3" };
    };
    mount({ save, entryId: "e-3", initialValues: { label: "Card" } });
    assert.equal(unload(), false);
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Main St" } });
    assert.equal(screen.getByRole("status").textContent, "Unsaved changes…");
    assert.equal(unload(), true);
    await wait(20);
    assert.equal(screen.getByRole("status").textContent, "Saving…");
    assert.equal(unload(), true);
    await act(async () => release());
    assert.equal(screen.getByRole("status").textContent, "All changes saved.");
    assert.equal(unload(), false);
    fail = true;
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Oak St" } });
    await wait(20);
    assert.equal(screen.getByRole("status").textContent, "Not saved.");
    assert.equal(unload(), true);
  });

  it("asks before the tab closes for a new entry with typed content but no label yet", async () => {
    const { calls, save } = recorder(() => ({ ok: true, entryId: "new-2" }));
    mount({ save, strict: true });
    assert.equal(unload(), false);
    const institution = screen.getByLabelText("Institution");
    fireEvent.change(institution, { target: { value: "Example Bank" } });
    assert.equal(screen.getByRole("status").textContent, "Fill in “Account nickname” to start saving.");
    assert.equal(unload(), true);
    fireEvent.change(institution, { target: { value: "   " } });
    assert.equal(unload(), false);
    fireEvent.change(institution, { target: { value: "" } });
    assert.equal(unload(), false);
    await wait(20);
    assert.deepEqual(calls, []);
  });

  describe("a save that fails after the editor unmounts", () => {
    const notice = () => screen.queryByRole("alert")?.textContent ?? "";

    it("shows a notice outside the editor with a link back to the entry", async () => {
      const { calls, save } = recorder(() => ({
        ok: false,
        status: 400,
        error: `Phone: ${"Enter a phone number"}`,
        fieldErrors: { phone: "Enter a phone number" },
      }));
      render(React.createElement(LostSaveNotice));
      assert.equal(notice(), "");
      const view = mount({ type: "contact", save, entryId: "c-7", initialValues: { label: "Pat" } });
      // Only the server rejects this one (the phone format), so the save is sent.
      fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "(404) 555-01" } });
      view.unmount();
      await wait(20);
      assert.equal(calls.length, 1);
      assert.equal(notice(), "Your last change to “Pat” wasn't saved. Phone: Enter a phone numberOpen it againDismiss");
      const link = screen.getByRole("link", { name: "Open it again" });
      assert.equal(link.getAttribute("href"), "/app/sections/S3/entries/c-7");
      fireEvent.click(link);
      assert.equal(notice(), "");
      assert.equal(getLostSave() === null, true);
    });

    it("has no link for a new entry that was never created, and dismisses", async () => {
      const { save } = recorder(() => Promise.reject(new TypeError("Failed to fetch")));
      render(React.createElement(LostSaveNotice));
      const view = mount({ save });
      fireEvent.change(screen.getByLabelText("Account nickname (required)"), { target: { value: "Joint" } });
      view.unmount();
      await wait(20);
      assert.equal(notice(), `Your last change to “Joint” wasn't saved. ${NETWORK_ERROR}Dismiss`);
      assert.equal(screen.queryAllByRole("link").length, 0);
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      assert.equal(notice(), "");
    });

    it("shows a save that had already failed when the person leaves (Done after a failed blur save)", async () => {
      const { calls, save } = recorder(() => Promise.reject(new Error("An unexpected response was received from the server.")));
      render(React.createElement(LostSaveNotice));
      const view = mount({ type: "contact", save, entryId: "c-9", initialValues: { label: "Pat" } });
      fireEvent.change(screen.getByLabelText("Relationship"), { target: { value: "Sister" } });
      await wait(20);
      assert.equal(calls.length, 1);
      // The editor's own toast shows the failure while it is open.
      assert.match(screen.getAllByRole("alert").map((a) => a.textContent).join(" "), new RegExp(SERVER_ERROR.slice(0, 30)));
      view.unmount();
      await wait(20);
      assert.equal(calls.length, 1);
      assert.equal(notice(), `Your last change to “Pat” wasn't saved. ${SERVER_ERROR}Open it againDismiss`);
    });

    it("shows nothing when the flush on unmount succeeds", async () => {
      const { calls, save } = recorder(() => ({ ok: true, entryId: "c-8" }));
      render(React.createElement(LostSaveNotice));
      const view = mount({ type: "contact", save, entryId: "c-8", initialValues: { label: "Pat" } });
      fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "(404) 555-0123" } });
      view.unmount();
      await wait(20);
      assert.equal(calls.length, 1);
      assert.equal(notice(), "");
    });
  });

  describe("QA-4: autosave status under React StrictMode", () => {
    const SAVED = "All changes saved.";
    const status = () => screen.getByRole("status").textContent;
    const retryButtons = () => screen.queryAllByRole("button", { name: "Retry" }).length;
    const alertText = () => screen.queryByRole("alert")?.textContent ?? "";
    const setOnline = (online: boolean) => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
      act(() => {
        window.dispatchEvent(new window.Event(online ? "online" : "offline"));
      });
    };
    afterEach(() => setOnline(true));

    it("never shows saved after a rejected save, and shows the toast with Retry", async () => {
      const { calls, save } = recorder(() => ({
        ok: false,
        status: 400,
        error: "Some fields need a fix before this can save.",
        fieldErrors: { institution: "Keep this under 200 characters." },
      }));
      mount({ save, strict: true, entryId: "e-1", initialValues: { label: "Joint" } });
      assert.equal(status(), SAVED);
      // A value the editor allows, rejected by the (mocked) server.
      fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Example Bank, Main St" } });
      await wait(20);
      assert.equal(calls.length, 1);
      assert.equal(status(), "Not saved.");
      assert.match(alertText(), /Some fields need a fix/);
      assert.equal(retryButtons(), 1);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await wait(0);
      assert.equal(calls.length, 2);
      assert.equal(status(), "Not saved.");
      assert.equal(retryButtons(), 1);
    });

    it("never shows saved after an offline save, and recovers on Retry", async () => {
      let offline = true;
      const { calls, save } = recorder((i) => {
        if (offline) return Promise.reject(new TypeError("Failed to fetch"));
        return { ok: true, entryId: i.entryId ?? "e-1" };
      });
      mount({ save, strict: true, entryId: "e-1", initialValues: { label: "Joint" } });
      fireEvent.change(screen.getByLabelText("Ownership"), { target: { value: "Joint with Pat" } });
      await wait(20);
      assert.equal(status(), "Not saved.");
      assert.match(alertText(), new RegExp(NETWORK_ERROR.slice(0, 30)));
      assert.equal(retryButtons(), 1);
      offline = false;
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await wait(0);
      assert.equal(status(), SAVED);
      assert.equal(retryButtons(), 0);
      assert.equal(calls.length, 2);
    });

    it("shows the offline toast with Retry while the browser is offline, then saves on reconnect", async () => {
      const { calls, save } = recorder((i) => ({ ok: true, entryId: i.entryId ?? "e-1" }));
      mount({ save, strict: true, entryId: "e-1", initialValues: { label: "Joint" } });
      assert.equal(status(), SAVED);
      setOnline(false);
      assert.notEqual(status(), SAVED);
      assert.match(status()!, /offline/i);
      assert.match(alertText(), /offline/i);
      assert.equal(retryButtons(), 1);
      fireEvent.change(screen.getByLabelText("Ownership"), { target: { value: "Joint with Pat" } });
      assert.notEqual(status(), SAVED);
      assert.equal(retryButtons(), 1);
      setOnline(true);
      await wait(20);
      assert.equal(status(), SAVED);
      assert.equal(retryButtons(), 0);
      assert.deepEqual(
        calls.map((c) => (c.values as Record<string, string>).ownership),
        ["Joint with Pat"],
      );
    });

    it("starts offline when the browser already is, and saves once per edit", async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
      const { calls, save } = recorder((i) => ({ ok: true, entryId: i.entryId ?? "e-9" }));
      mount({ save, strict: true });
      assert.match(status()!, /offline/i);
      assert.equal(retryButtons(), 1);
      setOnline(true);
      await wait(0);
      assert.equal(status(), "Fill in “Account nickname” to start saving.");
      assert.equal(retryButtons(), 0);
      fireEvent.change(screen.getByLabelText("Account nickname (required)"), { target: { value: "Joint" } });
      await wait(20);
      assert.equal(status(), SAVED);
      assert.equal(calls.length, 1);
      assert.equal(window.location.pathname, "/app/sections/S3/entries/e-9");
    });
  });
});
