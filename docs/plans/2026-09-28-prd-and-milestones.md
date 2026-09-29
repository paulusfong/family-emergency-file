# Family Emergency File — Product Requirements Document

**Status:** Draft for review  
**Date:** 2026-09-28  
**Owner:** Product Dev (for Chee)  
**Inspiration:** [Clark Howard — Family Financial Emergency File checklist](https://clark.com/personal-finance-credit/family-financial-emergency-file-checklist/)  
**Working name:** Family Emergency File (FEF)  
**Code name / repo (proposed):** `family-emergency-file`

---

## 1. Problem statement

When a household hit a sudden emergency (hospitalization, death, travel crisis, cognitive decline), the person who “knew where everything was” is often unavailable. Survivors and trusted helpers waste days hunting for bank accounts, insurance policies, passwords, bills, and contacts—while bills keep due dates and decisions can’t wait.

Paper binders and scattered spreadsheets fail for three reasons:

1. **Incomplete** — people never finish the checklist.
2. **Stale** — nobody revisits annually.
3. **Unsafe or unusable** — either passwords live in plain text, or digital access is so locked that helpers can’t act.

We need a guided, privacy-first digital file that mirrors Clark’s practical sections, tracks completion, prompts annual review, and exports a usable packet for a trusted person—**without becoming a password dump**.

---

## 2. Goals

### Product goals (MVP)

- G1. A solo household can complete a guided Clark-aligned emergency file in under 2 hours of focused work (split across sessions).
- G2. Progress is visible by section; incomplete sections are obvious.
- G3. User can export a printable / PDF packet suitable to hand a trusted person or attorney.
- G4. App never requires storing full account passwords; it teaches a “where passwords live” pattern instead.
- G5. Soft annual review nudge so the file does not silently rot.

### Business goals (later, not MVP blockers)

- Optional paid tier for encrypted cloud backup / multi-seat household access.
- Free tier remains useful offline-ish / single-user so the product earns trust before monetization.

### Non-goals (explicit out of scope for v1)

- Live shared editing / multi-user vaults
- Password-manager sync (1Password, Bitwarden APIs)
- Legal document drafting (wills, POA templates as attorney-grade docs)
- Auto-pull of bank balances via Plaid
- Medical EHR integration
- Mobile native apps (responsive web is enough)
- Marketplace of advisors / lead gen

---

## 3. Target users & personas

### Primary — Household money-handler (“Owner”)

Adult who already pays bills, knows accounts, and wants one place “if something happens to me.” Motivated by responsibility and fear of burdening family.

### Secondary — Trusted helper (“Recipient”)

Spouse, adult child, sibling, or executor who receives the export or read-only share later. Needs clarity under stress: what exists, who to call, what to do first—not a scavenger hunt.

### Tertiary — Aging-parent conversation facilitator

Adult child who uses the app as a structured conversation tool with a parent (“let’s fill this together”).

### Anti-persona (do not optimize for)

- People seeking a full password manager replacement
- Professional fiduciary software buyers (enterprise estate tools)

---

## 4. Jobs to be done

1. When I realize my finances are only in my head, I want a guided checklist so I don’t miss critical categories.
2. When I am building the file, I want to save progress and return later without losing work.
3. When I finish (or mostly finish), I want a clean export my spouse/kid can use in a crisis.
4. When a year passes, I want a light reminder to refresh numbers, contacts, and “where passwords live.”
5. When I worry about security, I want clear guidance that secrets stay in a password manager / sealed envelope—not pasted into this app.

---

## 5. Solution overview

A web app that walks the Owner through Clark-aligned sections, stores **structured metadata** (institution names, last-4, policy numbers where appropriate, contact names/phones, locations of documents), tracks completion %, supports PDF export, and optionally stores a short “access plan” (e.g. “Bitwarden family vault; recovery key in safe deposit box”).

**Privacy posture (product principle):** Prefer pointers and metadata over secrets. If a field would normally hold a password, the UI redirects to “Password location / access plan” instead.

---

## 6. Information architecture (Clark-aligned sections)

MVP sections (each is a checklist module with items + free-text notes):

| ID | Section | What we capture (examples) |
|----|---------|----------------------------|
| S1 | Household snapshot | Legal names, DOB, SSN last-4 optional, addresses, dependents |
| S2 | Key contacts | Spouse, kids, attorney, CPA, employer HR, clergy, neighbors |
| S3 | Banking & cash | Banks, account types, last-4, who has access, safe deposit |
| S4 | Credit & debt | Cards, loans, mortgage, student loans, autopay notes |
| S5 | Investments & retirement | Brokerages, 401k/IRA custodians, advisors |
| S6 | Insurance | Life, health, auto, home, disability, long-term care; policy #s, agent |
| S7 | Income & benefits | Employers, Social Security, pensions, disability |
| S8 | Bills & subscriptions | Critical recurring bills, due dates, cancel-on-death notes |
| S9 | Property & vehicles | Homes, deeds location, cars, titles |
| S10 | Digital life & access plan | Email accounts, phone carriers, cloud drives, password manager name + recovery plan (**no full passwords**) |
| S11 | Documents & locations | Will, POA, trusts, tax returns, birth certificates—where physical/digital copies live |
| S12 | Final wishes / practical notes | Burial/cremation prefs, organ donor, “tell them this first” notes (optional; soft, not legal) |

**Global chrome:** Home dashboard (progress), section list, annual review status, Export, Settings (account, data delete).

---

## 7. Core user flows (MVP)

### F1. First-run onboarding

1. Magic-link sign-in (email).
2. Short “what this is / what this isn’t” (esp. no password dump).
3. Create Household File (one file per account in MVP).
4. Land on dashboard with empty sections + suggested first section (S2 or S3).

### F2. Fill a section

1. Open section → see checklist items with status (Not started / Partial / Done).
2. Add entries (e.g. Bank account row: institution, type, last-4, notes, access note).
3. Autosave; mark section Done when user confirms checklist.
4. Return to dashboard; progress updates.

### F3. Export packet

1. Choose Export PDF (and/or JSON backup for owner).
2. Preview summary; optional exclude sensitive last-4.
3. Download PDF labeled for “Trusted person packet.”

### F4. Annual review

1. After 11–12 months (or user-set), banner: “Time to review.”
2. Review mode walks sections with “Still accurate?” confirmations.
3. Updates `last_reviewed_at`.

### F5. Account & data control

1. Download my data (JSON).
2. Delete account + all file data (hard delete confirmation).

---

## 8. Functional requirements

### Auth & account

- FR-A1. Email magic-link authentication (passwordless).
- FR-A2. One active session policy is fine; logout clears session.
- FR-A3. Account deletion destroys all household file data.

### File & sections

- FR-S1. One Household File per user in MVP (schema allows future multi-file).
- FR-S2. Twelve sections as in §6; each has ordered checklist items (seeded) + user entries.
- FR-S3. Entry CRUD within sections; soft validation (required labels, optional fields).
- FR-S4. Section status: `not_started` | `in_progress` | `complete`.
- FR-S5. Overall progress = weighted or simple average of section completion.

### Privacy UX

- FR-P1. No password / PIN / full SSN fields in default forms.
- FR-P2. Optional SSN last-4 only where useful; labeled as optional and sensitive.
- FR-P3. Dedicated Access Plan fields for digital accounts.
- FR-P4. In-app copy explains: store real passwords in a password manager; put recovery instructions here.

### Export

- FR-E1. PDF export covering all completed/partial sections with clear headings.
- FR-E2. Owner JSON backup export.
- FR-E3. Export includes generated date and “review by” suggestion (e.g. +12 months).

### Review

- FR-R1. `last_reviewed_at` stored; dashboard shows stale if > 365 days (configurable later).
- FR-R2. Review checklist flow can mark sections confirmed without re-editing.

### Quality / ops

- FR-Q1. Responsive layout (phone + desktop).
- FR-Q2. Empty states with “why this matters” one-liners per section.
- FR-Q3. Basic error logging; no PII in client analytics events beyond coarse funnel events.

---

## 9. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Security | HTTPS only; httpOnly secure cookies/sessions; encrypt DB at rest (platform default); secrets in env |
| Privacy | No sale of data; clear privacy policy; minimize PII collection |
| Reliability | Target: standard Vercel + managed DB uptime; graceful save errors with retry |
| Performance | Dashboard and section pages interactive < 2s on typical broadband |
| Accessibility | WCAG 2.1 AA aim for forms, focus, contrast |
| Compliance mindset | Not HIPAA product; avoid collecting full medical records. Not a password manager (reduce liability framing) |
| i18n | English-only MVP; structure copy for later i18n if reused patterns from Prayer Journal |

---

## 10. Privacy & security model (product)

**Store:** institution names, account types, last-4, policy numbers, phones, emails of contacts, document locations, narrative notes, access-plan text.

**Do not store (MVP policy):** full passwords, full SSNs, full account numbers, CVVs, seed phrases, government ID scans.

**Threat model (MVP):** Protect against casual access and common web risks (session theft, XSS). Not trying to defeat nation-state adversaries. Future paid tier may add client-side encryption for cloud backup.

**Trusted person access (MVP):** Offline via PDF/JSON the Owner gives them. No in-app sharing yet.

---

## 11. Success metrics (define tracking; do not invent baselines)

Instrument only after launch. Success = directional movement, not fake targets.

| Metric | Definition | Why it matters |
|--------|------------|----------------|
| Activation | % of signups who complete ≥ 1 section within 7 days | Did onboarding work? |
| Depth | Median # of sections marked complete among active users (30d) | Is the checklist usable? |
| Export rate | % of users with ≥ 3 complete sections who exported once | Is the job finishing? |
| Review return | % of users with `last_reviewed_at` older than 365d who return within 30d of nudge | Does freshness work? |
| Trust signal | Support / feedback themes: “password,” “scary,” “helpful” qualitative | Privacy posture landing? |

**Do not claim conversion or revenue numbers until paid tier exists.**

---

## 12. Monetization (post-MVP sketch)

| Tier | Price (TBD) | Includes |
|------|-------------|----------|
| Free | $0 | Full checklist, local/session file, PDF export, annual reminder email |
| Household+ | Paid | Encrypted cloud backup, 2–3 seats, read-only trusted link (time-boxed), priority support |

MVP ships Free complete enough that paid is optional upgrade, not a wall.

---

## 13. Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users paste passwords anyway | Liability / breach harm | Strong UX copy; field types; warn on paste patterns; never label fields “Password” |
| Incomplete files feel like failure | Abandonment | Progress honesty (“partial is useful”); celebrate section completes |
| Clark checklist drift / IP | Legal/brand | Inspired by, not affiliated; original copy; link attribution in About |
| Sensitive PII in DB | Breach | Minimize fields; optional fields; export/delete; future encryption |
| Scope creep into estate law | Delay | Non-goals stick; disclaimer: not legal advice |
| Overlap with password managers | Confusion | Position as “map + access plan,” not vault |

---

## 14. Open decisions (need Chee before build locks)

1. **Stack:** Reuse Prayer Journal patterns (Next.js + Turso + Vercel + magic link) vs greenfield?
2. **Brand name:** “Family Emergency File” vs shorter consumer name?
3. **SSN last-4:** allow optional or ban entirely in MVP?
4. **Annual nudge channel:** in-app only vs email?

*Recommendation if no answer yet:* Next.js/Turso/Vercel reuse; keep working name; allow optional last-4; email nudge post-MVP, in-app first.

---

## 15. Acceptance criteria — MVP “done”

MVP is shippable when:

1. Magic-link signup/login works for a real email.
2. All 12 sections exist with seeded checklist + entry CRUD.
3. Dashboard shows accurate progress.
4. PDF export downloads a readable multi-section packet.
5. JSON data export + account delete work.
6. No UI path invites full password storage; Access Plan section is clear.
7. Privacy policy + “not legal advice / not a password manager” disclaimers exist.
8. Mobile-usable primary flows.
9. QA smoke plan executed (happy path + export + delete).

---

# Milestone & ticket plan

## Milestone map

| M# | Name | Outcome | Target order |
|----|------|---------|--------------|
| M0 | Foundations | Repo, auth, schema, empty shell | First |
| M1 | Checklist core | All sections + CRUD + progress | Second |
| M2 | Export & trust copy | PDF/JSON + privacy UX | Third |
| M3 | Review & polish | Annual review, a11y, disclaimers | Fourth |
| M4 | Soft launch | Deploy, feedback, QA gate | Fifth |
| M5 | Share & paid (later) | Trusted link, encryption, billing | After validation |

---

## M0 — Foundations

**Goal:** Deployable app shell with auth and data model; no real content yet.

| Ticket | Title | Acceptance criteria |
|--------|-------|---------------------|
| FEF-1 | Scaffold Next.js app + Vercel project | App deploys to preview URL; CI lint/test stub green |
| FEF-2 | Magic-link auth | User can request link, sign in, sign out; unauthenticated users redirected from `/app` |
| FEF-3 | DB schema: users, household_files, sections, entries | Migrations apply; one file auto-created on first login |
| FEF-4 | App chrome: nav, dashboard stub, settings stub | Logged-in user sees shell; empty progress 0% |
| FEF-5 | Legal stubs | `/privacy`, `/terms`, disclaimer footer links live |

**Exit:** Preview URL + login + empty dashboard.

---

## M1 — Checklist core

**Goal:** Owner can fill the Clark-aligned file.

| Ticket | Title | Acceptance criteria |
|--------|-------|---------------------|
| FEF-6 | Seed 12 sections + default checklist items | All section IDs S1–S12 present with starter items |
| FEF-7 | Section detail UI | Open section; see items; mark item done/skip; notes field |
| FEF-8 | Entry types: contact, account, policy, document-location, note | CRUD for each; validation for required label |
| FEF-9 | Access Plan fields (S10) | Dedicated UI; helper copy; no password input type |
| FEF-10 | Section status + dashboard progress | Status rolls up; progress % matches completed sections |
| FEF-11 | Autosave + offline-friendly toasts | Failed save shows error; successful save silent or subtle |
| FEF-12 | Empty states / “why it matters” copy | Each section has 1–2 sentence purpose |

**Exit:** User can complete ≥ 3 sections end-to-end and see progress.

---

## M2 — Export & trust copy

**Goal:** Usable packet for a trusted person; privacy posture obvious.

| Ticket | Title | Acceptance criteria |
|--------|-------|---------------------|
| FEF-13 | PDF export | Download includes section headings + entries; date stamped |
| FEF-14 | JSON backup export | Valid JSON round-trips owner data |
| FEF-15 | Export options | Toggle exclude optional last-4 from PDF |
| FEF-16 | Privacy onboarding + paste warning | First-run explains no passwords; warn if paste looks like password in notes (heuristic OK) |
| FEF-17 | Account delete | Confirm → all file rows gone; user cannot login to old data |

**Exit:** Export PDF reviewed as “usable in a stress scenario” by Chee + QA.

---

## M3 — Review & polish

**Goal:** Freshness loop + launch hygiene.

| Ticket | Title | Acceptance criteria |
|--------|-------|---------------------|
| FEF-18 | `last_reviewed_at` + stale banner | Banner when > 365 days or never reviewed after first complete section |
| FEF-19 | Review mode | Confirm/skip per section; updates timestamp |
| FEF-20 | A11y pass on forms | Keyboard reachable; labels; contrast spot-check |
| FEF-21 | Help / About | Clark attribution (inspired by, not affiliated); how to use Access Plan |
| FEF-22 | Basic analytics events (privacy-safe) | signup, section_complete, export—no entry contents |

**Exit:** Review flow works; Help exists; ready for soft launch checklist.

---

## M4 — Soft launch

**Goal:** Real users (Chee household + 1–2 friends) can use prod.

| Ticket | Title | Acceptance criteria |
|--------|-------|---------------------|
| FEF-23 | Prod deploy + env secrets | Magic link email delivers in prod |
| FEF-24 | QA smoke plan | Auth, fill 2 sections, export, delete—documented pass/fail |
| FEF-25 | Feedback channel | In-app or mailto feedback; triage owner assigned |
| FEF-26 | Soft-launch README for testers | 1-pager: what to try, what not to put in the app |

**Exit:** Prod URL stable; smoke pass; known issues listed.

---

## M5 — Post-validation (backlog only)

Do **not** start until M4 learnings say demand exists.

| Ticket | Title | Notes |
|--------|-------|-------|
| FEF-27 | Read-only trusted share link (expiring) | Major security design |
| FEF-28 | Client-side encrypted backup | Paid candidate |
| FEF-29 | Second seat (spouse co-owner) | Conflict rules |
| FEF-30 | Email annual review nudge | Needs email deliverability |
| FEF-31 | Stripe / Lemon Squeezy billing | After FEF-27/28 shape clear |
| FEF-32 | Import from CSV / binder photo OCR | Nice-to-have; high cost |

---

## Suggested build order (first 10 tickets)

1. FEF-1 Scaffold  
2. FEF-2 Auth  
3. FEF-3 Schema  
4. FEF-4 Chrome  
5. FEF-6 Section seed  
6. FEF-7 Section UI  
7. FEF-8 Entry CRUD  
8. FEF-10 Progress  
9. FEF-13 PDF export  
10. FEF-16 Privacy onboarding  

Then FEF-9, 14, 17, 18–19, 23–24.

---

## QA pairing notes

- Hand specs to QA agent as milestones close (same Product war room pattern as Prayer Journal).
- Smoke focus: auth email, section save, PDF open on phone, delete irreversibility.
- Abuse cases: paste password into notes; export with empty sections; double-submit save.

---

## Appendix A — Sample entry fields (illustrative)

**Bank account entry:** `institution`, `account_type` (checking/savings/etc), `last4` (optional), `ownership` (joint/solo), `access_note`, `notes`

**Insurance policy:** `carrier`, `policy_type`, `policy_number`, `agent_name`, `agent_phone`, `document_location`, `notes`

**Contact:** `name`, `relationship`, `phone`, `email`, `role` (attorney/CPA/…), `notes`

**Document location:** `document_type`, `physical_location`, `digital_location`, `notes`

---

## Appendix B — Disclaimer (product copy seed)

> Family Emergency File helps you organize practical information for a household emergency. It is not a law firm, not legal advice, and not a password manager. Do not store full passwords, PINs, or seed phrases here. Prefer a reputable password manager and record only where access lives.

---

*End of PRD + milestone/ticket plan.*
