import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

const testdir = fs.mkdtempSync(path.join(os.tmpdir(), "fef-account-"));
process.env.DATABASE_URL = `file:${path.join(testdir, "t.sqlite")}`;
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
(process.env as { NODE_ENV?: string }).NODE_ENV = "test";
delete process.env.RESEND_API_KEY;

describe("deleteUserData (real better-auth, local sqlite)", async () => {
  const { client, db } = await import("./db");
  const { applySchema } = await import("../test/apply-schema");
  const schema = await import("./schema");
  const { auth } = await import("./auth");
  const { ensureHouseholdFile } = await import("./household");
  const { createEntry, findSection, listChecklist, setChecklistStatus } = await import("./entries");
  const { loadExportData, recordExport } = await import("./export");
  const { CONFIRM_WORD, deleteUserData } = await import("./account");

  /** Request a magic link without printing the dev-mail output; returns the token. */
  async function requestLink(email: string) {
    const orig = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
    try {
      await auth.api.signInMagicLink({ body: { email, callbackURL: "/app" }, headers: new Headers() });
    } finally {
      console.log = orig;
    }
    return /token=([^\s]+)/.exec(logs.join("\n"))![1];
  }

  /** A signed-in user with a full file: checklist, entries, exports, a pending link, an account row. */
  async function seedUser(email: string) {
    const verified = await auth.api.magicLinkVerify({
      query: { token: await requestLink(email) },
      headers: new Headers(),
      returnHeaders: true,
    });
    const cookie = verified.headers.get("set-cookie")!.split(";")[0];
    const userId = verified.response.user.id;
    const file = await ensureHouseholdFile(userId);
    for (const key of ["S2", "S3", "S10"]) {
      const section = (await findSection(file.id, key))!;
      const [item] = await listChecklist(section.id);
      await setChecklistStatus(section.id, item.id, "done");
      await createEntry(section.id, "note", `${email} note in ${key}`, { notes: "Key is in the kitchen drawer" });
    }
    await recordExport(file.id, "pdf");
    await recordExport(file.id, "json_age");
    await requestLink(email);
    await db.insert(schema.account).values({ id: crypto.randomUUID(), accountId: userId, providerId: "magic-link", userId });
    const { eq } = await import("drizzle-orm");
    const sectionIds = (
      await db.select({ id: schema.sections.id }).from(schema.sections).where(eq(schema.sections.householdFileId, file.id))
    ).map((r) => r.id);
    return { email, userId, cookie, file, sectionIds };
  }

  async function appTables() {
    const rows = await client.execute(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
    );
    return rows.rows.map((r) => String(r.name));
  }

  /** Every row of every table, as text, so nothing can hide in a table we forgot. */
  async function dump() {
    const out: Record<string, string[]> = {};
    for (const table of await appTables()) {
      const rows = await client.execute(`select * from "${table}"`);
      out[table] = rows.rows.map((r) => JSON.stringify(r));
    }
    return out;
  }

  before(async () => {
    await applySchema(client);
  });

  it("knows every table that can hold a user's data", async () => {
    // A new table must be added to deleteUserData (and here) before this passes.
    assert.deepEqual(await appTables(), [
      "account",
      "checklist_items",
      "entries",
      "export_events",
      "household_files",
      "sections",
      "session",
      "user",
      "verification",
    ]);
    assert.equal(CONFIRM_WORD, "DELETE");
  });

  it("removes every row that belongs to the user and leaves other users untouched", async () => {
    const a = await seedUser("delete-me@ex.com");
    const b = await seedUser("keep-me@ex.com");
    const bBefore = await loadExportData(b.file, new Date(0));
    const before = await dump();
    for (const table of ["user", "session", "account", "verification", "household_files", "export_events"]) {
      assert.equal(before[table].some((r) => r.includes(a.userId) || r.includes(a.email) || r.includes(a.file.id)), true, table);
    }

    await deleteUserData(a.userId);

    const after = await dump();
    const needles = [a.userId, a.email, a.file.id, ...a.sectionIds];
    const leftovers = Object.entries(after).flatMap(([table, rows]) =>
      rows.filter((r) => needles.some((n) => r.includes(n))).map((r) => `${table}: ${r}`),
    );
    assert.deepEqual(leftovers, []);

    // Row counts drop only by what A owned; B's file reads back identically.
    const bOnly = (rows: string[]) => rows.filter((r) => !needles.some((n) => r.includes(n)));
    for (const table of Object.keys(before)) {
      assert.deepEqual(after[table], bOnly(before[table]), table);
    }
    assert.deepEqual(await loadExportData(b.file, new Date(0)), bBefore);
    assert.equal(a.sectionIds.length, 12);
    assert.equal(after.user.length, 1);
    assert.equal(after.verification.some((r) => r.includes(b.email)), true);

    // A's cookie no longer resolves a session; B's still does.
    assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: a.cookie }) }), null);
    assert.equal((await auth.api.getSession({ headers: new Headers({ cookie: b.cookie }) }))?.user.email, b.email);
  });

  it("deletes every table explicitly, without relying on foreign-key cascades", async () => {
    const fk = await client.execute("pragma foreign_keys");
    assert.equal(Number(fk.rows[0][0]), 1);
    await client.execute("pragma foreign_keys = off");
    try {
      const d = await seedUser("no-cascade@ex.com");
      await deleteUserData(d.userId);
      const needles = [d.userId, d.email, d.file.id, ...d.sectionIds];
      const leftovers = Object.entries(await dump()).flatMap(([table, rows]) =>
        rows.filter((r) => needles.some((n) => r.includes(n))).map((r) => `${table}: ${r}`),
      );
      assert.deepEqual(leftovers, []);
    } finally {
      await client.execute("pragma foreign_keys = on");
    }
  });

  it("ignores verification rows whose value is not JSON", async () => {
    await db.insert(schema.verification).values({
      id: crypto.randomUUID(),
      identifier: "other",
      value: "not json",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const c = await seedUser("third@ex.com");
    await deleteUserData(c.userId);
    const rows = await db.select({ value: schema.verification.value }).from(schema.verification);
    assert.equal(rows.some((r) => r.value === "not json"), true);
    assert.equal(rows.some((r) => r.value.includes("third@ex.com")), false);
  });

  it("is a no-op for an unknown user", async () => {
    const before = await dump();
    await deleteUserData("no-such-user");
    assert.deepEqual(await dump(), before);
  });
});
