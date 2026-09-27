# Incident response and rollback runbook

## Principles

Protect tenant isolation, financial truth, audit evidence, and operator safety
first. Do not retry blindly, edit posted/locked records directly, disable RLS,
reuse a session token, or treat a successful HTTP response as proof that a
financial command committed.

## Severity

| Severity | Definition | Examples |
| --- | --- | --- |
| P0 | Active security breach, cross-tenant exposure, authoritative corruption, or total production outage. | Tenant A can see Tenant B; revenue/COGS lineage is corrupted; all traffic unavailable. |
| P1 | Material critical workflow or dependency failure. | Station cannot complete a critical reconciliation; repeated posting failures. |
| P2 | Degraded but recoverable operation with a safe workaround. | Slow reports, provider outage with documented manual follow-up. |
| P3 | Low-impact defect or operational nuisance. | Non-critical UI or documentation issue. |

## First response

1. Open an incident record with severity, environment, deployment, UTC times,
   reporter, affected tenant/station scope, and request/correlation IDs.
2. Page the incident, security, operations, and accounting owners appropriate to
   the severity. Record all decisions and timestamps.
3. Check `/api/health`, `/api/readiness`, deployment/runtime logs, database and
   provider status, recent deployments, and audit/security events.
4. If tenant isolation, authentication/MFA, financial posting, audit integrity,
   or duplicate effects may be involved, stop the affected command path or
   traffic using the hosting/provider control plane and escalate immediately.
5. Preserve redacted logs, request IDs, audit evidence, deployment metadata,
   and relevant backup/PITR timestamps. Do not collect passwords, cookies,
   tokens, or raw sensitive payloads in the incident record.

## Rollback versus recovery

### Application-only rollback

Use this when the defect is in the deployed application and the database schema
and data remain compatible:

1. Identify the last known-good immutable deployment and confirm its commit.
2. Obtain incident-owner approval and record the reason and compatibility check.
3. Repoint traffic or roll back through the hosting provider's deployment
   control plane; do not rewrite Git history or reverse database migrations.
4. Run `/api/health`, `/api/readiness`, authenticated smoke, permission-denial,
   and the affected read-only workflow checks.
5. Keep the incident open until duplicate effects, missing audit evidence, and
   pending retries are reviewed.

### Database or data recovery

Use [`backup-restore.md`](backup-restore.md) for provider PITR, logical backup,
restore-drill, RPO/RTO, and tenant-scoped recovery decisions. A migration is
forward-only operational history; never run an invented down-migration as an
incident shortcut. Posted/locked business records require named reversal,
adjustment, or compensating commands with owner/accounting review.

## Communications and closure

Communicate impact, affected scope, safe workaround, next update owner, and
whether financial or personal data may be involved. On recovery, record the
deployment/data recovery point, validation results, customer/operator impact,
and any manual reconciliation required. Close only after root cause,
containment, evidence retention, corrective actions, and follow-up owners are
recorded.

The repository contains this procedure and the app rollback decision path. The
provider-specific paging, traffic controls, alert destinations, and tenant
recovery exercise still require operations-owner setup.
