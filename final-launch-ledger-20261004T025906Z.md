# Shanda Fuel final launch ledger and production preflight

Prepared: 2026-10-04T02:59:06Z (UTC)

This ledger records the final staging state and a read-only production
preflight. Production deployment, configuration, database, firewall, smoke,
and rollout mutations were not performed.

## Decision

**PRODUCTION PRE-FLIGHT: READY FOR HUMAN APPROVAL**

This is not production approval. Provider-specific production values and
production migration state marked `VERIFY DURING APPROVED PRODUCTION ROLLOUT`
must be checked by the authorized rollout operator before any production
mutation.

## Main and merged changes

- Exact main SHA: `19735bc3f6eb6aee504c992479c45aacd8c0d476`
- PR #82 bootstrap purge: merged at the exact main SHA.
- PR #83 dependency-security exception machinery: merged before PR #82.
- Final-main source inspection: no executable staging bootstrap route, helper,
  tests, or bootstrap environment-variable references outside historical/docs
  evidence.

## Dependency security

- Advisory: `GHSA-vfj7-8cjw-p6xm` / npm `1240992`.
- Package: `braces@3.0.3`; vulnerable range `<=3.0.3`; no published fix.
- Classification: transitive and dev-only through the `eslint-config-next`
  tooling chain.
- Production-only audit: no high/critical finding involving `braces`.
- The advisory remains technically unremediated.
- Narrow CI/security exception: recorded in
  `docs/security/exceptions/GHSA-vfj7-8cjw-p6xm.md` and the exact-one-entry
  CI allowlist on main.
- Exception scope: pre-production only; it must not authorize production
  deployment without explicit launch-owner approval.
- Review date: 2026-11-03.
- Review trigger: a patched `braces` release or upstream dependency
  remediation, whichever occurs first.

## Validation

- Lint: PASS.
- TypeScript: PASS.
- Vitest: PASS — 471 tests in the combined PR #82 plus exception validation.
- Production build: PASS.
- PR #82 CI: required checks passed; dependency audit passed with only the
  exact scoped exception. CodeQL was skipped because repository code-scanning
  support is unavailable.
- PR #83 CI: required checks passed with the scoped exception machinery.

## Final staging

- Deployment ID: `dpl_QwV8ceoTEcrMoxtuk3e9fX4ewdMs`.
- Deployment URL:
  `https://shanda-fuel-staging-7flyg30tb-shanda-hr-s-projects.vercel.app`.
- Canonical alias: `https://shanda-fuel-staging.vercel.app`.
- Deployed source SHA: `19735bc3f6eb6aee504c992479c45aacd8c0d476`.
- `/api/health`: HTTP 200, application `ok`.
- `/api/readiness`: HTTP 200, database `ok`.
- `/login`: HTTP 200.
- `/api/internal/staging-auth-smoke-bootstrap`: HTTP 404.
- `STAGING_AUTH_BOOTSTRAP_TOKEN`: absent.
- `STAGING_AUTH_BOOTSTRAP_DATABASE_URL`: absent.
- `DATABASE_URL`: pooled `app_runtime` connection; credentials not recorded.
- `DATABASE_DIRECT_URL`: absent.
- Evidence: `staging-cleanup-final-20261004T025016Z.md`.
- Evidence SHA256:
  `08f2c9560cc9f57f995884fb326055b2970f4f5d5e5134681cc9279884a4d699`.

## Recovery

- Status: PASS.
- RTO: 105 seconds.
- RPO: 0 seconds.
- Tenant A: PASS.
- Tenant B isolation: PASS.
- R2: PASS.
- Temporary grants: revoked.
- Recovery evidence remains available under `recovery-evidence/`.
- No recovery resource, script, rehearsal, or evidence was modified.

## Observability

- Technical status: **BLOCKED**.
- Launch disposition: **TEMPORARY EXCEPTION APPROVED**.
- Packet: `observability-closeout-20261003T132655Z.md`.
- Packet SHA256 sidecar:
  `3b77769760a41eba2ba0252561b6306d8ea8a46958c892a377fa5c0502f05798`.
- Remaining gap: no provider sink/drain, alert-rule, dashboard, retention,
  delivery/acknowledgement, escalation, or named-owner evidence.
- Review date: not recorded in the existing approval record.
- Review trigger: provider technical evidence and ownership/delivery closure;
  no production observability mutation is authorized by this ledger.

## Rate limit

- Implementation: PASS.
- Local tests: PASS.
- Staging E2E technical status: **BLOCKED — PROVIDER**.
- Temporary evidence exception: **APPROVED** by explicit operator decision.
- Packet: `rate-limit-launch-exception-20261004T025318Z.md`.
- Updated packet SHA256:
  `bdd3b885df7ce046276a8e8ff2b9365ff4f85d0e148b0a862412bbb72fafecc9`.
- Review date: 2026-10-11, seven days after approval on 2026-10-04.
- Review trigger: Vercel response or exception expiry, whichever comes first.
- Request 21 was not rerun; no provider/firewall mutation was performed.

## Production read-only preflight

1. Final main SHA: verified exact.
2. Production build/test state: green from the merged PR checks and combined
   validation evidence.
3. Migration history: canonical files `0000` through `0020` are present on
   main, including `0020_security_runtime_least_privilege_rate_limit`.
   Actual production-applied migration state: **VERIFY DURING APPROVED
   PRODUCTION ROLLOUT**.
4. Production `DATABASE_URL` requirement: documented as pooled
   `app_runtime`; actual production provider value: **VERIFY DURING APPROVED
   PRODUCTION ROLLOUT**.
5. `DATABASE_DIRECT_URL`: documented as migration-only and prohibited in app
   runtime; actual production deployment metadata: **VERIFY DURING APPROVED
   PRODUCTION ROLLOUT**.
6. Staging bootstrap source/routes/variables: absent from final main and final
   staging deployment.
7. Required production secrets/config: names, validation rules, separation,
   and completeness requirements are documented in
   `docs/runbooks/production-configuration.md` and
   `src/platform/config/env.ts`; actual provider values: **VERIFY DURING
   APPROVED PRODUCTION ROLLOUT**.
8. Rollback path: documented application-only immutable-deployment rollback;
   database incidents use the recovery path, and migration `0020` is
   forward-only.
9. Recovery evidence: available and unchanged.
10. Staging health/readiness: green.
11. Observability exception: formally recorded and approved; technical status
    remains BLOCKED.
12. Rate-limit exception: formally recorded and approved; technical status
    remains BLOCKED — PROVIDER.
13. Dependency exception: recorded, exact, scoped, and reviewable; technically
    unremediated and pre-production only.
14. No remaining engineering blocker requiring resolution before human
    approval was identified. Production provider checks above remain rollout
    gates, not pre-authorized actions.

## Remaining exceptions summary

| Exception | Status | Review | Trigger |
| --- | --- | --- | --- |
| `GHSA-vfj7-8cjw-p6xm` / `braces@3.0.3` | Active, pre-production only | 2026-11-03 | Patched `braces` release or upstream remediation |
| Observability provider evidence | Technical BLOCKED; temporary launch exception approved | Not recorded | Provider sink/rules/retention/delivery/owner evidence |
| Rate-limit staging E2E evidence | Technical BLOCKED — PROVIDER; temporary evidence exception approved | 2026-10-11 | Vercel response or expiry |

## Safety and scope

- Production deployment: not performed.
- Production environment/database/firewall/provider: untouched.
- Staging provider mutation during this preflight: none.
- Recovery provider/resources/evidence: untouched.
- No production smoke test, migration, alias, or rollout was executed.
- No rate-limit burst was executed.
- Historical evidence was not overwritten.

