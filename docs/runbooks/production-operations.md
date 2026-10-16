# Production operations runbook

Status: **PARTIALLY VERIFIED**, repository review on 2026-10-16. No production
or staging service was contacted. Procedures do not authorize provider changes.

## Identity and scope

- Accepted baseline and freshly fetched `origin/main`:
  `99bbe34cd9e978288f4ffb55fcad9f144e127922`.
- Operational candidate inspected through immutable Git objects:
  `f24548677b7b64d829b03ec9b7ffc2615a0c4530`.
- Production and owner handoff: <https://fuel.shandahr.com> only.
- Current live deployment, alias binding, database journal and provider controls
  require operator evidence. A Git SHA is not deployment proof.
- Historical `CURRENT_STATUS.md` records `2c730491...` and migrations through 0024. The current human instruction supplies the accepted baseline above;
  neither proves today's live state. Preserve historical evidence, reconcile
  with the release owner, and do not silently apply its old migration counts.

This package adds support procedures; PRODUCT_SPEC, DECISIONS and ARCHITECTURE
retain their authority. The candidate is not changed or approved for deployment.

## Start of an operating shift

1. Name the duty support contact and backup using [support escalation](support-escalation.md).
2. Confirm the release record: immutable deployment ID, full SHA, production
   alias, migration evidence, exceptions, backup reference and latest smoke.
3. Have an authorized operator perform [health checks](health-monitoring-checklist.md).
   A healthy process does not prove authorization, financial accuracy or backups.
4. Review redacted errors, unresolved incidents and incomplete business work.
   Ask the station operator about blocked close/reconciliation work; automated
   alert delivery is not verified. Do not wait for an unverified pager.
5. Use [incident procedures](production-incident-playbook.md) for failure and
   [release checks](deployment-rollback-checklist.md) for release decisions.

## Evidence and safe support

Record UTC incident times, station operational date/time and authoritative station
timezone separately; never infer timezone from a browser. Capture deployment ID,
full SHA, route/method/status, `x-request-id`, safe error code and affected scope
in a restricted incident record. Use pseudonymous case references in shared
handover notes. Do not attach raw HAR files, request bodies, customer/payment
records, cookies, TOTP/backup codes, passwords, connection strings or secret values.
Review exports before sharing: key-based logger redaction does not make arbitrary
strings safe. Runtime logs and signed audit evidence are different records.

Support may inspect approved read-only views within its authorized tenant/station
scope. No impersonation, shared sessions, production fixture creation, direct SQL
business repairs, RLS bypass, broad diagnostic grants or provisioning shortcuts.
A production query, smoke, provider read or mutation needs the applicable explicit
human authorization; this documentation task grants none.

## Security response

- **Tenant isolation:** suspected cross-tenant visibility is P0. Stop operator use
  of the affected flow, preserve minimal restricted evidence and involve security
  immediately. Do not reproduce by enumerating other tenants. Provider traffic
  containment needs explicit authority. Verify the fix with synthetic two-tenant
  tests, runtime-role/RLS checks and authorized affected-user smoke.
- **Audit:** retain original signed events, request IDs, key IDs, timestamps and
  chain/verification evidence in approved restricted storage. Do not update,
  delete or re-sign history. An append failure is an integrity incident; involve
  security/domain owners before resuming affected commands. Do not grant support
  access to auth/session/bootstrap tables to inspect it.
- **Secret exposure:** report a reference/location, never the value. Security and
  the provider owner authorize containment, session/credential revocation and
  rotation through [key rotation](key-rotation.md). Preserve restricted evidence
  before removal; verify retired credentials cannot authenticate, affected
  services recover and signing history remains verifiable. No secrets in argv,
  chat, files or logs; human operators use the reviewed hidden-input procedure.
- **Database permissions:** collect redacted SQLSTATE/error type and deployed SHA.
  Database owner compares intended ACLs, role membership, security-definer owner,
  fixed search path and RLS/FORCE RLS. Never grant privileges to suppress errors.
  Keep `job_runtime` unbound under the recorded security exception until permanent
  hardening is verified. First-user provisioning remains a separate gated path.
- **Auth/MFA:** correlate failures by provider, route, request ID and deployment;
  follow the login and step-up incident rows. Never disable MFA, change providers
  or reset credentials as an informal support workaround.

## Handover

Pass open cases, impact, last observation, safe workaround, next check time,
responsible person and authorization boundaries to the next operator. Keep
financial correction/reversal decisions with the accounting/domain owner.
After a release use [the 30-minute watch](post-release-monitoring.md).
Known gaps and owner decisions are in [the risk register](reliability-risks.md).

## Documentation validation

Independent review of the actual files and relevant baseline/candidate code:
**GREEN**, 2026-10-16. Relative links, referenced API route files, actual journal
counts and candidate 0030 SQL hash were checked. New runbooks were explicitly
formatted and checked with existing Prettier 3.9.9, overriding the repository's
`docs/` ignore for these files only. Diff whitespace and documentation-only scope
were checked before commit. No application tests, DB suites, build, hosted CI or
production smoke were run for this documentation-only change; historical/candidate
test evidence above is attributed, not a new PASS. No dependencies were installed.
