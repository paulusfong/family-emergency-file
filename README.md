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
- **mutation**: Stryker in up to four parallel shards. `full` mutates every target; `partial` only changed targets. Each shard runs the tests that import its files, and each breaks below 90%.
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

Entries hold pointers and metadata only: institution, last 4 digits at most, where to find it, an access plan, and who to call. There is no password, PIN, or full-number field. In every field (phone and email included) the server rejects text shaped like a full account, card, or SSN number and any value written after a credential label such as `password:` or `PIN=`. The number check (`src/lib/privacy-warn.ts`, shared by the editor and the server) normalizes the text first (NFKC, zero-width characters removed, any script's digits read as 0-9) and joins digits across every character that is not a letter or digit, so spaces, NBSP, tabs, dashes, en-dashes, commas, and underscores all count as separators. It then blocks, in order: any 13-19 digit run that passes the Luhn check, with no exemptions; an SSN layout (3-2-4 digits); and any run of 9 or more digits left once well-formed tokens are set aside. Those tokens are phone numbers written in phone format and valid for their country (`libphonenumber-js/min`, default region US), dates, ZIP+4s, dollar amounts or amounts with cents (up to 12 whole-dollar digits, correctly comma-grouped), and year lists (comma-separated, or five or more years separated by spaces). A phone field must hold a valid number written with separators, such as `(404) 555-0123` or `+44 20 7946 0958`; a bare run like `4045550123` is rejected. About one in ten long international numbers happens to pass the Luhn check and is blocked too; store those as a pointer, such as "Pat's mobile, in my phone contacts". Every read and write is scoped to a section inside the signed-in user's own file, so another user's ids 404.

`/app/sections/[key]` lists the checklist and entries; `/app/sections/[key]/entries/new?type=…` and `/app/sections/[key]/entries/[id]` autosave (debounced, serialized) and show an error toast with Retry when a save is rejected or fails, and an offline toast with Retry while the browser is offline; the status never reads "All changes saved." in either case.
