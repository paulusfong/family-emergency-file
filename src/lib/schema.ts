import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const householdFiles = sqliteTable(
  "household_files",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Family Emergency File"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp" }),
  },
  (t) => [uniqueIndex("household_files_userId").on(t.userId)],
);

export const SECTION_STATUS = ["not_started", "in_progress", "complete"] as const;
export type SectionStatus = (typeof SECTION_STATUS)[number];

export const sections = sqliteTable(
  "sections",
  {
    id: text("id").primaryKey(),
    householdFileId: text("household_file_id")
      .notNull()
      .references(() => householdFiles.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: SECTION_STATUS }).notNull().default("not_started"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("sections_file_key").on(t.householdFileId, t.sectionKey)],
);

export const ENTRY_TYPES = [
  "contact",
  "account",
  "policy",
  "document_location",
  "access_plan",
  "note",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    entryType: text("entry_type", { enum: ENTRY_TYPES }).notNull(),
    label: text("label").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("entries_section_id").on(t.sectionId)],
);

export const CHECKLIST_STATUS = ["open", "done", "skipped"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUS)[number];

export const checklistItems = sqliteTable(
  "checklist_items",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    label: text("label").notNull(),
    status: text("status", { enum: CHECKLIST_STATUS }).notNull().default("open"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("checklist_items_section_key").on(t.sectionId, t.itemKey)],
);

/** Canonical S1–S12 titles for the Family Emergency File. */
export const SECTION_DEFS = [
  { key: "S1", title: "Household snapshot", sortOrder: 1 },
  { key: "S2", title: "Key contacts", sortOrder: 2 },
  { key: "S3", title: "Banking & cash", sortOrder: 3 },
  { key: "S4", title: "Credit & debt", sortOrder: 4 },
  { key: "S5", title: "Investments & retirement", sortOrder: 5 },
  { key: "S6", title: "Insurance", sortOrder: 6 },
  { key: "S7", title: "Income & benefits", sortOrder: 7 },
  { key: "S8", title: "Bills & subscriptions", sortOrder: 8 },
  { key: "S9", title: "Property & vehicles", sortOrder: 9 },
  { key: "S10", title: "Digital life & access plan", sortOrder: 10 },
  { key: "S11", title: "Documents & locations", sortOrder: 11 },
  { key: "S12", title: "Final wishes / practical notes", sortOrder: 12 },
] as const;
