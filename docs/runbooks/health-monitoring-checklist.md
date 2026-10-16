# Health and monitoring checklist

Repository evidence reviewed 2026-10-16 at accepted baseline `99bbe34` and, where
noted, candidate `f245486`. **No live configuration or alert is verified here.**

## Capability inventory

| Capability               | Verified repository evidence                                                                                                                                        | Operational status / limits                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application health       | `src/app/api/health/route.ts`: GET `/api/health`, application `ok`, timestamp/requestId                                                                             | Code implemented. Live result and external uptime polling NOT VERIFIED. Does not check DB/auth.                                                                                                          |
| DB connectivity          | `src/app/api/readiness/route.ts`, `src/platform/db/client.ts`: GET `/api/readiness`, `select 1`; 200 `ok` or 503 `not_ready` with DB `unavailable`/`not_configured` | Code implemented. Not a schema, RLS, pool-capacity, replica, backup or write-readiness test. Config initialization can itself fail.                                                                      |
| API timings/errors       | `src/platform/observability/index.ts`: `http.request.completed`, status/statusClass, route/routeClass, durationMs, environment, requestId; error/unhandled events   | Emitted by wrapped handlers to console. Log ingestion, retention, search and notification delivery NOT VERIFIED. Does not measure whole dashboard render or SQL duration.                                |
| Dependency failure       | `runtime.dependency.unavailable`, signal `dependency_failure`                                                                                                       | Readiness dependency instrumentation implemented; no independent DB agent verified.                                                                                                                      |
| Safe logging             | `src/platform/logging/index.ts`: structured JSON, sensitive-key redaction; Errors reduced to type                                                                   | Code implemented; manually review shared evidence. Not a guarantee that arbitrary free text is safe.                                                                                                     |
| Audit/security           | `src/modules/audit/contracts.ts`, `src/platform/security/audit-signing.ts`: signed append and `security.audit.append_failed` / `security_audit_failure`             | Code implemented; live append/verification and retention NOT VERIFIED. Runtime logs are not an audit archive.                                                                                            |
| Auth/MFA                 | Better Auth catch-all, MFA setup/verify and step-up routes; `src/modules/identity/step-up.ts` records `SECURITY.STEP_UP_FAILED` / `SECURITY.STEP_UP_SUCCEEDED`      | Route statuses and wrapped timings supported; provider-internal reason visibility varies. Not every login failure is a signed audit event. Active provider/flags and hosted Clerk ceremony NOT VERIFIED. |
| Command failures         | `/api/forecourt/commands` and other domain command handlers use API errors; conflict/idempotency/auth/dependency classifications supported                          | Validation and ordinary business-rule error events are deliberately quiet; completion status and safe response error still matter. No command-success alert or business completeness monitor verified.   |
| Alert/dashboard catalogs | `config/observability/alerts.json`, `dashboard.json`; `scripts/validate-observability.ts` and catalog tests                                                         | Definitions only: readiness, 5xx, auth/security bursts, critical operational and provider failures. Owner fields remain placeholders. No installed rules/notifications verified.                         |
| Database indicators      | Readiness plus authorized Neon metrics/logs for compute, connections, lock waits, slow queries, capacity and PITR                                                   | Only connectivity implemented here. Provider visibility, slow-query settings, metric retention, backup freshness and alert routing need approved read-only provider evidence.                            |
| Release/CI               | `.github/workflows/ci.yml`: quality, audit, secret scan, SAST and runtime-role proof; conditional CodeQL                                                            | Workflow definition verified; current run status, branch protection and required checks NOT VERIFIED.                                                                                                    |

## Authorized operator check

- [ ] Confirm environment, alias, deployment ID, full SHA and UTC time first.
- [ ] GET `/api/health`: record status, application check and request ID.
- [ ] GET `/api/readiness`: record status, DB check, request ID and elapsed time.
      Do not loop aggressively or treat cached/browser screenshots as current proof.
- [ ] In the correct Vercel project/deployment, inspect build logs for build failures
      and runtime logs for the incident window, route, 5xx, classifications and IDs.
      Match project, production environment and SHA; empty logs may mean missing
      access, expiry or no request, rather than no failure.
- [ ] Compare route timings/errors to the last healthy release and actual station
      impact. Review auth/step-up, denial spikes and audit append failures separately.
- [ ] With approved Neon access, review database availability/compute, connections,
      lock waits, errors, slow queries if exposed, storage and recovery window.
      `select 1` alone cannot establish these. No diagnostic privilege expansion.
- [ ] Record backup/PITR evidence reference and last restore drill; never infer
      recovery from a healthy endpoint. See [backup/restore](backup-restore.md).
- [ ] Record PASS / FAIL / NOT VERIFIED / NOT CONFIGURED for each check, evidence,
      observer and next action. Escalate using [support escalation](support-escalation.md).

## Required operator evidence before claiming active monitoring

Name sink/vendor, deployment binding, redacted searchable sample and retention;
record installed rule IDs/versions, actual destinations, primary/backup owner and
witnessed notification/acknowledgement evidence. Use
[provider setup](observability-provider-setup.md) and
[staging alert proof](observability-staging-alert-proof.md) only within an approved
scope. Database metrics, backup checks and scheduled uptime probes need separate
sources/access; no new service, paid plan or live configuration is authorized.
The existing plan limitation/declined paid alternative remains an exception,
not a passing monitoring gate.
