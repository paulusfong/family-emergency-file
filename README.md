# Family Emergency File

A privacy-first household emergency checklist. Map accounts, contacts, documents, and access plans so a trusted person can act when you cannot.

**Privacy posture:** magic-link auth only; never store passwords here; not a password manager; not legal advice.

## Stack

- Next.js App Router, React 19, TypeScript, Tailwind 4
- better-auth (magic link)
- Drizzle ORM + `@libsql/client` (local SQLite or Turso)

## Local setup

Requires **Node 24+** (tests use `node:test` module mocks).

```bash
cp .env.example .env.local
# Set BETTER_AUTH_SECRET to a random string ≥ 32 chars
npm install
npm run db:push
npm run dev
```

Open http://localhost:3000. Request a magic link on `/sign-in`. Without `RESEND_API_KEY`, the link is logged to the server console and written to `tmp/last-magic-link.txt`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local Next.js server |
| `npm run build` / `start` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Node test runner + tsx (`src/**/*.test.ts` and `scripts/**/*.test.mjs`) |
| `npm run test:coverage` | c8 gate on all of `src/**`: 100% lines/statements/functions/branches |
| `npm run test:mutation` | Stryker on `src/lib`, server actions, and `proxy.ts` (break 90) |
| `node scripts/ci-changed.mjs plan` | Show what CI would run for the current branch |
| `npm run db:push` | Push Drizzle schema (Turso dialect) |
| `npm run scan:full-numbers` | Run `validateEntry` and the raw-payload number checks over every stored entry; prints row ids and field names only (see the pre-launch checklist) |

Migrations live in `drizzle/` (`npx drizzle-kit generate`). drizzle-kit refuses a non-`file:` `DATABASE_URL` unless `FEF_ALLOW_REMOTE_DB=1`, so an ambient remote URL can never receive this schema by accident. Tests always run against throwaway local sqlite files (`src/test/setup.mjs`).

In production (`NODE_ENV=production` or on Vercel) the app fails closed without `BETTER_AUTH_SECRET` (≥32 chars), `BETTER_AUTH_URL`, and `RESEND_API_KEY`.

## CI

`.github/workflows/ci.yml` runs four jobs:

- **plan** (`scripts/ci-changed.mjs`): diffs the PR against its merge base. Mode `full` when `package.json`, `package-lock.json`, `tsconfig.json`, `stryker.config.mjs`, `.c8rc.json`, `scripts/`, `src/test/`, or `drizzle/` changed; `partial` for other `src/` changes; `skip` otherwise (docs, workflow YAML).
- **test**: lint, `tsc --noEmit`, unit tests (the tests that import a changed file, transitively, in `partial`; everything in `full`), the whole-src 100% coverage gate (every mode, so the whole suite always runs once), and `next build`.
- **mutation**: Stryker in up to six parallel shards. `full` mutates every target; `partial` only changed targets. Files are placed to balance (source size) x (related test size), since each mutant reruns its shard's tests. Each shard runs only the tests that import its files (the whole suite if any file has none), and each breaks below 90%. Each mutant runs the tests that import a mutated module directly first, and the rest of the shard's tests only if those pass, so most mutants are killed in seconds. A shard may run for up to 90 minutes, because shards split by whole files and `privacy-warn.ts` is about 310 mutants on its own.
- **gitleaks**.

## Env vars

See `.env.example`. Key vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL` (default `file:./data/fef.sqlite`), optional `DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN`, optional `RESEND_API_KEY`.

## Domain

- better-auth: `user`, `session`, `account`, `verification`
- `household_files`: one per user; `privacy_ack_at` records when the first-run privacy sheet was dismissed
- `sections`: twelve slots S1–S12 (the stored `status` column is unused; status is derived, see Progress)
- `checklist_items`: 65 starter items across S1–S12 (5, 8, 5, 4, 6, 6, 4, 6, 4, 6, 7, 4; Clark-aligned, `src/lib/sections.ts`), status `open|done|skipped`
- `export_events`: one row per download (file, format `pdf|json|json_age`, time), never any content
- `entries`: `contact|account|policy|document_location|access_plan|note`, label plus metadata JSON validated by `src/lib/entry-fields.ts`

On first successful session, `ensureHouseholdFile` creates exactly one file and seeds the twelve sections and their checklist items in one atomic batch. The same batch backfills files created before a section or item existed.

Entries hold pointers and metadata only: institution, last 4 digits at most, where to find it, an access plan, and who to call. There is no password, PIN, or full-number field. S10's primary entry type is `access_plan` (provider, where the login lives, recovery and emergency access, who to call), and nothing in it asks for a credential. In every field (phone and email included) the server rejects text shaped like a full account, card, or SSN number and any value written after a credential label such as `password:` or `PIN=`. The number check (`src/lib/privacy-warn.ts`, shared by the editor and the server) normalizes the text first (the Hangul fillers U+3164, U+FFA0, U+115F, and U+1160 become spaces; NFKC; every default-ignorable code point, such as ZWSP, ZWJ, or a soft hyphen, removed; any script's digits read as 0-9) and joins digits across every character that is not a letter or digit, so spaces, NBSP, tabs, dashes, en-dashes, commas, and underscores all count as separators, as does an extension marker (`x`, `ext`) standing alone. It then blocks, in order: a phone that hides a card (below); any other 13-19 digit run that passes the Luhn check, also tried without a leading country code `1` written on its own; an SSN layout (3-2-4 digits); and any run of 9 or more digits left once well-formed tokens are set aside. For the Luhn and SSN checks only, a single letter between digit groups is a separator too (`4111a1111b1111c1111`); a word of two or more letters ends every run, so VINs, serial numbers, and policy IDs (`1HGCM82633A004352`, `SN: C02XK1ABJG5H`, `HO3-4471-AZ`) do not join into long numbers.

Phones written in phone format and valid for their country (`libphonenumber-js/min`, default region US, plus North American numbers it misses when other digits sit next to them, as in `4/23/2013 - (770) 547-4454`) are set aside for every check, the Luhn check included, so an address, date, ZIP, or short extension next to a phone does not join it into a card number (`Atlanta GA 30301 (404) 683-5510`, `(404) 555-0147 ext. 204`). A seven-digit local number is not set aside. What a phone could hide is checked on purpose: its national number, and its digits as typed (with a written `+1`), alone and joined to the digit group after it (its extension, or the next group across extension markers such as `x`, `ext.`, `extension`, `#`, `no.`, `/`, `,`, within 16 characters; not across any other word, and not when a word follows a group with no marker before it, as in a street number) and to the group just before it (across 1-3 separators and no letters). A join counts when the group after has 5 or more digits, or the join adds 6 or more digits in all (a short extension after a marker never joins the group before). A group inside another set-aside token (a phone, date, ZIP+4, amount, or year list) never joins. If any of these is a 13-19 digit Luhn-valid number, the text is blocked (`(404) 683-5510 x373597`, `+1 (404) 683-5510. x373597`, `404-683-5510 extension #373597`). The other set-aside tokens are dates, ZIP+4s, dollar amounts or amounts with cents (up to 12 whole-dollar digits, correctly comma-grouped), year lists (comma-separated, or five or more years separated by spaces), and VINs: 17 letters and digits with no I, O, or Q, at least two of them letters, whose ISO 3779 check digit in position 9 validates, and with no run of 9 or more digits starting before position 9. A VIN-shaped token that fails any of these goes through the normal rules: `123456789ABCDEFGH` (wrong check digit), `123456787ABCDEFGH` (valid check digit, but it opens with 9 digits), and `3360585837343724R` (one letter) are blocked, and so are VINs without a check digit that hold 9 or more digits in a row, as some non-North-American VINs do. Known gaps and costs of the phone rules, measured with the seeded generators in `src/test/contact-notes.ts` (`npx tsx src/test/contact-notes.ts`): a bare 5-digit number right after a phone (`(404) 683-5510, 30301`) reads exactly like a phone and a 5-digit extension, so about 1 in 6 of those is blocked; a 13- or 15-digit number written as a phone plus a short group (`(525) 965-8909 210`, `17777 (402) 664-6221`) looks like a phone with a short extension or a ZIP and is not caught; nor is a card split around a phone with a marker before a short tail (`43 522 825-0864 x1826`), or with a plain-separated 5+ digit tail followed by a word (`(404) 683-5510 / 373597 please`). A phone field must hold a valid number written with separators and no extension, such as `(404) 555-0123` or `+44 20 7946 0958`; a bare run like `4045550123` is rejected with the phone message, and any other long digit run, card, or SSN in Phone with the privacy message. About one in ten long international numbers happens to pass the Luhn check and is blocked too; store those as a pointer, such as "Pat's mobile, in my phone contacts". Every read and write is scoped to a section inside the signed-in user's own file, so another user's ids 404.

`/app/sections/[key]` lists the checklist and entries; `/app/sections/[key]/entries/new?type=…` and `/app/sections/[key]/entries/[id]` autosave (debounced, serialized) and show an error toast with Retry when a save is rejected or fails (a rejected save names the field and its message, such as "Phone: Enter a phone number…"), and an offline toast with Retry while the browser is offline; the status never reads "All changes saved." in either case. Closing the tab asks first while an edit is unsaved, including typed content in a new entry that has no label yet. An edit still pending when the editor unmounts is sent then; if that save fails, or the last save had already failed (a blur's save failed, then the person clicked Done), a notice in the `/app` layout (`src/components/lost-save-notice.tsx`) says so, with a link back to the entry. A save that fails in the browser (offline, server unreachable) says the server couldn't be reached; any other failure, such as an HTTP 500, says something went wrong on the server.

## Progress

`src/lib/progress.ts` derives status at read time from `listSectionProgress` (one query):

- **complete**: the section has checklist items and every one is Done or Skip.
- **in progress**: at least one item is Done or Skip, or the section has an entry.
- **not started**: otherwise. Entries alone never complete a section.

The dashboard shows `round(complete / 12 × 100)%` in a `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-valuetext`, and a status chip on each section.

## Privacy rules

On the first dashboard visit a non-modal "Access plans, never passwords" sheet explains what belongs in the file. "Got it" posts `dismissPrivacySheet`, which sets `privacy_ack_at` once, so the sheet stays dismissed on every device.

`src/lib/privacy-warn.ts` is shared by the editor and the server:

- **Block** (`findBlocked`): the server's `validateEntry` rejects these and the editor will not autosave them, with no way to confirm past them.
  - Full numbers (`findFullNumber` / `looksLikeFullNumber`), after normalization (Hangul fillers as spaces, NFKC, default-ignorables removed) with digits joined across any character that is not a letter or digit: any Luhn-valid 13-19 digit run; the SSN layout (3-2-4 digits, any separators); and any run of 9+ digits left once formatted valid phones (`libphonenumber-js/min`, default region US; not when the national number and extension joined pass Luhn), dates, ZIP+4s, amounts, year lists, and VINs whose ISO 3779 check digit validates are set aside (`123456789ABCDEFGH` fails the check, so its SSN is blocked). A lone `x` or `ext` joins digits for every check; a single letter between digit groups joins them only for the Luhn and SSN checks; a word of two or more letters ends every run, so VINs, serials, and policy IDs pass. Date ranges (`2026-09-29 - 2027-09-29`), comma-separated or 5+ spaced years, and amounts such as `$123,456,789.00` are allowed; a bare `4045550123` is not.
  - Labelled credentials: `password`, `passwd`, `passcode`, `pin` (`pin code`, `pin number`), `secret`, `security answer`, `backup code(s)`, `2fa code(s)`, `2fa backup code(s)`, in any case, followed by `:` or `=` and a value. Every label in the text is checked. A pointer (`Password: in the family vault`, `stored`, `kept`, `see`, …), `none`, `n/a`, `tbd`, `unknown`, or punctuation only is not a value.
- **Warn** (`looksLikeSecretToken` and softer label rules): a single token of 8+ characters with a letter and a digit plus mixed case or a symbol and at least 2.5 bits of entropy per character, or 20+ characters at 3.5; softer labels (`pwd`, `passphrase`, `seed phrase`, `recovery code`, `security code`, `cvv`, `otp`) with `:`, `=`, or `#`, and any credential label with `#`; `pin 1234`, `cvv 123`; and `password is "…"`. Emails, URLs, and domains are skipped. The editor holds the save and offers "It’s not a secret, save it" for that exact value. The server allows warnings, because the heuristic can be wrong.

Autosave never sends a draft while any field has a block-level finding, including an edit made while an earlier save is in flight, and an entry saved before a rule changed will not re-save until the flagged field is fixed.

Last-4, email, and phone fields keep their own format rules and skip the warn heuristics (an email address can look like a token), but every field, those included, gets the block-level checks. A phone field takes a valid number written with separators and no extension, such as `(404) 555-0123` or `+44 20 7946 0958`.

## Export

`/app/export` offers three downloads of the signed-in owner's whole file:

- **PDF** (`GET /app/export/pdf`, `src/lib/export-pdf.ts`, pdfkit): a cover page with "Store this somewhere safe; it contains no passwords.", the export date, progress, and a section list, then one page per section S1–S12 with its status, checklist (`[x]` done, `[-]` skipped, `[ ]` open), and entries. Every page has a footer with the notice and "Page n of m". The standard Helvetica fonts cover Windows-1252 only, so other characters print as `?` (the JSON keeps them).
- **JSON** (`GET /app/export/json`): `{ kind: "family-emergency-file", version: 1, exportedAt, title, notice, progress, sections: [{ key, title, status, statusLabel, checklist: [{ label, status }], entries: [{ type, typeTitle, label, fields: [{ name, label, value }], updatedAt }] }] }`. No ids or email.
- **Encrypted JSON**: the browser fetches `/app/export/json?for=age` and encrypts it with [age](https://age-encryption.org/v1) (scrypt passphrase recipient, work factor 2^18, `age-encryption` package) before saving `family-emergency-file-YYYY-MM-DD.json.age`. The passphrase inputs have no `name` and the form never posts, so the passphrase never reaches the server. Decrypt with `age -d family-emergency-file-YYYY-MM-DD.json.age > file.json`. There is no recovery if the passphrase is lost.

The file is looked up from the session, never from the URL, so only the owner can download it. Responses send `Cache-Control: no-store, max-age=0`, `Pragma: no-cache`, and `Content-Disposition: attachment`, and each download writes an `export_events` row. Any stored value that today's block rules would reject is replaced with `[removed: looked like a password or full number]`. The export page uses plain `<a>` links, because a `next/link` prefetch would count as an export.

## Account delete

Settings → Delete account → `/app/settings/delete`. The owner must type `DELETE` (exactly, surrounding spaces ignored). `deleteAccount` then runs `deleteUserData` (`src/lib/account.ts`): one `db.batch` (a single transaction) that deletes export events, entries, checklist items, sections, the household file, sessions, accounts, pending magic-link rows for the user's email, and the user, children first, so it does not depend on foreign-key cascades. It then signs out and redirects to `/account-deleted`. `src/lib/account.test.ts` seeds two real better-auth users, deletes one, and scans every row of every table for the deleted user's id, email, file id, and section ids. It runs once with foreign keys on and once with them off, and fails if a new table appears that the deletion does not know about.

## Pre-launch checklist

- [ ] Scan every stored entry with the current privacy rules: `npm run scan:full-numbers`. It runs the server's `validateEntry` over each row, and the full-number checks over the raw `payload_json` text too, so rows the app cannot read are not skipped: a number anywhere in the raw text is `payload_json`, text that is not a JSON object is `payload_json:unparseable` or `payload_json:not-an-object`, and a non-string value holding digits is `<field>:non-string` (or `payload_json:non-string` under a key the entry type does not define). It prints only `<entry id>\t<field>` lines and a count, never a value or an unknown key name; exit 0 means every row passes, 1 means the listed fields need fixing, 2 means the scan could not run. It reads a local sqlite file (`DATABASE_URL`, default `file:./data/fef.sqlite`), so scan a copy of production (for example `turso db shell <db> .dump | sqlite3 data/prod-copy.sqlite`, then `DATABASE_URL=file:./data/prod-copy.sqlite`). It refuses a remote URL unless `FEF_ALLOW_REMOTE_DB=1`. Run it again whenever a privacy rule changes.
