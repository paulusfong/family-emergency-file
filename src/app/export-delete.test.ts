import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { before, beforeEach, describe, it, mock } from "node:test";
import React from "react";
import { NextRedirect, installNextMocks, renderElement, resetHarness } from "../test/next-harness";
import { applySchema } from "../test/apply-schema";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-exdel-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;
process.env.BETTER_AUTH_SECRET = "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3000";
(process.env as { NODE_ENV?: string }).NODE_ENV = "test";

installNextMocks();
mock.module(pathToFileURL(path.resolve("src/app/globals.css")).href, { defaultExport: {} });

type FakeUser = { id: string; email: string; name: string; emailVerified: boolean; createdAt: Date; updatedAt: Date };
let sessionUser: FakeUser | null = null;
const calls: { name: string; args: unknown }[] = [];
let signOutError: Error | null = null;

mock.module("@/lib/auth", {
  namedExports: {
    auth: {
      api: {
        getSession: async () => (sessionUser ? { user: sessionUser } : null),
        signOut: async (args: unknown) => {
          calls.push({ name: "signOut", args });
          if (signOutError) throw signOutError;
          return {};
        },
      },
    },
  },
});

async function redirectOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    if (e instanceof NextRedirect) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

describe("export and account delete", async () => {
  const { client, db } = await import("@/lib/db");
  const schema = await import("@/lib/schema");
  const { eq } = await import("drizzle-orm");
  const { ensureHouseholdFile } = await import("@/lib/household");
  const { recordExport } = await import("@/lib/export");

  async function signIn(email: string) {
    const user = { id: crypto.randomUUID(), email, name: "", emailVerified: true, createdAt: new Date(), updatedAt: new Date() };
    await db.insert(schema.user).values(user);
    sessionUser = user;
    return { user, file: await ensureHouseholdFile(user.id) };
  }

  const events = async (fileId: string) =>
    (await db.select({ format: schema.exportEvents.format }).from(schema.exportEvents).where(eq(schema.exportEvents.householdFileId, fileId))).map(
      (r) => r.format,
    );

  before(async () => {
    await applySchema(client);
  });

  beforeEach(() => {
    resetHarness();
    calls.length = 0;
    signOutError = null;
    sessionUser = null;
  });

  it("export page offers PDF, JSON, and a browser-encrypted copy, and shows the last export", async () => {
    const { file } = await signIn("export-page@ex.com");
    const { default: ExportPage } = await import("@/app/app/export/page");
    let html = await renderElement(await ExportPage());
    assert.match(html, /<h1>Export your file<\/h1>/);
    assert.match(html, /Store this somewhere safe; it contains no passwords\./);
    assert.match(html, /<a class="btn" href="\/app\/export\/pdf" download="">Download PDF<\/a>/);
    assert.match(html, /<a class="btn btn-secondary" href="\/app\/export\/json" download="">Download JSON<\/a>/);
    const today = new Date().toISOString().slice(0, 10);
    assert.match(html, new RegExp(`age -d family-emergency-file-${today}\\.json\\.age`));
    assert.equal(html.match(/type="password"/g)?.length, 2);
    assert.doesNotMatch(html, /<input[^>]*type="password"[^>]*name=/);
    assert.match(html, /No exports yet\. Downloads are never cached/);

    await recordExport(file.id, "json_age", new Date("2026-09-29T12:00:00Z"));
    html = await renderElement(await ExportPage());
    assert.match(html, /Last export: encrypted JSON on September 29, 2026\./);
  });

  it("serves the owner's PDF with no-store headers and logs the event", async () => {
    const { file } = await signIn("pdf@ex.com");
    const { GET } = await import("@/app/app/export/pdf/route");
    const res = await GET(new Request("http://localhost:3000/app/export/pdf"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(res.headers.get("content-disposition")!, /^attachment; filename="family-emergency-file-\d{4}-\d{2}-\d{2}\.pdf"$/);
    const body = Buffer.from(await res.arrayBuffer()).toString("latin1");
    assert.equal(body.startsWith("%PDF-"), true);
    assert.match(body, /\/Count 13/);
    assert.deepEqual(await events(file.id), ["pdf"]);
  });

  it("serves the owner's JSON, and logs an encrypted export when the browser asks for=age", async () => {
    const { file } = await signIn("json@ex.com");
    const { GET } = await import("@/app/app/export/json/route");
    const res = await GET(new Request("http://localhost:3000/app/export/json"));
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(res.headers.get("content-disposition")!, /filename="family-emergency-file-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    assert.equal(text.endsWith("}\n"), true);
    const data = JSON.parse(text);
    assert.equal(data.kind, "family-emergency-file");
    assert.equal(data.sections.length, 12);
    assert.equal(text.includes("json@ex.com"), false);
    await GET(new Request("http://localhost:3000/app/export/json?for=age"));
    await GET(new Request("http://localhost:3000/app/export/json?for=other"));
    assert.deepEqual((await events(file.id)).sort(), ["json", "json", "json_age"]);
  });

  it("refuses exports without a session and logs nothing", async () => {
    const before = await db.select().from(schema.exportEvents);
    for (const mod of [await import("@/app/app/export/pdf/route"), await import("@/app/app/export/json/route")]) {
      assert.equal(mod.dynamic, "force-dynamic");
      const res = await mod.GET(new Request("http://localhost:3000/app/export/x"));
      assert.equal(res.status, 401);
      assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
      assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
      assert.equal(await res.text(), "Sign in to export your file.");
    }
    assert.equal((await db.select().from(schema.exportEvents)).length, before.length);
  });

  it("settings links to export and to the delete confirm step", async () => {
    await signIn("settings@ex.com");
    const { default: Settings } = await import("@/app/app/settings/page");
    const html = await renderElement(await Settings());
    assert.match(html, /Signed in as settings@ex\.com/);
    assert.match(html, /href="\/app\/export">Export your file<\/a>/);
    assert.match(html, /<a href="\/app\/settings\/delete" class="btn btn-danger">Delete account…<\/a>/);
    assert.match(html, /Sign out/);
  });

  it("delete page asks for DELETE, and flags a wrong confirmation", async () => {
    await signIn("confirm@ex.com");
    const { default: DeletePage } = await import("@/app/app/settings/delete/page");
    let html = await renderElement(await DeletePage({ searchParams: Promise.resolve({}) }));
    assert.match(html, /<h1>Delete your account<\/h1>/);
    assert.match(html, /<strong>confirm@ex\.com<\/strong>/);
    assert.match(html, /<label for="confirm">Type DELETE to confirm<\/label>/);
    assert.match(html, /<input id="confirm" type="text" autoComplete="off" autoCapitalize="characters" spellCheck="false" required="" name="confirm"\/>/);
    assert.match(html, /Delete my account and file<\/button>/);
    assert.doesNotMatch(html, /role="alert"/);
    html = await renderElement(await DeletePage({ searchParams: Promise.resolve({ error: "confirm" }) }));
    assert.match(html, /aria-invalid="true" aria-describedby="confirm-error"/);
    assert.match(html, /<p class="field-error" id="confirm-error" role="alert">Type DELETE in capital letters to delete your account\.<\/p>/);
  });

  it("deleteAccount keeps everything unless DELETE is typed exactly", async () => {
    const { user } = await signIn("careful@ex.com");
    const { deleteAccount } = await import("@/app/app/settings/delete/actions");
    for (const confirm of ["", "delete", "DELETE it", null]) {
      const form = new FormData();
      if (confirm !== null) form.set("confirm", confirm);
      assert.equal(await redirectOf(() => deleteAccount(form)), "/app/settings/delete?error=confirm");
    }
    assert.equal((await db.select().from(schema.user).where(eq(schema.user.id, user.id))).length, 1);
    assert.deepEqual(calls, []);
  });

  it("deleteAccount hard-deletes the user and file, signs out, and shows the confirmation", async () => {
    const { user, file } = await signIn("gone@ex.com");
    await recordExport(file.id, "pdf");
    const { deleteAccount } = await import("@/app/app/settings/delete/actions");
    const form = new FormData();
    form.set("confirm", "  DELETE ");
    assert.equal(await redirectOf(() => deleteAccount(form)), "/account-deleted");
    assert.equal((await db.select().from(schema.user).where(eq(schema.user.id, user.id))).length, 0);
    assert.equal((await db.select().from(schema.householdFiles).where(eq(schema.householdFiles.id, file.id))).length, 0);
    assert.equal((await db.select().from(schema.sections).where(eq(schema.sections.householdFileId, file.id))).length, 0);
    assert.deepEqual(await events(file.id), []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "signOut");
    assert.equal((calls[0].args as { headers: unknown }).headers instanceof Headers, true);
  });

  it("deleteAccount still finishes when sign-out fails after the session is gone", async () => {
    const { user } = await signIn("no-session@ex.com");
    signOutError = new Error("FAILED_TO_GET_SESSION");
    const { deleteAccount } = await import("@/app/app/settings/delete/actions");
    const form = new FormData();
    form.set("confirm", "DELETE");
    assert.equal(await redirectOf(() => deleteAccount(form)), "/account-deleted");
    assert.equal((await db.select().from(schema.user).where(eq(schema.user.id, user.id))).length, 0);
  });

  it("deleteAccount and the delete page require a signed-in user", async () => {
    const { deleteAccount } = await import("@/app/app/settings/delete/actions");
    const form = new FormData();
    form.set("confirm", "DELETE");
    assert.match(await redirectOf(() => deleteAccount(form)), /^\/sign-in/);
    const { default: DeletePage } = await import("@/app/app/settings/delete/page");
    assert.match(await redirectOf(() => DeletePage({ searchParams: Promise.resolve({}) })), /^\/sign-in/);
    assert.deepEqual(calls, []);
  });

  it("post-delete screen confirms what was removed, signed out", async () => {
    const { default: Deleted } = await import("@/app/account-deleted/page");
    const html = await renderElement(React.createElement(Deleted));
    assert.match(html, /<h1>Your account is deleted<\/h1>/);
    assert.match(html, /every section, checklist item, entry,\s+and export record/);
    assert.match(html, /Sign-in links we already emailed\s+no longer work/);
    assert.match(html, /href="\/sign-in">Sign in<\/a>/);
    assert.doesNotMatch(html, /href="\/app\/settings"/);
  });

  it("shell nav links to the export page when signed in", async () => {
    const { Shell } = await import("@/components/shell");
    const html = await renderElement(React.createElement(Shell, { signedIn: true }, "body"));
    assert.match(html, /<a href="\/app">Dashboard<\/a><a href="\/app\/export">Export<\/a><a href="\/app\/settings">Settings<\/a>/);
  });
});
