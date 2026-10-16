# Operational support escalation guide

Status: roles and handoff procedure defined; named contacts, coverage, paging and
acknowledgement times **NOT VERIFIED**. Owner must fill the restricted contact
roster before a pilot relies on it. Do not commit private phone numbers or access
credentials here. No notifications were sent by this task.

| Responsibility                      | First action / authority                                                                                        | Owner evidence required                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Station operator / Supervisor       | Report impact, stop unsafe retries, preserve current work; perform only existing authorized business actions    | Named contact per station, shift cover and authorized scope         |
| Duty support / incident coordinator | Triage, maintain restricted timeline, coordinate updates, route escalation; no implied provider/admin privilege | Primary, backup, coverage hours and tested contact path             |
| Release / Vercel owner              | Confirm deployment/alias/logs and last healthy target; execute only approved traffic/deploy controls            | Correct-project access, plan entitlement, emergency authority       |
| Database / Neon owner               | Connectivity, locks, migration/hash/ACL compatibility and recovery review                                       | Least-privilege access and separate approved elevated operator path |
| Identity / security owner           | Auth/MFA, isolation, secrets, audit retention and containment                                                   | Named primary/backup, authorized provider boundary                  |
| Accounting / domain owner           | Establish financial impact and approve legitimate domain corrections/reversals                                  | Named decision maker and auditable correction process               |
| Integration owner                   | Review docs and candidate separately, resolve release dependencies, collect exact-SHA gates                     | Review record, release decision and remaining exceptions            |

## Routing and timing

P0: total outage, suspected cross-tenant disclosure, compromise or authoritative
corruption. Notify coordinator plus security/release/DB/domain owners as relevant
immediately through the owner-approved contact path. If primary does not answer,
use backup and provider support according to the restricted roster; do not assume
an automatic page exists. Stop operator use of the affected flow. Infrastructure
containment needs authorized control-plane execution.

P1: critical station command, close/reconciliation, legitimate approval or
material DB workflow blocked. Escalate immediately to coordinator and domain/
identity/DB/release owner; agree next update time and safe operating boundary.
P2: recoverable degradation with a safe approved fallback; assign owner and next
check time. P3: non-critical issue; track without calling it a passing check.
Owner must approve staffed coverage, acknowledgement/escalation intervals and
update cadence; formal SLOs are unresolved, so no response guarantee is implied.

## Case template

Incident reference; severity/reason; UTC start/last healthy time; deployment ID
and full SHA; pseudonymous affected scope; user-visible symptoms; safe route,
status/error code and request ID; first checks; business commit outcome known or
ambiguous; impact/workaround; evidence access location; current owner/backup;
authorizations/actions/times; next update; recovery verification; remaining risk.

Keep customer/financial evidence restricted. Support must not request passwords,
TOTP, backup codes, cookies, production DB URLs or shared Owner sessions. Access
requests go to the named owner with purpose, minimum scope, expiry and approval;
no diagnostics access to auth/session/bootstrap internals or new production
principals for convenience. Human DB operators retain hidden-input credentials.

## Closure and integration handoff

Incident coordinator obtains affected operator confirmation plus security or
accounting sign-off where relevant. Record exact recovery SHA/data point,
readiness and smoke, partial-write/duplicate review, preserved audit trail,
residual exceptions and corrective-action owner/date. Integration owner receives
this documentation commit separately from the operational candidate. Documentation
review is not deployment approval; no push/merge/deploy is authorized here.
