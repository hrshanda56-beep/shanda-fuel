# TEI Oils audit-fix report

Date: 2026-10-28  
Status: P0 fixes implemented; broader P1–P4 audit scope remains for review.

## Fixed

- **B1** — duplicate reconciliation creation now returns a typed conflict with the existing ID; the daily workspace discovers existing records and opens them.
- **B2** — delivery plus optional before/after dips now uses one `CreateDelivery` transaction; the UI handles step-up and retries the same idempotent command after verification. Added audited tank-dip voiding with reason and calculation exclusion.
- **B3** — submission and approval recompute variances; missing explanations block both paths, red stock variance requires an approver note, approval detects changed-after-submit metrics, and return requires a reason.

## Files and behavior

The implementation is in the forecourt, inventory, delivery UI, reconciliation UI, reporting/alert dip readers, database schema/migration, API command route, error classification, and UI-lock manifest. Migration `0087_reconciliation_approver_notes.sql` is additive and must be reviewed/applied through the normal release migration process; it was not run here.

Security, tenant scoping, Clerk authentication, RLS, production data, and approved transaction history were not weakened or rewritten. Voiding is an update of void metadata only; it is not deletion or mutation of the original measurement.

## Validation

- `pnpm typecheck` — PASS
- `pnpm lint` — PASS
- `pnpm db:check` — PASS
- `pnpm test:unit` — PASS, 244 files / 1,718 tests
- `pnpm build` — PASS, Next.js production build with 116 generated pages
- UI-lock manifest check — covered by the full unit run after updating the manifest

The package scripts emit an existing warning about a duplicate `@aws-sdk/s3-request-presigner` key in `package.json`; it was not part of this task.

## Operational report

- Production contacted: **NO**
- Push/merge/deploy performed: **NO**
- Production migration run: **NO**
- Secrets written or exposed: **NO**

## Remaining risks/blockers

- The requested C0 single-source metrics consolidation and consistency fixture are not included in this focused P0 patch.
- The remaining C1–C8, F2–F6, V1–V4 findings need their own domain-level implementation and integration/browser fixtures; this report does not call them complete.
- The new migration and transaction paths still need execution against the project’s dedicated PostgreSQL integration environment, including rollback/failure-path assertions for nested dips and the void trigger.

## Review readiness

Safe for review/integration as a focused P0 candidate. Do not release until the migration is independently reviewed/applied in the normal environment and the remaining audit scope is either completed or explicitly accepted as deferred.
