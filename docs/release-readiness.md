# Release readiness ledger

**Scope:** current RC at `244ad14`
**Last reconciled:** 2026-09-27
**Classification:** operational release record; it does not change domain, accounting, authentication, MFA, RLS, authorization, migration, reporting, or settlement behavior.

## Gate status

| Gate | Status | Evidence or owner action |
| --- | --- | --- |
| Merged implementation baseline | **RECORDED** | `docs/implementation-status.md`; current integration tip `244ad14`. |
| Repository quality gate | **DEFINED** | `.github/workflows/ci.yml`; attach the CI run for the RC commit. |
| Authenticated staging smoke | **DEFERRED** | Requires staging URL, deployment secrets, synthetic database records, and an approved operator. Use [`staging-auth-smoke-bootstrap.md`](runbooks/staging-auth-smoke-bootstrap.md), [`STAGING_SMOKE.md`](platform/STAGING_SMOKE.md), and the normal sign-in flow. |
| Cross-module staging journeys | **DEFERRED** | Exercise station/day/shift, reconciliation approval, inventory/costing evidence, cash/provider distinction, reporting, and permission-denial paths with synthetic data. |
| Tenant-isolation verification on deployed staging | **DEFERRED** | Prove Tenant A cannot read, write, link, export, or process Tenant B through application and job paths. Do not use production data. |
| Backup/restore drill | **PROCEDURE READY; EXECUTION OPEN** | Follow [`backup-restore.md`](runbooks/backup-restore.md) in an isolated restore target; record RPO/RTO evidence. |
| Performance verification | **PROCEDURE READY; EXECUTION OPEN** | Follow [`staging-performance-verification.md`](runbooks/staging-performance-verification.md) and record p50/p95 results against Blueprint planning goals. |
| Monitoring and alert routing | **EXPECTATIONS RECORDED; INTEGRATION OPEN** | Follow [`observability.md`](runbooks/observability.md); connect the deployed platform to the approved log/alert destination. |
| Incident and app rollback path | **DOCUMENTED** | [`incident-response.md`](runbooks/incident-response.md) and [`deployment.md`](runbooks/deployment.md). Provider-specific console access remains an owner prerequisite. |
| Key rotation | **OPEN FOLLOW-UP** | [`key-rotation.md`](runbooks/key-rotation.md) needs provider-specific rotation and verification evidence. |
| Tenant-scoped recovery | **OPEN FOLLOW-UP** | [`tenant-recovery.md`](runbooks/tenant-recovery.md) needs an approved isolated-restore/extract/repair exercise. |
| Client/accounting/onboarding inputs | **EXTERNAL GATE** | Use the existing onboarding workbook and the confirmation register in the Blueprint; do not invent values. |

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
2. Configure independent logical backups and provider point-in-time recovery;
   execute and evidence the isolated restore drill.
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
