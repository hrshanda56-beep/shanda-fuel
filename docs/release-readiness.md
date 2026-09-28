# Release readiness ledger

**Validated application baseline:** `7ba5e68`
**Last reconciled:** 2026-09-28
**Classification:** operational release record; it does not change domain, accounting, authentication, MFA, RLS, authorization, migration, reporting, or settlement behavior.

## Gate status

| Gate | Status | Evidence or owner action |
| --- | --- | --- |
| Merged implementation baseline | **RECORDED** | `docs/implementation-status.md`; R2 recovery implementation baseline `fc10d01`. |
| Repository quality gate | **DEFINED** | `.github/workflows/ci.yml`; attach the CI run for the RC commit. |
| Authenticated staging smoke | **COMPLETE / PASSED** | Completed authenticated staging operator flow using the normal sign-in path and the approved staging procedure. |
| Cross-module staging journeys | **DEFERRED** | Exercise station/day/shift, reconciliation approval, inventory/costing evidence, cash/provider distinction, reporting, and permission-denial paths with synthetic data. |
| Tenant-isolation verification on deployed staging | **COMPLETE / PASSED** | Completed deployed-staging tenant-isolation and RLS verification. |
| Backup/restore drill | **DATABASE, APP, AND R2 RECOVERY VERIFIED** | Lane 4 isolated PITR restore, restored-DB integrity/security validation, isolated application readiness, and provider-configured R2 deleted-object recovery are complete for the exercised staging scope. RPO/RTO planning targets remain unproven. |
| R2 deleted-object recovery | **COMPLETE / PASSED** | Separate private recovery bucket, 30-day Bucket Lock and lifecycle controls, recovery credentials, witnessed synthetic delete/restore drill, checksum verification, retained artifacts, and primary cleanup are evidenced. Production retention remains a separate owner/accounting decision. |
| Performance verification | **PROCEDURE READY; EXECUTION OPEN** | Follow [`staging-performance-verification.md`](runbooks/staging-performance-verification.md) and record p50/p95 results against Blueprint planning goals. |
| Monitoring and alert routing | **EXPECTATIONS RECORDED; INTEGRATION OPEN** | Follow [`observability.md`](runbooks/observability.md); connect the deployed platform to the approved log/alert destination. |
| Incident and app rollback path | **DOCUMENTED** | [`incident-response.md`](runbooks/incident-response.md) and [`deployment.md`](runbooks/deployment.md). Provider-specific console access remains an owner prerequisite. |
| Key rotation | **OPEN FOLLOW-UP** | [`key-rotation.md`](runbooks/key-rotation.md) needs provider-specific rotation and verification evidence. |
| Tenant-scoped recovery | **OPEN FOLLOW-UP** | [`tenant-recovery.md`](runbooks/tenant-recovery.md) needs an approved isolated-restore/extract/repair exercise. |
| Client/accounting/onboarding inputs | **EXTERNAL GATE** | Use the existing onboarding workbook and the confirmation register in the Blueprint; do not invent values. |

## Lane 4 recovery evidence

| Check | Result |
| --- | --- |
| Database PITR isolated restore drill | **COMPLETE** — temporary Neon recovery branch `lane4-restore-drill-20260928` remains available and auto-expires after one day. |
| Restored DB integrity/security validation | **COMPLETE** — independently validated through Neon SQL Editor, including migrations, hierarchy, permissions, lineage, audit evidence, RLS/policies, and checksums. |
| Local app process startup | **VERIFIED** — a local Next.js instance started against the recovery-branch `DATABASE_URL`; the earlier local readiness result was not classified as a restored-database failure. |
| Isolated application verification | **VERIFIED** — temporary Vercel Preview deployment `dpl_Ejf2DLRpiuQUnqg87FXwnvnhyLqY` of source commit `7ba5e683f751f92fbb39755f7d322bfdcc10a8e3` used the recovery-branch `DATABASE_URL`. |
| `/api/health` | **HTTP 200** with application `ok`. |
| `/api/readiness` | **HTTP 200** with database `ok`. |
| App-to-restored-DB readiness | **VERIFIED** by the isolated Vercel Preview deployment. |
| Side-effect scope | No auth, POST, financial, R2, email, cron, migration, smoke, or other write-capable route was invoked. The temporary Vercel project and its deployments were deleted afterward. |
| Staging R2 deployment | **VERIFIED** — production-target staging deployment `dpl_4p5rQvNKxP7hzS8BXtNjpbj1AxpP` from canonical commit `fc10d0112b1e504a58f241326167edec934571cc`; `/api/health` and `/api/readiness` both returned HTTP 200 before the drill. |
| R2 provider configuration | **VERIFIED** — primary `shanda-fuel-staging-private`; separate private recovery bucket `shanda-fuel-staging-recovery`; 30-day Bucket Lock on `recovery/v1/objects/` and `recovery/v1/manifests/`; 30-day lifecycle expiry on `recovery/v1/`; public access disabled. |
| R2 deleted-object recovery drill | **COMPLETE / PASSED** — exit code 0; backup `a8e1cd42-cd34-4f73-a837-1710648d3c7e`; SHA-256 `146f8cd7a6a4435906f62232c7ee4586a0889181bd6424fe49d45f2f3264a2d7`; retained-copy creation, guarded delete, restore, and restored-byte checksum verification passed. |
| R2 retained evidence and cleanup | **VERIFIED** — retained object (59 B, `text/plain`) and manifest (685 B, `application/json`) remained present after the drill; synthetic primary object was deleted; temporary primary-drill credential was revoked; recovery application credential remained active. |
| RPO ≤15 minutes | **NOT DEMONSTRATED BY THIS DRILL**. |
| Full RTO ≤4 hours | **NOT DEMONSTRATED**. |

This evidence establishes isolated application connectivity to the recovered
database plus provider-configured R2 deleted-object recovery. Lane 4 recovery
is complete for the exercised database/application/R2 scope. RPO ≤15 minutes
and RTO ≤4 hours remain unproven; tenant-scoped recovery and broader incident
exercises remain separate gates.

## Deferred authenticated staging gate

The gate is deferred because this repository task has no staging deployment
credentials, staging URL, provider console access, or approved synthetic-data
operator. That is an external execution dependency, not permission to weaken
authentication or seed production.

When access is granted, record one evidence bundle containing:

- deployment identifier, commit, environment, operator, UTC start/end times;
- check-only and bootstrap output from the staging auth runbook, without
  passwords, cookies, tokens, or sensitive identifiers;
- normal HTTPS sign-in evidence, including the configured authenticated setup
  and step-up/MFA paths as deployed;
- successful `OpenBusinessDay` and `StartShift` smoke results, followed by
  proof that temporary grants expire;
- platform storage/email smoke results when those adapters are configured;
- cross-module workflow, tenant-isolation, permission-denial, and error-state
  results; and
- links to performance, restore, logs, and incident-test evidence.

Do not create financial data in the auth-bootstrap smoke unless the staging
test plan explicitly expands the scope and names the cleanup owner.

## Known post-release follow-ups

These are not silently converted into implementation work by the RC:

1. Connect production-grade structured log collection, dashboards, alert
   routing, retention, and on-call ownership.
2. Keep production R2 retention, credential ownership, and recovery-operator
   approval as explicit deployment-owner decisions. The witnessed staging drill
   does not establish production retention or prove the RPO/RTO planning targets.
3. Complete the staging performance run with representative synthetic data and
   investigate any regression before pilot.
4. Complete key rotation and tenant-scoped recovery exercises with provider
   owners.
5. Decide, with signed scope, which deferred domain capabilities are required:
   expenses, exports/artifacts, full profitability, customer commercial policy,
   inventory transfer/calibration, offline synchronization, and external APIs.
6. Capture pilot station/master data, opening positions, accountant/tax
   decisions, training/UAT evidence, shadow-operation results, and pilot exit
   approval.

## Release-blocker reconciliation

There is no repository-only blocker preventing this documentation slice from
being completed. The following are genuine gates for the next environment:

- inability to establish the separate database role topology before deployment;
- missing staging access for the authenticated verification;
- failure of tenant-isolation/security checks or critical financial workflow
  tests;
- no recoverable backup or failed restore drill;
- an unreviewed performance or availability regression; or
- missing client/accounting approval for a required pilot behavior.

Unknown station, bank, tank, supplier, customer, threshold, and opening-position
values remain onboarding/cutover inputs, not software-development blockers.
