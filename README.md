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

Migrations live in `drizzle/` (`npx drizzle-kit generate`). drizzle-kit refuses a non-`file:` `DATABASE_URL` unless `FEF_ALLOW_REMOTE_DB=1`, so an ambient remote URL can never receive this schema by accident. Tests always run against throwaway local sqlite files (`src/test/setup.mjs`).

In production (`NODE_ENV=production` or on Vercel) the app fails closed without `BETTER_AUTH_SECRET` (≥32 chars), `BETTER_AUTH_URL`, and `RESEND_API_KEY`.

## CI

`.github/workflows/ci.yml` runs four jobs:

- **plan** (`scripts/ci-changed.mjs`): diffs the PR against its merge base. Mode `full` when `package.json`, `package-lock.json`, `tsconfig.json`, `stryker.config.mjs`, `.c8rc.json`, `scripts/`, `src/test/`, or `drizzle/` changed; `partial` for other `src/` changes; `skip` otherwise (docs, workflow YAML).
- **test**: lint, `tsc --noEmit`, unit tests (the tests that import a changed file, transitively, in `partial`; everything in `full`), the whole-src 100% coverage gate (every mode, so the whole suite always runs once), and `next build`.
- **mutation**: Stryker in up to six parallel shards. `full` mutates every target; `partial` only changed targets. Files are placed to balance (source size) x (related test size), since each mutant reruns its shard's tests. Each shard runs only the tests that import its files (the whole suite if any file has none), and each breaks below 90%. A shard may run for up to 90 minutes: shards split by whole files, and `privacy-warn.ts` alone (about 310 mutants, run against every test that imports it) needs close to an hour.
- **gitleaks**.

## Env vars

See `.env.example`. Key vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL` (default `file:./data/fef.sqlite`), optional `DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN`, optional `RESEND_API_KEY`.

## Domain

- better-auth: `user`, `session`, `account`, `verification`
- `household_files`: one per user; `privacy_ack_at` records when the first-run privacy sheet was dismissed
- `sections`: twelve slots S1–S12 (the stored `status` column is unused; status is derived, see Progress)
- `checklist_items`: 65 starter items across S1–S12 (5, 8, 5, 4, 6, 6, 4, 6, 4, 6, 7, 4; Clark-aligned, `src/lib/sections.ts`), status `open|done|skipped`
- `entries`: `contact|account|policy|document_location|access_plan|note`, label plus metadata JSON validated by `src/lib/entry-fields.ts`

On first successful session, `ensureHouseholdFile` creates exactly one file and seeds the twelve sections and their checklist items in one atomic batch. The same batch backfills files created before a section or item existed.

Entries hold pointers and metadata only: institution, last 4 digits at most, where to find it, an access plan, and who to call. There is no password, PIN, or full-number field. S10's primary entry type is `access_plan` (provider, where the login lives, recovery and emergency access, who to call), and nothing in it asks for a credential. In every field (phone and email included) the server rejects text shaped like a full account, card, or SSN number and any value written after a credential label such as `password:` or `PIN=`. The number check (`src/lib/privacy-warn.ts`, shared by the editor and the server) normalizes the text first (NFKC, zero-width characters removed, any script's digits read as 0-9) and joins digits across every character that is not a letter or digit, so spaces, NBSP, tabs, dashes, en-dashes, commas, and underscores all count as separators. It then blocks, in order: any 13-19 digit run that passes the Luhn check, with no exemptions; an SSN layout (3-2-4 digits); and any run of 9 or more digits left once well-formed tokens are set aside. Those tokens are phone numbers written in phone format and valid for their country (`libphonenumber-js/min`, default region US), dates, ZIP+4s, dollar amounts or amounts with cents (up to 12 whole-dollar digits, correctly comma-grouped), and year lists (comma-separated, or five or more years separated by spaces). A phone field must hold a valid number written with separators, such as `(404) 555-0123` or `+44 20 7946 0958`; a bare run like `4045550123` is rejected. About one in ten long international numbers happens to pass the Luhn check and is blocked too; store those as a pointer, such as "Pat's mobile, in my phone contacts". Every read and write is scoped to a section inside the signed-in user's own file, so another user's ids 404.

`/app/sections/[key]` lists the checklist and entries; `/app/sections/[key]/entries/new?type=…` and `/app/sections/[key]/entries/[id]` autosave (debounced, serialized) and show an error toast with Retry when a save is rejected or fails, and an offline toast with Retry while the browser is offline; the status never reads "All changes saved." in either case.

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
  - Full numbers (`findFullNumber` / `looksLikeFullNumber`), after NFKC normalization with digits joined across any character that is not a letter or digit: any Luhn-valid 13-19 digit run; the SSN layout (3-2-4 digits, any separators); and any run of 9+ digits left once formatted valid phones (`libphonenumber-js/min`, default region US), dates, ZIP+4s, amounts, and year lists are set aside. Date ranges (`2026-09-29 - 2027-09-29`), comma-separated or 5+ spaced years, and amounts such as `$123,456,789.00` are allowed; a bare `4045550123` is not.
  - Labelled credentials: `password`, `passwd`, `passcode`, `pin` (`pin code`, `pin number`), `secret`, `security answer`, `backup code(s)`, `2fa code(s)`, `2fa backup code(s)`, in any case, followed by `:` or `=` and a value. Every label in the text is checked. A pointer (`Password: in the family vault`, `stored`, `kept`, `see`, …), `none`, `n/a`, `tbd`, `unknown`, or punctuation only is not a value.
- **Warn** (`looksLikeSecretToken` and softer label rules): a single token of 8+ characters with a letter and a digit plus mixed case or a symbol and at least 2.5 bits of entropy per character, or 20+ characters at 3.5; softer labels (`pwd`, `passphrase`, `seed phrase`, `recovery code`, `security code`, `cvv`, `otp`) with `:`, `=`, or `#`, and any credential label with `#`; `pin 1234`, `cvv 123`; and `password is "…"`. Emails, URLs, and domains are skipped. The editor holds the save and offers "It’s not a secret, save it" for that exact value. The server allows warnings, because the heuristic can be wrong.

Autosave never sends a draft while any field has a block-level finding, including an edit made while an earlier save is in flight, and an entry saved before a rule changed will not re-save until the flagged field is fixed.

Last-4, email, and phone fields keep their own format rules and skip the warn heuristics (an email address can look like a token), but every field, those included, gets the block-level checks. A phone field takes a valid number written with separators, such as `(404) 555-0123` or `+44 20 7946 0958`.
