# Observability and monitoring runbook

## Purpose and boundary

This runbook defines the minimum operational signals for Shanda Fuel. It does
not introduce a monitoring dependency or change application behavior. The
current repository provides bounded request IDs and response propagation for
API route handlers, one structured request-completion event with status and
duration, centralized redacted error classification, a redacting logger for
platform adapters, safe serialization helpers, and structured error codes.
Wiring the deployed application to a production sink remains a follow-up.

## Endpoints and checks

| Check | Meaning | Operator response |
| --- | --- | --- |
| `GET /api/health` | Node application process responded; it does not prove database or provider readiness. | If failing, inspect deployment/runtime logs and the hosting deployment. |
| `GET /api/readiness` | Application responded and `DATABASE_URL` connectivity returned `ok`; returns `503` when the database is unavailable or not configured. | Do not route production traffic to an instance returning `503`; inspect database connectivity and provider status. |
| CI quality job | Fresh PostgreSQL migration, test, build, and browser verification. | Treat a failed required job as a release stop until triaged. |
| Staging platform smoke | Explicit R2 put/read/delete and optional controlled email send. | Use only in staging; investigate adapter credentials or provider status. |
| Backup evidence | Latest logical backup/PITR status and last successful restore drill. | Escalate missing or unverifiable evidence before pilot/production. |

Health and readiness responses are `no-store` and include `x-request-id`.
Preserve that ID when correlating an operator report with logs. Never expose
tenant data, session cookies, passwords, tokens, database URLs, backup contents,
or full payment/account details in dashboards or support messages.

## Required signals

The production monitoring owner should provide dashboards and alerts for:

- application availability and readiness failure rate;
- request latency and error rate by route class (read, command, auth, provider,
  storage, and report);
- database connection failures, pool exhaustion, slow queries, and migration
  failures;
- authentication failures, step-up/MFA failures, suspicious cross-tenant
  denials, and security-event append failures;
- command conflicts, idempotency conflicts, dependency-unavailable responses,
  and failed reversal/approval attempts;
- storage/email adapter failures and outbox/job retry/terminal-failure state
  once those jobs are enabled; and
- backup freshness, backup verification, restore-drill date, and available
  recovery point.

Alert payloads should contain environment, deployment, severity, route or
component, error code, request/correlation ID, first/last seen time, and a link
to the incident. They should not contain raw request bodies or credentials.

## P0–P3 severity

| Severity | Example | Initial action |
| --- | --- | --- |
| P0 | Cross-tenant exposure, confirmed corruption of authoritative records, or total production outage. | Stop affected traffic/commands, preserve evidence, page the incident owner and security/accounting owners, and use the incident rollback/recovery path. |
| P1 | Critical station workflow unavailable, repeated posting failures, or unrecoverable dependency failure with material operational impact. | Triage immediately, isolate the affected route/domain, communicate impact, and decide app rollback versus recovery. |
| P2 | Degraded performance, provider/storage failure with a safe manual fallback, or repeated non-critical errors. | Assign an owner, capture a workaround, and resolve within the agreed operating window. |
| P3 | Cosmetic, low-volume, documentation, or dashboard issue with no integrity impact. | Track in the follow-up queue; do not conceal it as a successful check. |

## Triage sequence

1. Identify environment, deployment, first-seen time, affected tenant/station
   scope, and the request/correlation ID.
2. Check `/api/health`, `/api/readiness`, deployment logs, database/provider
   status, and recent release changes.
3. Determine whether authoritative financial records, tenant boundaries,
   authentication/MFA, or audit evidence may be affected. If yes, stop normal
   retry loops and involve the domain/security owners.
4. Preserve redacted logs and immutable audit evidence. Do not edit records or
   “fix” a posted/locked result with direct SQL.
5. Use [`incident-response.md`](incident-response.md) for containment and
   [`deployment.md`](deployment.md) for app-only rollback decisions.
6. Record impact, actions, evidence links, recovery point, and follow-ups.

## Open operational work

Before pilot sign-off, name the monitoring vendor/sink, alert destinations,
retention period, on-call owner, escalation schedule, and backup-status source.
The repository currently documents the contract but does not claim those
external integrations are configured.
