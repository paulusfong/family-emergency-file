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
- **mutation**: Stryker in up to six parallel shards. `full` mutates every target; `partial` only changed targets. Files are placed to balance (source size) x (related test size), since each mutant reruns its shard's tests. Each shard runs only the tests that import its files (the whole suite if any file has none), and each breaks below 90%.
- **gitleaks**.

## Env vars

See `.env.example`. Key vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL` (default `file:./data/fef.sqlite`), optional `DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN`, optional `RESEND_API_KEY`.

## Domain

- better-auth: `user`, `session`, `account`, `verification`
- `household_files`: one per user; `privacy_ack_at` records when the first-run privacy sheet was dismissed
- `sections`: twelve slots S1–S12 (the stored `status` column is unused; status is derived, see Progress)
- `checklist_items`: starter items per section (Clark-aligned, `src/lib/sections.ts`), status `open|done|skipped`
- `entries`: `contact|account|policy|document_location|access_plan|note`, label plus metadata JSON validated by `src/lib/entry-fields.ts`

On first successful session, `ensureHouseholdFile` creates exactly one file and seeds the twelve sections and their checklist items in one atomic batch. The same batch backfills files created before a section or item existed.

Entries hold pointers and metadata only: institution, last 4 digits at most, where to find it, an access plan, and who to call. There is no password, PIN, or full-number field. S10's primary entry type is `access_plan` (provider, where the login lives, recovery and emergency access, who to call), and nothing in it asks for a credential. Every read and write is scoped to a section inside the signed-in user's own file, so another user's ids 404.

`/app/sections/[key]` lists the checklist and entries; `/app/sections/[key]/entries/new?type=…` and `/app/sections/[key]/entries/[id]` autosave (debounced, serialized) and show an error toast with Retry when a save fails.

## Progress

`src/lib/progress.ts` derives status at read time from `listSectionProgress` (one query):

- **complete**: the section has checklist items and every one is Done or Skip.
- **in progress**: at least one item is Done or Skip, or the section has an entry.
- **not started**: otherwise. Entries alone never complete a section.

The dashboard shows `round(complete / 12 × 100)%` in a `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-valuetext`, and a status chip on each section.

## Privacy rules

On the first dashboard visit a non-modal "Access plans, never passwords" sheet explains what belongs in the file. "Got it" posts `dismissPrivacySheet`, which sets `privacy_ack_at` once, so the sheet stays dismissed on every device.

`src/lib/privacy-warn.ts` is shared by the editor and the server:

- **Block** (`findFullNumber`): SSN-shaped `ddd-dd-dddd` or `ddd dd dddd`; digit runs of 9+ unless phone-shaped (10 digits, or 11 starting with 1); and 13–19 digits written in groups of 4+ (cards, account numbers). The editor shows the error and does not save. `validateEntry` rejects the same text, so a direct POST cannot store it.
- **Warn** (`looksLikeSecretToken` and label rules): a single token of 8+ characters with a letter and a digit plus mixed case or a symbol and at least 2.5 bits of entropy per character, or 20+ characters at 3.5; `password:` / `pin=` / `passcode #` style labels followed by a value (not a pointer like "in the vault"); `pin 1234`, `cvv 123`; and `password is "…"`. Emails, URLs, and domains are skipped. The editor holds the save and offers "It’s not a secret, save it" for that exact value. The server does not block warnings, because the heuristic can be wrong.

Last-4, email, and phone fields are validated by their own rules and not scanned.
