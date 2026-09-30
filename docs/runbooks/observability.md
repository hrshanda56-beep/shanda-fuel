# Observability and monitoring runbook

## Purpose and boundary

This runbook defines the minimum operational signals for Shanda Fuel. It does
not introduce a monitoring dependency or claim that an external provider is
configured. The repository provides bounded request IDs and response
propagation for API route handlers, structured request/error/dependency/provider
events, normalized route and status dimensions, centralized redaction, and
machine-validated provider-neutral alert/dashboard definitions. Wiring the
deployed application to an approved sink and notification path remains an
operator gate.

## Evidence status

| Area | Repository evidence | External status |
| --- | --- | --- |
| Runtime log contract | `src/platform/observability/`, `src/platform/logging/`, adapter logging, and focused unit tests | Implemented; deployed ingestion is not verified here |
| Alert definitions | [`config/observability/alerts.json`](../../config/observability/alerts.json) | Defined; provider rules are not installed here |
| Dashboard definition | [`config/observability/dashboard.json`](../../config/observability/dashboard.json) | Defined; provider dashboard is not installed here |
| Catalog validation | `scripts/validate-observability.ts` and `src/platform/observability/catalog.test.ts` | Runnable in CI/local validation |
| Safe alert stimulus | `scripts/staging-observability-alert-proof.ts` | Requires an approved staging URL and configured alert delivery |
| Sink, retention, delivery, owners | [`observability-provider-setup.md`](observability-provider-setup.md) | Open until operator evidence is attached |

Run `pnpm exec tsx scripts/validate-observability.ts` before translating the
definitions into a provider. The checked-in definitions are a reproducible
contract, not evidence that a provider dashboard, alert, retention policy, or
notification destination exists.

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

The production monitoring owner should translate the checked-in catalog into a
dashboard and alerts for:

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

The catalog intentionally covers only signals the application currently emits.
Database slow-query metrics, pool-exhaustion metrics, job retry/terminal-failure
metrics, and backup freshness require a provider/database/backup source to be
connected; they must not be represented as healthy merely because the alert
definitions validate.

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

## Alert-specific response

### Readiness failure

Confirm the event is in the intended environment and deployment, then query
`GET /api/readiness` with the recorded request ID. A `503` means the application
cannot prove database readiness; do not route traffic to that deployment. Check
database connectivity and recent deployment/configuration changes before
retrying business commands.

### HTTP 5xx rate

Group by `routeClass`, `route`, and `errorClassification` while preserving the
request IDs for the first and last failures. Check whether the spike is limited
to one deployment or route class. If authoritative commands or tenant
boundaries may be affected, stop normal retries and use the incident response
path.

### Authentication and security failures

Distinguish normal user mistakes from a burst across authentication or protected
routes. Preserve the redacted log event and request IDs, do not include cookies,
passwords, TOTP values, IP addresses, or request bodies in the incident record,
and notify the security owner under the configured escalation policy.

### Critical operational failure

Treat `dependency_failure`, `security_audit_failure`, and repeated internal or
unexpected request errors as an operational incident. Check database, storage,
email, deployment, and audit-signing status as applicable. Never repair posted
or locked business records with direct SQL.

### Provider failure

For `provider_failure`, identify the service (`r2` or `resend`) and whether a
safe manual fallback exists. Use the platform smoke or recovery runbook only in
staging unless production approval is explicitly recorded.

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

## Retention requirements

Retention is an external launch gate because the Blueprint requires conservative
retention until accountant/legal confirmation. The operator must record the
approved retention period separately for staging runtime logs, production
runtime logs, security/audit evidence, dashboard history, alert history, and
staging rehearsal evidence. Do not enable automated deletion or a shorter
provider lifecycle policy before those approvals are recorded. The provider
must expose the configured value, timezone/clock basis, deletion behavior, and
whether alert/evidence records survive source-log expiry.

The required evidence format and provider actions are in
[`observability-provider-setup.md`](observability-provider-setup.md) and
[`observability-staging-alert-proof.md`](observability-staging-alert-proof.md).

## Open operational work

Before pilot sign-off, the operator must select the monitoring vendor/sink,
configure the deployed log drain/event sink, import the dashboard and alert
definitions, set alert destinations, record approved retention periods, name
the on-call/security owners and escalation schedule, and identify the
backup-status source. The repository currently documents and validates the
contract but does not claim those external integrations are configured.
