# Quality bar (operator 2026-09-29)

- Code coverage: 100% lines/statements/functions on instrumented `src/**` via c8 (`check-coverage`). Prefer branches 100% for greenfield.
- Mutation: Stryker ≥90% kill rate on `src/lib` business logic (break threshold ≥90; prefer 100 where equivalent to prayer-journal).
- CI must fail the PR when either gate fails.
