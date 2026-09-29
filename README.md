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
- **mutation**: Stryker in up to four parallel shards. `full` mutates every target; `partial` only changed targets. Each shard runs the tests that import its files, and each breaks below 90%. Each mutant runs the tests that import a mutated module directly first, and the rest of the shard's tests only if those pass, so most mutants are killed in seconds. A shard may run for up to 90 minutes, because shards split by whole files and `privacy-warn.ts` is about 310 mutants on its own.
- **gitleaks**.

## Env vars

See `.env.example`. Key vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL` (default `file:./data/fef.sqlite`), optional `DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN`, optional `RESEND_API_KEY`.

## Domain

- better-auth: `user`, `session`, `account`, `verification`
- `household_files`: one per user
- `sections`: twelve slots S1–S12, status `not_started|in_progress|complete`
- `checklist_items`: 65 starter items across S1–S12 (5, 8, 5, 4, 6, 6, 4, 6, 4, 6, 7, 4; Clark-aligned, `src/lib/sections.ts`), status `open|done|skipped`
- `entries`: `contact|account|policy|document_location|note`, label plus metadata JSON validated by `src/lib/entry-fields.ts`

On first successful session, `ensureHouseholdFile` creates exactly one file and seeds the twelve sections and their checklist items in one atomic batch. The same batch backfills files created before a section or item existed.

Entries hold pointers and metadata only: institution, last 4 digits at most, where to find it, an access plan, and who to call. There is no password, PIN, or full-number field. In every field (phone and email included) the server rejects text shaped like a full account, card, or SSN number and any value written after a credential label such as `password:` or `PIN=`. The number check (`src/lib/privacy-warn.ts`, shared by the editor and the server) normalizes the text first (the Hangul fillers U+3164, U+FFA0, U+115F, and U+1160 become spaces; NFKC; every default-ignorable code point, such as ZWSP, ZWJ, or a soft hyphen, removed; any script's digits read as 0-9) and joins digits across every character that is not a letter or digit, so spaces, NBSP, tabs, dashes, en-dashes, commas, and underscores all count as separators, as does an extension marker (`x`, `ext`) standing alone. It then blocks, in order: a phone that hides a card (below); any other 13-19 digit run that passes the Luhn check, also tried without a leading country code `1` written on its own; an SSN layout (3-2-4 digits); and any run of 9 or more digits left once well-formed tokens are set aside. For the Luhn and SSN checks only, a single letter between digit groups is a separator too (`4111a1111b1111c1111`); a word of two or more letters ends every run, so VINs, serial numbers, and policy IDs (`1HGCM82633A004352`, `SN: C02XK1ABJG5H`, `HO3-4471-AZ`) do not join into long numbers.

Phones written in phone format and valid for their country (`libphonenumber-js/min`, default region US, plus North American numbers it misses when other digits sit next to them, as in `4/23/2013 - (770) 547-4454`) are set aside for every check, the Luhn check included, so an address, date, ZIP, or short extension next to a phone does not join it into a card number (`Atlanta GA 30301 (404) 683-5510`, `(404) 555-0147 ext. 204`). A seven-digit local number is not set aside. What a phone could hide is checked on purpose: its national number, and its digits as typed (with a written `+1`), alone and joined to the digit group after it (its extension, or the next group across extension markers such as `x`, `ext.`, `extension`, `#`, `no.`, `/`, `,`, within 16 characters; not across any other word, and not when a word follows a group with no marker before it, as in a street number) and to the group just before it (across 1-3 separators and no letters). A join counts when the group after has 5 or more digits, or the join adds 6 or more digits in all (a short extension after a marker never joins the group before). A group inside another set-aside token (a phone, date, ZIP+4, amount, or year list) never joins. If any of these is a 13-19 digit Luhn-valid number, the text is blocked (`(404) 683-5510 x373597`, `+1 (404) 683-5510. x373597`, `404-683-5510 extension #373597`). The other set-aside tokens are dates, ZIP+4s, dollar amounts or amounts with cents (up to 12 whole-dollar digits, correctly comma-grouped), year lists (comma-separated, or five or more years separated by spaces), and VINs: 17 letters and digits with no I, O, or Q, at least two of them letters, whose ISO 3779 check digit in position 9 validates, and with no run of 9 or more digits starting before position 9. A VIN-shaped token that fails any of these goes through the normal rules: `123456789ABCDEFGH` (wrong check digit), `123456787ABCDEFGH` (valid check digit, but it opens with 9 digits), and `3360585837343724R` (one letter) are blocked, and so are VINs without a check digit that hold 9 or more digits in a row, as some non-North-American VINs do. Known gaps and costs of the phone rules, measured with the seeded generators in `src/test/contact-notes.ts` (`npx tsx src/test/contact-notes.ts`): a bare 5-digit number right after a phone (`(404) 683-5510, 30301`) reads exactly like a phone and a 5-digit extension, so about 1 in 6 of those is blocked; a 13- or 15-digit number written as a phone plus a short group (`(525) 965-8909 210`, `17777 (402) 664-6221`) looks like a phone with a short extension or a ZIP and is not caught; nor is a card split around a phone with a marker before a short tail (`43 522 825-0864 x1826`), or with a plain-separated 5+ digit tail followed by a word (`(404) 683-5510 / 373597 please`). A phone field must hold a valid number written with separators and no extension, such as `(404) 555-0123` or `+44 20 7946 0958`; a bare run like `4045550123` is rejected with the phone message, and any other long digit run, card, or SSN in Phone with the privacy message. About one in ten long international numbers happens to pass the Luhn check and is blocked too; store those as a pointer, such as "Pat's mobile, in my phone contacts". Every read and write is scoped to a section inside the signed-in user's own file, so another user's ids 404.

`/app/sections/[key]` lists the checklist and entries; `/app/sections/[key]/entries/new?type=…` and `/app/sections/[key]/entries/[id]` autosave (debounced, serialized) and show an error toast with Retry when a save is rejected or fails (a rejected save names the field and its message, such as "Phone: Enter a phone number…"), and an offline toast with Retry while the browser is offline; the status never reads "All changes saved." in either case. Closing the tab asks first while an edit is unsaved, including typed content in a new entry that has no label yet. An edit still pending when the editor unmounts is sent then; if that save fails, or the last save had already failed (a blur's save failed, then the person clicked Done), a notice in the `/app` layout (`src/components/lost-save-notice.tsx`) says so, with a link back to the entry. A save that fails in the browser (offline, server unreachable) says the server couldn't be reached; any other failure, such as an HTTP 500, says something went wrong on the server.

## Pre-launch checklist

- [ ] Scan every stored entry with the current privacy rules: `npm run scan:full-numbers`. It runs the server's `validateEntry` over each row, and the full-number checks over the raw `payload_json` text too, so rows the app cannot read are not skipped: a number anywhere in the raw text is `payload_json`, text that is not a JSON object is `payload_json:unparseable` or `payload_json:not-an-object`, and a non-string value holding digits is `<field>:non-string` (or `payload_json:non-string` under a key the entry type does not define). It prints only `<entry id>\t<field>` lines and a count, never a value or an unknown key name; exit 0 means every row passes, 1 means the listed fields need fixing, 2 means the scan could not run. It reads a local sqlite file (`DATABASE_URL`, default `file:./data/fef.sqlite`), so scan a copy of production (for example `turso db shell <db> .dump | sqlite3 data/prod-copy.sqlite`, then `DATABASE_URL=file:./data/prod-copy.sqlite`). It refuses a remote URL unless `FEF_ALLOW_REMOTE_DB=1`. Run it again whenever a privacy rule changes.
