# Shanda Fuel observability closeout

**Inspection completed:** 2026-10-03T13:26:55Z  
**Repository:** `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel`  
**Requested main SHA:** `0db85f6192f7c96fd92282389cc970b35bae2e33`  
**Staging Vercel team:** `shanda-hr-s-projects` (`team_VMthg2WoTS6eeOP5BjRh3i8b`)  
**Staging Vercel project:** `shanda-fuel-staging` (`prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4`)  
**Report integrity:** SHA-256 is recorded in the adjacent `.sha256` sidecar after finalization.

## 1. OBSERVABILITY status

**OBSERVABILITY: BLOCKED**

The local contract is passing, and the linked staging project is deployed at the
requested main SHA. Provider inspection found generic Vercel runtime request
records, but no log drain, provider dashboard/rule objects, retention setting,
alert delivery, acknowledgement, escalation, or named operational owner proof.
The launch gate therefore cannot be marked PASS.

No provider mutation was performed.

## 2. Local alert status — 5/5 PASS

The checked-in catalog contains all required alerts and the validator reported:
`Observability catalog valid: 5 alerts, 6 dashboard panels`.

| Alert ID | Local definition | Intended operational requirement | Local status |
| --- | --- | --- | --- |
| `readiness_failure` | `/api/readiness` 5xx or `runtime.dependency.unavailable`, 5m, P1 | Detect inability to prove application/database readiness | PASS |
| `http_5xx_rate` | `http.request.completed` 5xx ratio > 5% with 20-request minimum, 5m, P1 | Detect elevated application error rate | PASS |
| `auth_security_failures` | Unauthenticated/forbidden or auth-route 4xx/5xx burst, 10m, P2 | Detect authentication and security failure bursts | PASS |
| `critical_operational_failure` | Dependency/security-audit/internal/invariant failures, 5m, P1 | Detect critical application, dependency, or audit failures | PASS |
| `provider_adapter_failure` | `provider_failure` from storage/email adapters, 5m, P2 | Detect R2/email provider failures | PASS |

Local evidence:

- `config/observability/alerts.json`
- `src/platform/observability/catalog.ts`
- `scripts/validate-observability.ts` — pass at 2026-10-03T13:26Z
- Focused tests: 20/20 passed across `catalog.test.ts`, `index.test.ts`, and
  `staging-alert-proof.test.ts` at 2026-10-03T13:26Z

## 3. Local dashboard status — 6/6 PASS

| Panel ID | Local definition | Intended operational requirement | Local status |
| --- | --- | --- | --- |
| `readiness` | Readiness dependency-unavailable events | Readiness failure count | PASS |
| `availability` | Requests grouped by status class | Availability/error-rate trend | PASS |
| `latency` | p50/p95 by route class | Route-class latency | PASS |
| `security` | Auth/security failures by route class and classification | Security failure trend | PASS |
| `operational-failures` | Dependency/audit/internal/invariant event table | Critical failure investigation | PASS |
| `providers` | Provider failures grouped by service/error code | Storage/email adapter health | PASS |

Local evidence: `config/observability/dashboard.json`, the catalog validator,
and the focused observability tests listed above.

## 4–9. Provider evidence summary

| Requirement | Local definition | Local test/evidence | Provider object/evidence | Owner | Retention | Delivery path | Acknowledgement mechanism | Status | Exact remaining action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sink/log-drain existence | Structured runtime log contract and provider setup runbook | Catalog/tests PASS | `GET /v1/log-drains?teamId=team_VMthg2WoTS6eeOP5BjRh3i8b` returned `[]`; project-scoped query also returned `[]` at 2026-10-03T13:26Z | Not named | Not recorded | None proven | None | BLOCKED | Select the approved sink and configure an explicitly staging/production-separated Vercel drain; capture drain ID, signed test timestamp, and provider event ID. Approval required. |
| Destination/provider | `shanda-fuel.runtime.v1` fields and required sink behavior in `docs/runbooks/observability-provider-setup.md` | Contract validation PASS | No approved external vendor/account/endpoint in repository or Vercel marketplace; `vercel integration installations` reported no marketplace installations | Not named | Not recorded | Vercel runtime viewer only | None | BLOCKED | Record approved vendor, account/workspace, endpoint, processing owner, and secret-manager location without putting secrets in Git/output. Approval required. |
| Delivery health / searchable staging event | Request IDs and redacted structured events required by runbook | Redaction/correlation tests PASS | Vercel runtime viewer returned request records for deployment `dpl_Abn9t6t8ASMAiYsbpc8J9UtUdkLh` at 2026-10-03T12:57:45Z–12:57:46Z, including event IDs `t2bmv-1791032266910-71a76c13e628`, `pp28d-1791032266910-93412bb1e80`, and `wcdwb-1791032265968-7749fa2856f9`; records had empty application messages, no request IDs, and no drain acceptance event | Not named | Not recorded | Vercel request-log viewer only; no sink delivery proof | None | BLOCKED | Run the documented staging-only alert proof after sink/rule setup; search the emitted request ID in the sink and attach timestamped event evidence. Do not synthesize or mutate monitoring without approval. |
| Retention period and deletion behavior | Retention gate in `docs/runbooks/observability.md` and provider setup runbook | Documentation present; no approved values | Project metadata reports `deploymentExpiration` of 30 days, which is deployment retention and is not runtime-log, alert-history, security/audit, or rehearsal-evidence retention | Not named | No required retention setting proven | N/A | N/A | BLOCKED | Obtain approved staging, production, security/audit, alert-history, and rehearsal-evidence values; configure only after approval; capture duration, clock basis, deletion behavior, and post-expiry alert-history behavior. |
| Dashboards/panels available | Six panels in `dashboard.json` | Validator and tests PASS | Vercel metrics schema exposed 99 generic metrics; project metadata showed Speed Insights `hasData: false` and no provider dashboard containing the six catalog panels. Metrics query attempted read-only but returned `invalid_request`; no custom panel evidence exists | Not named | Not recorded | No dashboard link | None | BLOCKED | Import/recreate all six panels with the catalog queries and capture provider dashboard ID/URL and a view showing required dimensions. Approval required if provider setup mutates state. |
| Alert rules installed/enabled | Five alert IDs in `alerts.json` with exact windows, thresholds, dimensions, policies, and runbooks | Validator and tests PASS | No provider rule IDs, enabled-state evidence, or provider configuration returned by inspected project/team surfaces | Placeholder values in catalog: `operator-to-fill-primary-on-call` / `operator-to-fill-security-owner` | Not recorded | No alert destination proven | None | BLOCKED | Install/recreate the five rules exactly, capture provider rule IDs/settings, and link each to the approved notification policy and runbook. Approval required. |
| Alert delivery destination | Alert notification policies in local catalog | Contract only | No destination, integration, or notification delivery record found | Not named | Not recorded | None | None | BLOCKED | Configure approved primary and secondary/security destinations; capture delivery target metadata and one timestamped staging notification. Approval required. |
| Acknowledgement/escalation path | `page-primary-then-secondary` and `notify-security-owner-and-primary-on-call` policies; staging proof runbook | Safe stimulus script/tests PASS | No provider acknowledgement, incident, escalation, or notification record found | Not named | Not recorded | None | No mechanism proven | BLOCKED | Name primary and secondary/security owners, configure timers, run the staging proof, and record delivered/acknowledged timestamps plus secondary-path result. Approval required. |
| Named operational owner / ownership source | Catalog owner placeholders and runbook input requirements | No explicit operational owner source | No CODEOWNERS/on-call ownership source or provider ownership metadata proving launch ownership. Repository references to implementation agents are not operational ownership | Not proven | N/A | N/A | N/A | BLOCKED | Record an explicit primary owner/team, secondary/security owner, reachable destinations, escalation schedule, and source of authority. |
| Backup-status source and owner | Required by observability runbook/provider setup | Recovery runbooks identify the evidence category but not a current operational owner/source bundle | No provider dashboard/API/runbook link with named owner was found | Not proven | N/A | N/A | N/A | BLOCKED | Attach the exact backup-status source and named owner to the provider evidence bundle. |

## 10. Items closed during this run

- Re-ran the catalog validator with the necessary local IPC permission: **5
  alerts and 6 panels valid**.
- Ran focused observability tests: **20 tests passed**.
- Confirmed the linked staging project metadata and latest promoted deployment:
  `dpl_Abn9t6t8ASMAiYsbpc8J9UtUdkLh`, READY/PROMOTED, deployed commit
  `0db85f6192f7c96fd92282389cc970b35bae2e33`.
- Confirmed generic Vercel runtime request records exist for that deployment,
  but classified them correctly as partial runtime-viewer evidence rather than
  structured sink/delivery proof.
- Confirmed no team- or project-scoped Vercel log drain and no marketplace
  integration were discoverable through read-only inspection.
- Confirmed no provider mutation, staging alert stimulus, temporary alert
  override, deployment, cleanup, or production action was performed.

## 11. Exact remaining actions and minimal mutations

| Provider/project | Exact proposed change | Reason | Evidence expected afterward | Risk | Rollback | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| Vercel team `team_VMthg2WoTS6eeOP5BjRh3i8b`, project `prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4` | Create one approved JSON/NDJSON log drain with explicit staging/production separation | Establish sink existence and delivery path | Drain ID, destination/provider metadata, signed test timestamp, provider event ID, searchable structured event | Data exposure or misrouting if destination/signing scope is wrong | Disable/remove the exact drain after preserving evidence; verify no other drain changes | Explicit operator approval required |
| Same staging project | Import/recreate five alerts and six dashboard panels from checked-in JSON | Establish exact provider rules and dashboard | Rule IDs/settings, dashboard ID/URL, rendered dimensions, runbook links | Alert noise or weakened semantics if translated incorrectly | Disable/remove only the created objects; restore prior captured state | Explicit operator approval required |
| Same staging project/provider | Configure approved retention values and deletion behavior | Meet retention launch gate | Settings showing duration, timezone/clock basis, deletion behavior, and alert-history survival | Premature deletion or over-retention cost/compliance exposure | Restore prior captured policy; do not configure until approvals exist | Accounting/legal/operator approval required |
| Same staging project/provider | Configure primary/secondary/security destinations and acknowledgement/escalation schedule | Prove alert delivery and ownership | Redacted notification record, delivered/acknowledged timestamps, secondary-path result | Paging real people or unintended escalation | Disable only newly created route/policy after evidence capture | Named-owner and operator approval required |
| Same staging project | Run `docs/runbooks/observability-staging-alert-proof.md` with the existing safe read-only stimulus | Prove end-to-end staging delivery without business writes | Request ID, sink event, alert delivery, acknowledgement, cleanup confirmation | Temporary staging alert override and notification side effects | Restore original staging rule and disable/delete temporary override immediately | Explicit operator approval required |

These mutations were prepared but **not executed**.

## 12. Evidence report path

`/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/observability-closeout-20261003T132655Z.md`

SHA-256 sidecar:

`/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/observability-closeout-20261003T132655Z.md.sha256`

Source evidence hashes:

| Evidence | SHA-256 |
| --- | --- |
| `config/observability/alerts.json` | `f8e77b9299ada37aa655364bbd835dc08e1ac783091c6683fd8d295a7a70d74c` |
| `config/observability/dashboard.json` | `b04946216503fed9a6d2be13d1ceb4f631a977a9f065e252d781646f415662f5` |
| `src/platform/observability/catalog.ts` | `3aeb67fb5562713895ea055592ab556d6236935e7f40c0f44604fa39c9b391f7` |
| `docs/runbooks/observability.md` | `dd6d5911305e1927aab17df58b7f6d7e5ae6239f1011339f1a4b2558f26b41ac` |
| `docs/runbooks/observability-provider-setup.md` | `da0d6d6edd546915bcafbca735c8c586699782b88e4d4af1fd578c9599e4f8e5` |
| `docs/runbooks/observability-staging-alert-proof.md` | `e74d5f7b7a84177c40b5b1583e19d6a8ba5fe2ddfb44a97781a141732abe4884` |
| Existing closeout prep `launch-closeout-prep-20261003T124542Z.md` | `93f1ff7d39fdb2b8099e374cdb065098e0c54a0a19a1d0b1d3cdb3ee775df738` |

Provider evidence identifiers:

- Project: `prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4`
- Latest promoted deployment: `dpl_Abn9t6t8ASMAiYsbpc8J9UtUdkLh`
- Deployment commit: `0db85f6192f7c96fd92282389cc970b35bae2e33`
- Runtime request records: `t2bmv-1791032266910-71a76c13e628`,
  `pp28d-1791032266910-93412bb1e80`,
  `wcdwb-1791032265968-7749fa2856f9`,
  `pp28d-1791032265178-f58133f6cc1d`,
  `4tp4j-1791032265178-acaf3a6bfd36`,
  `t2bmv-1791032265177-38b11ea0bad0`
- Runtime record timestamps: 2026-10-03T12:57:45Z–12:57:46Z
- Team/project log-drain observations: `[]` at the read-only inspection time

## 13. Safety confirmations

- Recovery untouched: **CONFIRMED**. No recovery script/resource/evidence was
  modified, no recovery run was executed, no Neon branch was created/deleted,
  and no recovery Vercel project was accessed.
- Canonical staging configuration unchanged: **CONFIRMED**. Vercel access was
  read-only; no deployment, alias, secret, database, route, or monitoring
  configuration was changed.
- Staging cleanup not executed: **CONFIRMED**. Bootstrap files and environment
  names were not removed.
- Production untouched: **CONFIRMED**. No production project, deployment,
  configuration, smoke test, database, secret, or rollout action was performed.

