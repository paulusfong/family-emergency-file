import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
  NextNotFound,
  NextRedirect,
  installNextMocks,
  renderElement,
  resetHarness,
  revalidated,
} from "../../../test/next-harness";
import { applySchema } from "../../../test/apply-schema";
import { PHONE_ERROR } from "../../../lib/entry-fields";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-sections-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;

installNextMocks();

type FakeUser = { id: string; email: string };
let sessionUser: FakeUser | null = null;

mock.module("@/lib/auth", {
  namedExports: {
    auth: { api: { getSession: async () => (sessionUser ? { user: sessionUser } : null) } },
  },
});

describe("sections: pages, entry CRUD, checklist, ownership", async () => {
  const { client, db } = await import("@/lib/db");
  const schema = await import("@/lib/schema");
  const { id } = await import("@/lib/ids");
  const { ensureHouseholdFile } = await import("@/lib/household");
  const data = await import("@/lib/entries");
  const actions = await import("./actions");
  const { default: SectionPage } = await import("./[key]/page");
  const { default: NewEntryPage } = await import("./[key]/entries/new/page");
  const { default: EditEntryPage } = await import("./[key]/entries/[entryId]/page");
  const { eq } = await import("drizzle-orm");

  const alice: FakeUser = { id: "", email: "alice@example.com" };
  const bob: FakeUser = { id: "", email: "bob@example.com" };
  let aliceFile = "";
  let bobFile = "";

  async function makeUser(u: FakeUser) {
    u.id = id();
    const now = new Date();
    await db.insert(schema.user).values({
      id: u.id,
      name: u.email,
      email: u.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return (await ensureHouseholdFile(u.id)).id;
  }

  const as = (u: FakeUser | null) => {
    sessionUser = u;
  };

  const section = (key: string) => SectionPage({ params: Promise.resolve({ key }), searchParams: Promise.resolve({}) });
  const newEntry = (key: string, type?: string) =>
    NewEntryPage({ params: Promise.resolve({ key }), searchParams: Promise.resolve({ type }) });
  const editEntry = (key: string, entryId: string) =>
    EditEntryPage({ params: Promise.resolve({ key, entryId }) });

  async function html(p: Promise<React.ReactNode>) {
    return renderElement(await p);
  }

  async function outcome(run: () => Promise<unknown>) {
    try {
      await run();
    } catch (e) {
      if (e instanceof NextRedirect) return `redirect:${e.url}`;
      if (e instanceof NextNotFound) return "404";
      throw e;
    }
    return "returned";
  }

  function form(values: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return fd;
  }

  async function aliceEntry(label = "Joint checking") {
    as(alice);
    const res = await actions.saveEntry({
      sectionKey: "S3",
      entryType: "account",
      entryId: null,
      values: { label, institution: "Example Bank", accountType: "Checking", last4: "0000" },
    });
    assert.equal(res.ok, true);
    return (res as { entryId: string }).entryId;
  }

  before(async () => {
    await applySchema(client);
    aliceFile = await makeUser(alice);
    bobFile = await makeUser(bob);
  });

  beforeEach(() => {
    resetHarness();
    as(alice);
  });

  describe("section page", () => {
    it("shows S3's seeded checklist, an empty entry list, and add links", async () => {
      const out = await html(section("S3"));
      assert.match(out, /<h1>S3 Banking &amp; cash<\/h1>/);
      assert.match(out, /Checking and savings accounts/);
      assert.match(out, /Safe deposit box or home safe/);
      assert.match(out, /No entries yet/);
      assert.match(out, /href="\/app\/sections\/S3\/entries\/new\?type=account" class="btn"/);
      assert.match(out, /href="\/app\/sections\/S3\/entries\/new\?type=contact" class="btn btn-secondary"/);
      assert.match(out, /Add document location/);
      assert.doesNotMatch(out, /Entry deleted/);
      assert.doesNotMatch(out, /class="checklist-label">[^<]+<\/span><span class="badge">/);
      assert.equal((out.match(/Mark &quot;/g) ?? []).length, 5);
    });

    it("renders every section with no password inputs", async () => {
      for (const d of schema.SECTION_DEFS) {
        const out = await html(section(d.key));
        assert.match(out, new RegExp(d.title.replace(/[&/]/g, (c) => (c === "&" ? "&amp;" : c))));
        assert.doesNotMatch(out, /type="password"/);
        assert.doesNotMatch(out, /name="(password|pin|ssn|cvv)"/i);
      }
    });

    it("404s unknown keys and redirects when signed out", async () => {
      assert.equal(await outcome(() => section("S99")), "404");
      assert.equal(await outcome(() => section("s3")), "404");
      as(null);
      assert.equal(await outcome(() => section("S3")), "redirect:/sign-in");
    });

    it("404s when the section row is missing from the user's file", async () => {
      const u: FakeUser = { id: "", email: "gap@example.com" };
      const fileId = await makeUser(u);
      const s3 = (await data.findSection(fileId, "S3"))!;
      const count = (await data.listChecklist(s3.id)).length;
      await db.delete(schema.sections).where(eq(schema.sections.id, s3.id));
      const filler = id();
      const now = new Date();
      await db.insert(schema.sections).values({
        id: filler,
        householdFileId: fileId,
        sectionKey: "X1",
        title: "Filler",
        sortOrder: 99,
        createdAt: now,
        updatedAt: now,
      });
      for (let i = 0; i < count; i++) {
        await db.insert(schema.checklistItems).values({
          id: id(),
          sectionId: filler,
          itemKey: `k${i}`,
          label: "Filler",
          createdAt: now,
          updatedAt: now,
        });
      }
      as(u);
      assert.equal(await outcome(() => section("S3")), "404");
    });

    it("lists saved entries with a summary and shows the deleted flash", async () => {
      const entryId = await aliceEntry("Example joint checking");
      const out = await html(section("S3"));
      assert.match(out, /Example joint checking/);
      assert.match(out, /Example Bank · Checking · ••0000/);
      assert.match(out, new RegExp(`href="/app/sections/S3/entries/${entryId}"`));
      assert.match(out, /<span class="badge">Account<\/span>/);
      assert.doesNotMatch(out, /No entries yet/);
      const flash = await html(
        SectionPage({ params: Promise.resolve({ key: "S3" }), searchParams: Promise.resolve({ deleted: "1" }) }),
      );
      assert.match(flash, /Entry deleted\./);
    });

    it("omits the summary line when an entry has no metadata", async () => {
      await actions.saveEntry({ sectionKey: "S12", entryType: "note", entryId: null, values: { label: "Bare note" } });
      const out = await html(section("S12"));
      assert.match(out, /<strong>Bare note<\/strong><\/span>/);
    });
  });

  describe("entry pages", () => {
    it("new entry uses the requested type or the section's primary type", async () => {
      const policy = await html(newEntry("S6", "policy"));
      assert.match(policy, /New policy/);
      assert.match(policy, /Insurance company/);
      assert.match(policy, /Policy number, last 4 \(optional\)/);
      const fallback = await html(newEntry("S2", "password"));
      assert.match(fallback, /New contact/);
      assert.match(fallback, /Name \(required\)/);
      const none = await html(newEntry("S11"));
      assert.match(none, /New document location/);
      for (const out of [policy, fallback, none]) {
        assert.doesNotMatch(out, /type="password"/);
        assert.match(out, /Never passwords, PINs, or full account numbers/);
      }
      assert.equal(await outcome(() => newEntry("S0", "note")), "404");
    });

    it("renders every entry type's form without a password input", async () => {
      for (const t of schema.ENTRY_TYPES) {
        const out = await html(newEntry("S1", t));
        assert.doesNotMatch(out, /type="password"/);
        assert.doesNotMatch(out, /name="(password|pin|ssn|cvv|accountNumber)"/i);
      }
    });

    it("edit page shows stored values and a delete form", async () => {
      const entryId = await aliceEntry("Edit me");
      const out = await html(editEntry("S3", entryId));
      assert.match(out, /<h1>Edit me<\/h1>/);
      assert.match(out, /value="Example Bank"/);
      assert.match(out, /value="0000"/);
      assert.match(out, /Delete entry/);
      assert.match(out, new RegExp(`name="entryId" value="${entryId}"`));
      assert.equal(await outcome(() => editEntry("S3", "missing")), "404");
      assert.equal(await outcome(() => editEntry("S4", entryId)), "404");
    });
  });

  describe("saveEntry", () => {
    it("creates and updates within the user's own section (survives refresh)", async () => {
      const entryId = await aliceEntry("Round trip");
      const updated = await actions.saveEntry({
        sectionKey: "S3",
        entryType: "account",
        entryId,
        values: { label: "Round trip", institution: "Example Credit Union", last4: "0000" },
      });
      assert.deepEqual(updated, { ok: true, entryId });
      const s3 = (await data.findSection(aliceFile, "S3"))!;
      const row = (await data.getEntry(s3.id, entryId))!;
      assert.deepEqual(JSON.parse(row.payloadJson), { institution: "Example Credit Union", last4: "0000" });
      assert.match(await html(editEntry("S3", entryId)), /value="Example Credit Union"/);
    });

    it("returns 400 with field errors for invalid input", async () => {
      const res = await actions.saveEntry({
        sectionKey: "S3",
        entryType: "account",
        entryId: null,
        values: { label: "", last4: "12345", notes: "full 123456789012" },
      });
      assert.deepEqual(res, {
        ok: false,
        status: 400,
        error: "Fix these fields before this can save: Account nickname, Last 4 digits (optional), Notes.",
        fieldErrors: {
          label: "Account nickname is required.",
          last4: "Enter exactly 4 digits, or leave it blank.",
          notes: "This looks like a full account, card, or ID number. Store the last 4 digits at most.",
        },
      });
      // One wrong field: the toast carries that field's own message.
      assert.deepEqual(
        await actions.saveEntry({
          sectionKey: "S3",
          entryType: "contact",
          entryId: null,
          values: { label: "Pat", phone: "(404) 555-01" },
        }),
        { ok: false, status: 400, error: `Phone: ${PHONE_ERROR}`, fieldErrors: { phone: PHONE_ERROR } },
      );
      assert.deepEqual(
        await actions.saveEntry({ sectionKey: "S3", entryType: "password", entryId: null, values: { label: "x" } }),
        { ok: false, status: 400, error: "Unknown entry type." },
      );
    });

    it("returns 404 for unknown sections, blank ids, missing entries, and type changes", async () => {
      const notFound = { ok: false, status: 404, error: "That entry no longer exists." };
      const entryId = await aliceEntry("Typed");
      const base = { sectionKey: "S3", entryType: "account", values: { label: "x" } };
      assert.deepEqual(await actions.saveEntry({ ...base, sectionKey: "S99", entryId: null }), notFound);
      assert.deepEqual(await actions.saveEntry({ ...base, sectionKey: 3 as unknown as string, entryId: null }), notFound);
      assert.deepEqual(await actions.saveEntry(null as never), notFound);
      assert.deepEqual(await actions.saveEntry({ ...base, entryId: "" }), notFound);
      assert.deepEqual(await actions.saveEntry({ ...base, entryId: 7 as unknown as string }), notFound);
      assert.deepEqual(await actions.saveEntry({ ...base, entryId: "missing" }), notFound);
      assert.deepEqual(await actions.saveEntry({ ...base, entryType: "note", entryId }), notFound);
    });

    it("redirects signed-out callers to sign in", async () => {
      as(null);
      assert.equal(
        await outcome(() => actions.saveEntry({ sectionKey: "S3", entryType: "note", entryId: null, values: {} })),
        "redirect:/sign-in",
      );
    });

    it("returns 500 and logs when the database write fails", async () => {
      const errors: unknown[][] = [];
      const restoreErr = mock.method(console, "error", (...a: unknown[]) => {
        errors.push(a);
      });
      const boom = new Error("disk full");
      const insert = mock.method(db, "insert", () => {
        throw boom;
      });
      try {
        const res = await actions.saveEntry({
          sectionKey: "S3",
          entryType: "note",
          entryId: null,
          values: { label: "Will fail" },
        });
        assert.deepEqual(res, { ok: false, status: 500, error: "Couldn't save right now. Please retry." });
      } finally {
        insert.mock.restore();
        restoreErr.mock.restore();
      }
      assert.deepEqual(errors, [["entry save failed", boom]]);
    });
  });

  describe("removeEntry", () => {
    it("deletes the entry and returns to the section", async () => {
      const entryId = await aliceEntry("Delete me");
      assert.equal(
        await outcome(() => actions.removeEntry(form({ sectionKey: "S3", entryId }))),
        "redirect:/app/sections/S3?deleted=1",
      );
      const s3 = (await data.findSection(aliceFile, "S3"))!;
      assert.equal(await data.getEntry(s3.id, entryId), null);
      assert.doesNotMatch(await html(section("S3")), /Delete me/);
    });

    it("404s unknown sections and entries", async () => {
      assert.equal(await outcome(() => actions.removeEntry(form({ sectionKey: "S99", entryId: "x" }))), "404");
      assert.equal(await outcome(() => actions.removeEntry(form({ sectionKey: "S3", entryId: "missing" }))), "404");
      assert.equal(await outcome(() => actions.removeEntry(new FormData())), "404");
    });
  });

  describe("setChecklistItem", () => {
    it("marks an item done, persists it, and can undo", async () => {
      const s3 = (await data.findSection(aliceFile, "S3"))!;
      const [item] = await data.listChecklist(s3.id);
      assert.equal(
        await outcome(() =>
          actions.setChecklistItem(form({ sectionKey: "S3", itemId: item.id, status: "done" })),
        ),
        "returned",
      );
      assert.deepEqual(revalidated, ["/app/sections/S3"]);
      assert.equal((await data.listChecklist(s3.id))[0].status, "done");
      const out = await html(section("S3"));
      assert.match(out, /item-done/);
      assert.match(out, /Reopen &quot;Checking and savings accounts&quot;/);
      assert.match(out, /<span class="badge">Done<\/span>/);

      await actions.setChecklistItem(form({ sectionKey: "S3", itemId: item.id, status: "skipped" }));
      assert.match(await html(section("S3")), /<span class="badge">Skipped<\/span>/);
      await actions.setChecklistItem(form({ sectionKey: "S3", itemId: item.id, status: "open" }));
      assert.equal((await data.listChecklist(s3.id))[0].status, "open");
      const reopened = await html(section("S3"));
      assert.doesNotMatch(reopened, /<span class="badge">(Done|Skipped)<\/span>/);
      assert.match(reopened, /Mark &quot;Checking and savings accounts&quot; done/);
    });

    it("404s bad statuses, unknown items, and unknown sections", async () => {
      const s3 = (await data.findSection(aliceFile, "S3"))!;
      const [item] = await data.listChecklist(s3.id);
      const run = (v: Record<string, string>) => outcome(() => actions.setChecklistItem(form(v)));
      assert.equal(await run({ sectionKey: "S3", itemId: item.id, status: "complete" }), "404");
      assert.equal(await run({ sectionKey: "S3", itemId: item.id }), "404");
      assert.equal(await run({ sectionKey: "S3", itemId: "missing", status: "done" }), "404");
      assert.equal(await run({ sectionKey: "S4", itemId: item.id, status: "done" }), "404");
      assert.equal(await run({ sectionKey: "S99", itemId: item.id, status: "done" }), "404");
      assert.equal((await data.listChecklist(s3.id))[0].status, "open");
      assert.deepEqual(revalidated, []);
    });
  });

  describe("cross-user access", () => {
    it("returns 404 for another user's entry on every read and write path", async () => {
      const entryId = await aliceEntry("Alice private");
      const aliceS3 = (await data.findSection(aliceFile, "S3"))!;
      as(bob);

      assert.equal(await outcome(() => editEntry("S3", entryId)), "404");
      assert.deepEqual(
        await actions.saveEntry({
          sectionKey: "S3",
          entryType: "account",
          entryId,
          values: { label: "Bob was here" },
        }),
        { ok: false, status: 404, error: "That entry no longer exists." },
      );
      assert.equal(await outcome(() => actions.removeEntry(form({ sectionKey: "S3", entryId }))), "404");
      assert.doesNotMatch(await html(section("S3")), /Alice private/);

      const [aliceItem] = await data.listChecklist(aliceS3.id);
      assert.equal(
        await outcome(() =>
          actions.setChecklistItem(form({ sectionKey: "S3", itemId: aliceItem.id, status: "done" })),
        ),
        "404",
      );

      const row = (await data.getEntry(aliceS3.id, entryId))!;
      assert.equal(row.label, "Alice private");
      assert.equal((await data.listChecklist(aliceS3.id))[0].status, "open");
      const bobS3 = (await data.findSection(bobFile, "S3"))!;
      assert.deepEqual(await data.listEntries(bobS3.id), []);
    });
  });
});
