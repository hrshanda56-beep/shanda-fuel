# Controlled rollout and pilot handover checklist

Status: **preparation only — release BLOCKED**. No migration/deployment approval
is granted. Use with the [integration map](../reports/FINAL_INTEGRATION_PREPARATION_2026-10-16.md).
All unchecked gates require evidence on the final approved SHA. Evidence inherited
from another agent is attributed, not live verification by this task.

## Parallel preparation lanes

The following may proceed independently without changing the application candidate:
security decision/evidence review, migration-owner planning, provider read-only
Preview/recovery/source evidence, and station information/training preparation.
Each needs its own existing authorization; this checklist grants no provider access.
Final browser/security testing follows code integration; cloud migration follows
explicit approval and isolated rehearsal; deployment follows preflight/migration;
acceptance follows exact deployed identity and smoke. Any code change after a gate
requires relevant revalidation and exact-SHA evidence reconciliation.

| Gate                              | Owner / required evidence                                                                                                                                                                                                                                                    | Present disposition                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Clean MFA security proof       | Security/release owner: fresh real provider positive MFA and negative wrong password/code, no/cancelled/expired/wrong-action/wrong-tenant assurance, revoked session and direct forged-client rejection; distinct submitter/approver, no financial side effects after denial | BLOCKED: changing security lane; no accepted exact-SHA positive/negative proof established here                                     |
| 2. Complete browser matrix        | E2E owner: final SHA, runner/config, fresh synthetic PostgreSQL18/UTC, fixture/runtime separation, counts pass/fail/flaky/skip/not-run, traces and explicit skip disposition; no hidden failures/retry-based PASS                                                            | BLOCKED: baec0c9 report is 363/1/4, not acceptance; f3f7de4 needs its own passing combined result                                   |
| 3. Reviewed immutable application | Release owner: full SHA, clean tree, independent security/code review, CI results, exclusions and compatibility evidence                                                                                                                                                     | BLOCKED: no accepted freeze; optional rehearsal is not a release candidate                                                          |
| 4. BYPASSRLS decision             | Security owner: signed decision for migration_owner, diagnostics_readonly and job_runtime, actual connection/grant inventory and negative app_runtime proof; retain app_runtime NOBYPASSRLS                                                                                  | BLOCKED: ff76bdd records discrepancy and decision required, not approved exception                                                  |
| 5. Isolated 0030 rehearsal        | Migration owner: explicit authorization, isolated branch identity/source/retention, approved executor/SQL+journal procedure, pre/post hashes/catalog/runtime/immutability proof                                                                                              | BLOCKED: preparation only; no provider migration authorized or executed here                                                        |
| 6. Preview isolation              | Vercel/DB owners: correct project, Preview-only synthetic database/auth/storage/email scopes, no production/staging credential/data reachability, network/runtime evidence and safe auth/read tests                                                                          | BLOCKED: no verified current provider binding. Never deploy a Preview to discover its database. Push/deploy needs separate approval |
| 7. Source and rollback target     | Vercel owner: approved SHA mapped to immutable production deployment ID/READY and canonical alias; compatible last healthy immutable target, operator entitlement and documented executable control                                                                          | BLOCKED: no verified current target/control evidence; READY preview alone is insufficient                                           |
| 8. Neon recovery                  | DB/recovery owner: current recovery branch/checkpoint ID/time, retention window/expiry, verified restore evidence, authorized named operator and RPO/RTO disposition                                                                                                         | BLOCKED: no current recovery-point/operator evidence supplied to this task                                                          |
| 9. Authorized release sequence    | Owner plus release/DB operators: exact SHA/0030 hash, explicit production migration and deploy approval, quiet window, no-loss/in-flight policy, abort plan and communications                                                                                               | BLOCKED: current task forbids live execution                                                                                        |
| 10. Post-deploy smoke             | Authorized real users: canonical alias/SHA, health/readiness, fresh login/MFA/context/protected reads/logout/relogin and affected read flows; separate synthetic command/MFA proof                                                                                           | PREPARED procedure; execution depends on 1–9                                                                                        |
| 11. First-station acceptance      | Owner/Finance/Supervisor/access lead: actual pilot choice, physical/config/opening evidence, distinct authorized reviewer, training, escalation and signed restricted acceptance                                                                                             | PREPARED templates only; real facts/approval outstanding                                                                            |

## Freeze and no-loss release preflight (sequential)

- [ ] Freeze final reviewed commit; record `git rev-parse HEAD`, clean tree, PR/CI
      IDs and source SHA. Confirm required baseline ancestry and patch-equivalent
      optional changes. Assert deferred fdbc20b and unrelated Phase 2 UI absent
      by ancestry AND actual diff; different cherry-pick SHA does not evade exclusion.
- [ ] Revalidate only the affected domains after integration, then complete final
      required browser/security/CI gates once on that frozen candidate. Preserve
      meaningful assertions and intentional skips; do not rerun completed broad
      audits unless code, failures or prerequisites changed.
- [ ] Record active in-flight meter, reconciliation, approval, payment and retry
      work. Define authorized quiescence/drain and operator handover so uncertain
      commits/idempotency keys survive. Do not clear client retry storage or
      recreate commands to force completion. No destructive smoke or seed data.
- [ ] Establish backup/PITR/checkpoint, rollback target/schema compatibility,
      forward-fix plan, operators and incident contacts before opening the window.
      No-loss is a requirement to verify, not an achievable guarantee from READY.

## Database ordering and authority (sequential)

The newer 9c87aa8 evidence reports production 0000–0029 exactly once and matching
0025–0029 hashes; 0030 pending. That supersedes older documented 0025 deferral
for planning, but this task did not reread production. Migration owner must
reconfirm the target's actual journal and SQL hashes at the approved window.
Do not apply 0025 again, insert fake journal rows, infer state from file count,
or run the general migration runner against unknown pending state.

Candidate 0030 SQL hash:
`f227d4ce49d153a8fc8379cef7d9c37bfd91aab264a8d6526c0cb893f8099b7c`.
It changes membership SELECT visibility and identifier-column UPDATE grants for
row locks; retain immutable guards, tenant scope and RLS/FORCE RLS.

- [ ] Resolve security role discrepancy first; never change role attributes/ACLs
      as diagnostics or use provider-managed superuser shortcuts.
- [ ] Obtain separate approval for isolated provider rehearsal and identify an
      isolated target proven through 0029. Do not assume a documented branch is
      still present, safe or retained. No production/staging credential copying.
- [ ] Migration owner approves the exact executor, migration_owner ownership,
      locking/drain behavior, all pre/post catalog checks and canonical journal
      registration of only 0030 once. A raw SQL file execution alone may not add
      Drizzle metadata; executor/journal semantics require review before execution.
- [ ] Rehearse exact approved SQL and journal operation on isolated target. Prove
      schema/policies/identifier-only grants, immutable no-op/economic-write denial,
      tenant/station restrictions and authorized workflow under app_runtime.
- [ ] After successful rehearsal and explicit production approval, migration owner
      reconfirms live state/backup and applies approved 0030 **before** new application
      traffic that relies on it. Deployment never automatically applies migrations.
- [ ] Verify one intended journal row/hash and actual objects/ACLs/owners/RLS;
      confirm old application compatibility during the interval. Stop on drift,
      unreviewed pending migration, failed catalog proof or business uncertainty.

The decision record is available at ff76bdd:
`docs/decisions/RELEASE_SECURITY_AND_0030_DECISION_RECORD_2026-10-16.md`.
It is not on this rehearsal branch and is not an execution authorization.

## Deployment, recovery and acceptance (sequential)

- [ ] Separately authorized Vercel operator deploys approved immutable source;
      verify full Git SHA, production target/READY and bidirectional alias binding
      for <https://fuel.shandahr.com>. Owner handoff never uses a Preview URL.
- [ ] Approved user completes fresh configured login/MFA, correct tenant/station
      selection, protected reads and logout/relogin. Never share sessions, TOTP,
      backup codes or secrets; metadata-only evidence in restricted release record.
- [ ] Verify `/api/health` and `/api/readiness`, auth/context denials and read-only
      Daily Operations/reconciliation/reports/payment evidence. Cross-tenant and
      forbidden-write attacks belong in authorized synthetic tests, not enumeration
      of real customers/stations. Use actual authorized station scope only.
- [ ] Reconciliation submit/review/MFA approval, lost response, retry and exact
      postings are proven synthetically on the exact build before launch. In
      production inspect existing evidence; a real business command requires its
      own approved operational purpose and authorization. Do not post test sales
      or perform destructive denials to satisfy smoke.
- [ ] Use [read-only smoke](production-readonly-smoke.md) with reviewed hidden-input/
      secure-process credentials and [30-minute watch](post-release-monitoring.md).
      Record error/latency/audit/dependency signals and manual watcher if automatic
      alerts remain unverified; no secret values or raw customer payloads in logs.
- [ ] Total outage, suspected isolation breach or authoritative corruption: stop
      operator use/escalate P0 immediately. Critical workflow/security proof failure:
      stop release/P1 or higher. Do not mask with flags, broad GRANTs or MFA changes.
- [ ] App-only regression: incident/release/DB owners approve compatible last healthy
      immutable target before traffic rollback. Capability is NOT VERIFIED until
      operator access, eligible target and control-plane procedure are evidenced.
      App rollback does not undo 0030 or any migration. Verify unchanged journal,
      schema/ACL/auth compatibility and affected smoke after rollback.
- [ ] Incompatible schema/data or unresolved partial effects: database incident
      path, separately reviewed forward migration/compensation or isolated recovery
      branch under recovery owner approval. Never invent a down migration, rewrite
      journal/history, restore over production or edit financial records directly.
      The 0030 compensation proposal needs a separate review and returns original
      fail-closed limitations; it is not a rollback command in this checklist.
- [ ] Owner/Finance/Supervisor accept exact deployed SHA, real station setup/opening
      evidence, totals, distinct approver, training and incident handover using
      [pilot acceptance](../onboarding/pilot/acceptance.md). Bindura remains proposed
      until Owner selects it; setup badge alone is not financial cutover proof.
- [ ] Record deployment ID/full SHA, migration hash/state, UTC observation times,
      station timezone, all check results and skips, security exceptions, backup
      reference, incidents and named sign-offs. No GO with unresolved P0/P1 or a
      required gate falsely labelled PASS. Keep first-shift follow-up assigned.

Use existing [deployment/rollback](deployment-rollback-checklist.md),
[incident playbook](production-incident-playbook.md) and
[backup/restore](backup-restore.md) for detail. No live operation was performed.
