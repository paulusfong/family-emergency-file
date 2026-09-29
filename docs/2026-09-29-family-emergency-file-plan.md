# Family Emergency File plan

Builds a privacy-first household emergency checklist app for the Owner who maps accounts and access plans without dumping passwords. Soft-launch PRs are PR-FEF-1 through PR-FEF-5 in order. The rule that binds the program is that a PR is verified only when unit, live, and perf boxes all have evidence.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. Product Dev owns build and opens merge-ready PRs. Chee lands merges for review-gated PRs (PR-FEF-2, PR-FEF-3, PR-FEF-4). Non-gated PRs may merge when CI is green after a clean swarm verdict. Cloud Agents are unavailable on this plan, so workers run as local Task executors and live lanes drive the box browser through computerUse instead of cloud VMs.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, arm a `/goal` with this exact text. "/workspace/family-emergency-file/docs/2026-09-29-family-emergency-file-plan.md. PR order PR-FEF-1, PR-FEF-2, PR-FEF-3, PR-FEF-4, PR-FEF-5. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Product Dev builds. Chee lands review-gated PRs. Done when PR-FEF-5 is merged, prod magic-link works, and soft-launch smoke evidence is filed."
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:pstack/skills/principle-sequence-verifiable-units/SKILL.md`
  - [ ] Note when pstack is plugin-only and not in the app repo. Read the plugin cache paths instead and record that fallback in the trail.
- [ ] Arm the 30-minute audit tick. In a local session, a real terminal `/loop`. In a cloud root, a cloud-sleeper wake chain. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk and the armed /goal. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] PR-FEF-1 is first from `main` (or empty repo bootstrap commit).
  - [ ] PR-FEF-2 after PR-FEF-1.
  - [ ] PR-FEF-3 after PR-FEF-2.
  - [ ] PR-FEF-4 after PR-FEF-3.
  - [ ] PR-FEF-5 after PR-FEF-4.
- [ ] Hold the file boundaries. PR-FEF-1 owns scaffold auth schema legal. PR-FEF-2 owns section seed and entry CRUD. PR-FEF-3 owns dashboard progress and Access Plan privacy UX. PR-FEF-4 owns export and delete. PR-FEF-5 owns review Help analytics soft-launch docs.
- [ ] Hold the review gate. PR-FEF-2, PR-FEF-3, and PR-FEF-4 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, with `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, or on a CI failure that comes from a change on trunk.

### Verdict and merge, for every PR

- [ ] At the code-ready head SHA and at each later push that changes the patch, run the swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh swarm and a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] Root records a clean verdict at the exact head SHA. Review-gated PRs stop for Chee's click. Other PRs squash-merge after CI green and clean verdict. Patch-id must be unchanged after the post-verdict rebase onto trunk.

### Boot recipe, for every live lane

Each live lane runs on the box browser at the PR head (or local `next dev` at that SHA). Drive through computerUse. Save screenshots under `/workspace/family-emergency-file/tmp/swarm-<pr-id>/worker-<n>/`.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Install deps, set local env for magic-link and Turso (or sqlite dev fallback if documented), run `npm run dev`, wait for ready on the printed port.
- [ ] Deliver input only through the box browser. Use network and DOM reads as read-only diagnostics.
- [ ] Save every screenshot to `/workspace/family-emergency-file/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Scaffold auth schema and app shell (PR-FEF-1)

**Depends on.** None. Creates `paulusfong/family-emergency-file` if missing.

**Files.**

- [ ] Create the Next.js App Router project under the repo root.
- [ ] Create auth session magic-link modules under `src/`.
- [ ] Create Drizzle schema and migrations for users, household_files, sections, entries.
- [ ] Create `/app` dashboard stub, settings stub, `/privacy`, and `/terms`.
- [ ] Create CI workflow stub with lint and unit test.

**Build.**

- [ ] Add passwordless email magic-link auth that gates `/app`.
- [ ] Auto-create one household_file on first successful login.
- [ ] Render empty dashboard shell at 0% progress with nav to Settings.
- [ ] Ship privacy and terms stub pages linked from the footer.

**You see.**

- [ ] Unauthenticated visit to `/app` redirects to sign-in.
- [ ] After magic-link, dashboard shows 0% and twelve empty section slots or a placeholder list.
- [ ] Footer links open privacy and terms.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Auth session helper rejects missing cookie. Run `npm test -- auth`.
- [ ] First-login hook creates exactly one household_file row. Run `npm test -- household`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no app yet for early PRs. Record that fact and gate the behavior the diff adds plus the end state the user waits for Save `m0-regression.png`. Pass when sign-in page renders and `/app` redirects while logged out.
- [ ] Lane 2. Request magic-link for a test inbox. Save `m0-magic-request.png`. Pass when UI shows check-your-email without a server error.
- [ ] Lane 3. Complete magic-link sign-in when a link is available in local test mode. Save `m0-signed-in.png`. Pass when dashboard shell is visible.
- [ ] Lane 4. Open Settings from nav. Save `m0-settings.png`. Pass when settings stub renders for the signed-in user.
- [ ] Lane 5. Open Privacy from footer. Save `m0-privacy.png`. Pass when privacy page loads.
- [ ] Lane 6. Open Terms from footer. Save `m0-terms.png`. Pass when terms page loads.
- [ ] Lane 7. Sign out. Save `m0-signed-out.png`. Pass when `/app` again redirects to sign-in.
- [ ] Lane 8. Second login does not create a second household_file. Save `m0-idempotent-login.png`. Pass when dashboard still shows a single file context.
- [ ] Lane 9. Mobile width 390px dashboard. Save `m0-mobile.png`. Pass when nav and progress remain usable without horizontal clip.
- [ ] Lane 10. Direct hit on a protected API or page while logged out. Save `m0-guard.png`. Pass when response is redirect or 401, never private data.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from navigation to interactive dashboard shell after a warm login cookie.
- [ ] Probe. Measure three loads at head with the signed-in cookie. Trunk has no dashboard, so also record cold `/` TTFB at head as an absolute budget check.
- [ ] Baseline. Record trunk `/` TTFB first when a prior deploy exists. Otherwise record N/A trunk and keep the absolute budgets below.
- [ ] Rule. Dashboard interactive under 2000ms on box broadband. Marketing or sign-in TTFB under 1500ms. Fail either absolute budget.

**Review gate.** None. PR-FEF-1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Owner squash-merges after CI green.


## Seed twelve sections and entry CRUD (PR-FEF-2)

**Depends on.** PR-FEF-1.

**Files.**

- [ ] Edit section seed data for S1 through S12.
- [ ] Create section detail route and entry form components.
- [ ] Create server actions or route handlers for entry CRUD.
- [ ] Edit tests covering section seed and entry mutations.

**Build.**

- [ ] Seed Clark-aligned sections S1-S12 with starter checklist items on file create.
- [ ] Let the Owner open a section, add edit and delete entries for contact account policy document-location and note shapes.
- [ ] Persist autosave with a visible error toast on failure.

**You see.**

- [ ] Opening S3 Banking shows seeded checklist items.
- [ ] Adding a bank entry survives refresh.
- [ ] Deleting an entry removes it from the list.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Seed creates twelve sections with non-empty checklist items. Run `npm test -- sections`.
- [ ] Entry create update delete round-trips. Run `npm test -- entries`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no app yet for early PRs. Record that fact and gate the behavior the diff adds plus the end state the user waits for Gate add-entry after login. Save `m1-regression.png`. Pass when signed-in user can open a section that exists at head.
- [ ] Lane 2. Open S2 Key contacts and add a contact. Save `m1-add-contact.png`. Pass when contact appears in the list after save.
- [ ] Lane 3. Edit that contact phone. Save `m1-edit-contact.png`. Pass when updated phone shows after refresh.
- [ ] Lane 4. Delete that contact. Save `m1-delete-contact.png`. Pass when contact is gone.
- [ ] Lane 5. Add a bank account entry in S3. Save `m1-add-bank.png`. Pass when institution name and last-4 optional field save.
- [ ] Lane 6. Add an insurance policy in S6. Save `m1-add-policy.png`. Pass when carrier and policy number save.
- [ ] Lane 7. Mark a checklist item done. Save `m1-check-item.png`. Pass when item status persists.
- [ ] Lane 8. Force a save failure (offline or mocked) and recover. Save `m1-save-error.png`. Pass when error toast appears and retry succeeds when online.
- [ ] Lane 9. Confirm no password input type exists in section forms. Save `m1-no-password.png`. Pass when DOM has zero input[type=password] on section pages.
- [ ] Lane 10. Mobile width entry form. Save `m1-mobile-form.png`. Pass when submit control remains reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from section link click to interactive form, and time from save click to persisted row visible.
- [ ] Probe. Interleave three section opens and three saves at trunk (post PR-FEF-1 shell only) and at head.
- [ ] Baseline. Record trunk section-open time for the stub first.
- [ ] Rule. Section interactive under 1500ms. Save acknowledgement under 1000ms. Fail either.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 5 screenshots into `/workspace/family-emergency-file/tmp/media/PR-FEF-2-review-add.png`.
- [ ] Record a 30 to 60 second video of add-edit-delete on a lane session. Save it as `/workspace/family-emergency-file/tmp/media/PR-FEF-2-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator squash-merges after review click.


## Dashboard progress and Access Plan privacy UX (PR-FEF-3)

**Depends on.** PR-FEF-2.

**Files.**

- [ ] Edit dashboard progress computation.
- [ ] Edit S10 Access Plan fields and helper copy.
- [ ] Create first-run privacy onboarding and paste-warning heuristic.
- [ ] Edit section empty-state copy.

**Build.**

- [ ] Roll section status into dashboard percent and per-section chips.
- [ ] Ship S10 Access Plan without any password field, with helper copy that points to a password manager.
- [ ] Show first-run privacy sheet once per user.

**You see.**

- [ ] Completing one section moves progress above 0%.
- [ ] S10 shows Access Plan fields and never a password box.
- [ ] First login after merge shows the privacy sheet.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Progress percent matches completed section count. Run `npm test -- progress`.
- [ ] Paste heuristic flags a password-like note. Run `npm test -- privacy-warn`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run open-S3-add-entry at trunk and head. Save `m2-regression.png`. Pass when trunk CRUD still works and head progress updates after the same flow.
- [ ] Lane 2. Mark S2 complete and read dashboard. Save `m2-progress.png`. Pass when progress reflects at least one complete section.
- [ ] Lane 3. Open S10 Access Plan. Save `m2-access-plan.png`. Pass when helper copy visible and no password input.
- [ ] Lane 4. Save an access plan note naming a password manager. Save `m2-access-save.png`. Pass when note persists.
- [ ] Lane 5. Trigger first-run privacy sheet on a fresh user. Save `m2-onboarding.png`. Pass when sheet states no password dump.
- [ ] Lane 6. Dismiss onboarding and confirm it does not reappear. Save `m2-onboarding-once.png`. Pass when second visit skips the sheet.
- [ ] Lane 7. Paste a password-like string into notes and observe warning. Save `m2-paste-warn.png`. Pass when warning appears before or on save.
- [ ] Lane 8. Empty section shows why-it-matters copy. Save `m2-empty-state.png`. Pass when purpose sentence is visible.
- [ ] Lane 9. Partial section stays in progress not complete. Save `m2-partial.png`. Pass when status chip shows in progress.
- [ ] Lane 10. Mobile dashboard progress. Save `m2-mobile-progress.png`. Pass when percent and section list remain readable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Dashboard recalculation time after marking a section complete.
- [ ] Probe. Complete one section at trunk and head three times each, measure navigation back to dashboard paint.
- [ ] Baseline. Record trunk dashboard return time first.
- [ ] Rule. Head within 20% of trunk or under 1500ms absolute, whichever is higher. Fail if head exceeds both.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 3 and lane 5 screenshots into `/workspace/family-emergency-file/tmp/media/PR-FEF-3-review-privacy.png`.
- [ ] Record a 30 to 60 second video of Access Plan plus onboarding. Save it as `/workspace/family-emergency-file/tmp/media/PR-FEF-3-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator squash-merges after review click.


## PDF JSON export and account delete (PR-FEF-4)

**Depends on.** PR-FEF-3.

**Files.**

- [ ] Create PDF export pipeline.
- [ ] Create JSON backup export.
- [ ] Create export options UI including exclude last-4 toggle.
- [ ] Create account delete flow with confirmation.

**Build.**

- [ ] Generate a dated PDF packet of sections and entries.
- [ ] Generate owner JSON backup.
- [ ] Hard-delete account data after typed confirmation.

**You see.**

- [ ] Export PDF downloads and opens with section headings.
- [ ] JSON backup downloads and parses.
- [ ] After delete, the same email starts from an empty file.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] PDF builder includes a section heading for a fixture file. Run `npm test -- export-pdf`.
- [ ] Delete removes household_file and entries for the user. Run `npm test -- account-delete`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Fill two sections at trunk and head, then export only at head. Save `m3-regression.png`. Pass when CRUD still works at head before export.
- [ ] Lane 2. Export PDF with two filled sections. Save `m3-pdf.png`. Pass when file downloads and first page shows a section heading.
- [ ] Lane 3. Export JSON backup. Save `m3-json.png`. Pass when file downloads and parses as JSON with sections.
- [ ] Lane 4. Toggle exclude last-4 and export PDF. Save `m3-pdf-redact.png`. Pass when last-4 values are absent from the PDF text extract.
- [ ] Lane 5. Start account delete and cancel. Save `m3-delete-cancel.png`. Pass when data remains.
- [ ] Lane 6. Confirm account delete. Save `m3-delete-confirm.png`. Pass when session ends and data is gone.
- [ ] Lane 7. Sign in again after delete. Save `m3-recreate.png`. Pass when new empty household file is created.
- [ ] Lane 8. Export with zero entries. Save `m3-empty-export.png`. Pass when PDF still downloads with headings or an explicit empty state.
- [ ] Lane 9. Open PDF on phone-width viewport download affordance. Save `m3-mobile-export.png`. Pass when export controls remain tappable.
- [ ] Lane 10. Attempt delete without confirmation phrase. Save `m3-delete-guard.png`. Pass when delete stays disabled or rejected.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. PDF generation time for a fixture with twelve lightly filled sections.
- [ ] Probe. Run the export endpoint or UI action three times at head. Trunk lacks export, so use absolute budgets only.
- [ ] Baseline. Record N/A trunk for PDF. Record dashboard load at trunk for regression context.
- [ ] Rule. PDF ready under 5000ms on box. Fail above 5000ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 6 screenshots into `/workspace/family-emergency-file/tmp/media/PR-FEF-4-review-export.png`.
- [ ] Record a 30 to 60 second video of export then delete. Save it as `/workspace/family-emergency-file/tmp/media/PR-FEF-4-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator squash-merges after review click.


## Annual review Help and soft-launch readiness (PR-FEF-5)

**Depends on.** PR-FEF-4.

**Files.**

- [ ] Create review mode and last_reviewed_at handling.
- [ ] Create Help About pages with Clark attribution.
- [ ] Create privacy-safe analytics events.
- [ ] Create soft-launch tester README and QA smoke checklist.

**Build.**

- [ ] Show stale banner when review is older than 365 days or never after first complete section.
- [ ] Walk confirm-or-skip review mode that updates last_reviewed_at.
- [ ] Ship Help About with inspired-by Clark attribution and Access Plan guidance.
- [ ] Emit signup section_complete and export events without entry contents.

**You see.**

- [ ] Stale banner appears for an aged fixture.
- [ ] Completing review clears the banner and stamps last_reviewed_at.
- [ ] Help explains Access Plan and disclaims legal advice.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Stale detection returns true when last_reviewed_at is null after a complete section. Run `npm test -- review`.
- [ ] Analytics payload omits entry fields. Run `npm test -- analytics`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Export PDF at trunk and head. Save `m4-regression.png`. Pass when export still works at head.
- [ ] Lane 2. Force stale state and load dashboard. Save `m4-stale.png`. Pass when banner is visible.
- [ ] Lane 3. Run review mode confirm on one section. Save `m4-review.png`. Pass when timestamp updates.
- [ ] Lane 4. Open Help. Save `m4-help.png`. Pass when Clark attribution and Access Plan guidance are present.
- [ ] Lane 5. Open About disclaimer. Save `m4-about.png`. Pass when not legal advice and not a password manager appear.
- [ ] Lane 6. Complete a section and observe analytics hook without PII in network payload. Save `m4-analytics.png`. Pass when event fires without entry body fields.
- [ ] Lane 7. Full happy path smoke sign-in fill export. Save `m4-smoke.png`. Pass when all three steps succeed.
- [ ] Lane 8. Mobile Help readability. Save `m4-mobile-help.png`. Pass when text wraps without overflow.
- [ ] Lane 9. Review skip path. Save `m4-review-skip.png`. Pass when skip still advances and can complete review.
- [ ] Lane 10. Soft-launch README reachable from Help or repo docs. Save `m4-tester-readme.png`. Pass when tester one-pager is linked or present in docs.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Review mode section-to-section navigation time.
- [ ] Probe. Walk five sections at head three times. Trunk lacks review mode, so use absolute budget.
- [ ] Baseline. Record N/A trunk for review navigation. Record dashboard load at trunk for context.
- [ ] Rule. Section advance under 800ms. Fail above 800ms.

**Review gate.** None. PR-FEF-5 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Owner squash-merges after CI green, then Product Dev runs prod soft-launch checklist with QA.


## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

No prototype branch yet. Open product calls locked by operator defaults from the PRD session rather than a runtime sketch. Stack choice Next.js Turso Vercel magic-link. Working name Family Emergency File. Optional SSN last-4 allowed. In-app review nudge before email. Unproven items remain paid share-link encryption and second seat (parked in M5).

## Appendix B. Alternatives rejected

Full Orchestrate with cloud workers lost because Cloud Agents are not on the current Cursor plan. Password-manager sync in MVP lost because the product principle forbids becoming a vault. Plaid live balances lost as out of scope and high compliance cost. Multi-user live editing lost for MVP trust and conflict complexity.

## Appendix C. Risks

Users paste passwords into notes anyway. Mitigate in PR-FEF-3 with copy and paste warning. Magic-link email deliverability blocks soft launch. Watch in PR-FEF-1 and PR-FEF-5. Clark attribution mistakes look like affiliation. Fix copy in PR-FEF-5 Help. Local-only live lanes may miss cloud-browser quirks. Record that limit in each swarm report.

## Appendix D. Links and reading list

PRD at `/workspace/family-emergency-file/docs/plans/2026-09-28-prd-and-milestones.md`. Clark checklist at https://clark.com/personal-finance-credit/family-financial-emergency-file-checklist/ . Reuse patterns from `paulusfong/prayer-journal-app` for auth Turso and Vercel. Run `how` and `interrogate` before PR-FEF-3 privacy UX and PR-FEF-4 delete. Keep a decision trail per show-me-your-work under `/workspace/family-emergency-file/docs/trails/`.


## Operator amendment (2026-09-29)

Coverage 100 percent (c8). Mutation at least 90 percent (Stryker). CI enforces both for MVP PRs.
