# Shanda Fuel launch closeout preparation

**Prepared at:** 2026-10-03T12:45:42Z  
**Repository:** `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel`  
**Requested main target:** `0db85f6192f7c96fd92282389cc970b35bae2e33`  
**Observed `origin/main`:** `0db85f6192f7c96fd92282389cc970b35bae2e33`  
**Observed checkout:** `ops/staging-auth-bootstrap-one-shot-20260930`, `05f3b355e2440a3d83977f844709a99d0ad8c625`

## Executive status

1. **RATE LIMIT: BLOCKED** — the application-level request-21 `429` is not
   proven; the request was intercepted upstream before the application.
2. **OBSERVABILITY: BLOCKED** — local definitions are present, but provider
   sink, dashboard, retention, delivery, acknowledgement, and owner evidence
   is absent.
3. **STAGING CLEANUP: PREPARED** — temporary files and environment names are
   identified, cleanup is fail-closed and not executed.
4. **EVIDENCE LEDGER: COMPLETE** — all 16 JSON artifacts currently present in
   `recovery-evidence/` are catalogued below; unresolved or failed evidence is
   explicitly classified rather than omitted.
5. **PRODUCTION GATES: PREPARED** — the checklist is complete, but open gates
   prevent a go decision.

No production, canonical staging, recovery provider, database, deployment,
secret, rollout, smoke, rate-limit reproduction, or recovery rehearsal action
was performed by this preparation pass.

## Lane A — rate-limit provider-support packet

### Local contract and expected behavior

- Route: `GET /api/security/rate-limit-proof`.
- Canonical staging origin: `https://shanda-fuel-staging.vercel.app`.
- Canonical Vercel project: `prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4`.
- Local route implementation: `src/app/api/security/rate-limit-proof/route.ts`.
- Harness: `src/platform/staging/rate-limit-proof.ts` and
  `scripts/staging-rate-limit-proof.ts`.
- The route is available only when `APP_ENV=staging` and the canonical project
  is selected. It is authenticated, non-mutating, and has no tenant or
  business-data input.
- Migration/decision basis: `0020_security_runtime_least_privilege_rate_limit`
  and `docs/decisions/ADR-016-security-production-gates.md`.
- Fixed policy: 20 requests per 60 seconds for the dedicated proof bucket.
- Passing sequence: requests 1–20 return HTTP 204; request 21 returns HTTP 429
  with `x-ratelimit-limit: 20`, `x-ratelimit-remaining: 0`, and a positive
  integer `retry-after` no greater than 60 seconds. The limiter must run before
  authentication on the denied request.

### Observed behavior

The supplied closeout brief records that requests 1–20 returned HTTP 204 and
request 21 was intercepted upstream before the application. The automation
bypass did not produce application-level HTTP 429 proof. This means the
observed upstream response cannot establish that the PostgreSQL-backed
application limiter ran or returned its required headers.

No exact rate-limit attempt timestamp, deployment ID, or request-ID list was
found in the repository or local `recovery-evidence/` inventory. The harness
generates request IDs, but no successful evidence record from the blocked run
is present locally.

### Provider-support request

Please correlate the already-recorded attempt, without starting a new
21-request reproduction, and provide:

1. UTC timestamps, deployment/region, and edge event/request IDs for the
   existing request window;
2. the Vercel rule or protection layer that handled request 21, including its
   action and rule ID (firewall, bot/attack protection, deployment protection,
   or other upstream layer);
3. confirmation whether request 21 reached the Next.js function/runtime;
4. the edge decision and response headers/body classification for requests
   1–21, with secrets, cookies, and payloads redacted; and
5. a provider-side explanation or approved diagnostic setting that permits a
   single controlled staging proof window to reach the application limiter,
   without changing production or canonical staging during this task.

The smallest next diagnostic is provider log/support correlation for the
existing attempt using its timestamps/request IDs if available. If the
provider cannot recover those identifiers, the missing evidence should be
recorded as unavailable; do not blindly rerun the 21-request test.

**Rate-limit conclusion:** BLOCKED pending provider evidence that request 21
reached the application and returned the application limiter's 429 metadata.

## Lane B — observability closure matrix

The checked-in catalog contains five alerts:
`readiness_failure`, `http_5xx_rate`, `auth_security_failures`,
`critical_operational_failure`, and `provider_adapter_failure`.
It contains six panels: `readiness`, `availability`, `latency`, `security`,
`operational-failures`, and `providers`.

| Requirement | Local proof | Provider proof | Status | Exact next action |
| --- | --- | --- | --- | --- |
| Approved sink/drain exists and accepts a signed test | `src/platform/observability/`; `docs/runbooks/observability-provider-setup.md` | None found | BLOCKED | Select the approved sink, create the staging/production-separated drain, run the provider drain-test, and record its UTC timestamp and event ID. |
| Real staging runtime event is searchable by request ID | Shared wrapper and redaction tests; `x-request-id` contract in `docs/runbooks/observability.md` | None found | BLOCKED | Generate the documented staging-only alert stimulus later, search the emitted request ID, and attach the provider event/result without raw payloads. |
| Five catalog alerts are installed, enabled, and exact | `config/observability/alerts.json`; catalog tests; known local result: 5 alerts PASS | No provider rule evidence | BLOCKED | Import/recreate the five IDs, verify severity/window/threshold/runbook links, and capture the provider rule views. |
| Six dashboard panels render required dimensions | `config/observability/dashboard.json`; catalog tests; known local result: 6 panels PASS | No provider dashboard evidence | BLOCKED | Import/recreate the six panels and capture a dashboard view showing environment, route/routeClass, status/statusClass, duration, and error dimensions. |
| Alert delivery, acknowledgement, and escalation work | `docs/runbooks/observability-staging-alert-proof.md` defines safe staging stimulus | No delivery, acknowledgement, or escalation evidence | BLOCKED | Name primary and secondary/security owners, run one staging alert proof, record delivery and acknowledgement IDs/times, and record controlled escalation behavior. |
| Retention and deletion behavior are approved and configured | Retention requirements documented in `docs/runbooks/observability.md` | No approved values or provider setting | BLOCKED | Obtain owner/accounting approval for staging, production, security/audit, alert history, and rehearsal evidence; configure only after approval and capture duration, clock basis, and deletion behavior. |
| Backup-status source and owner are linked | Recovery runbooks identify the required evidence category | No provider source/owner evidence | BLOCKED | Record the exact backup-status dashboard/API/runbook link and named owner in the provider evidence bundle. |

The local validator was attempted with `pnpm exec tsx
scripts/validate-observability.ts`. It failed before the script ran because the
sandbox denied the `tsx` IPC pipe (`listen EPERM` under the task temp
directory). This is an execution-environment limitation, not a catalog failure;
the repository's known local result remains 5 alerts and 6 panels PASS, and the
catalog tests/definitions were inspected. No provider object was created or
changed.

**Observability conclusion:** BLOCKED pending provider-side sink, searchable
event, rule, dashboard, retention, delivery/acknowledgement, and ownership
evidence.

## Lane C — staging cleanup preparation

### Current state

The checkout is dirty. The temporary bootstrap items identified are:

- untracked `src/app/api/internal/staging-auth-smoke-bootstrap/route.ts`;
- untracked `src/app/api/internal/staging-auth-smoke-bootstrap/route.test.ts`;
- tracked modifications in `src/platform/staging/auth-smoke-bootstrap.ts`;
- tracked modifications in `src/platform/staging/auth-smoke-bootstrap.test.ts`;
- temporary environment names referenced by the route:
  `STAGING_AUTH_BOOTSTRAP_TOKEN` and
  `STAGING_AUTH_BOOTSTRAP_DATABASE_URL`.

The current tracked diff is guarded by SHA-256
`e881cf169633bc852e3811877310e42859991082fe0f8ba1c8208207129d3a15` when
calculated over the combined diff of the two tracked files. The untracked
route hashes are:

- `route.ts`: `7200289c1a5da1b37a78e5927be2c7ea61971cb35d98c4af404fb5599da7a12e`;
- `route.test.ts`: `6847ab6e768b890183ac907d3059ea995dd55ada4f55e0c39efc9511ca6831a0`.

The exact temporary route and temporary environment names are absent from
`origin/main` at `0db85f6192f7c96fd92282389cc970b35bae2e33`. The canonical
staging project metadata inspected locally is `.vercel/project.json`:
project `prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4`, team `team_VMthg2WoTS6eeOP5BjRh3i8b`,
name `shanda-fuel-staging`. No Vercel API/CLI call was made.

### Fail-closed cleanup procedure for a later approved operator

Do not run this procedure during the current recovery lane. It is intentionally
written as a later operator procedure and requires an explicit approval record.

1. Require `APP_ENV=staging`, the exact canonical project ID above, the exact
   canonical staging origin, an approved Vercel token supplied by the secret
   manager, and an explicit cleanup change/approval ID. Refuse empty, production,
   non-canonical, or unknown project/origin values.
2. Snapshot and hash `recovery-evidence/`; refuse to continue if it is absent.
   Never include it in cleanup globs and verify its hashes are unchanged after
   cleanup/deployment.
3. Require the two tracked-file diff hash and both untracked route hashes above
   to match exactly. If any target has changed, stop for review; do not use
   `git clean`, broad globs, `git reset`, or a broad restore.
4. In the canonical staging Vercel project only, remove exactly
   `STAGING_AUTH_BOOTSTRAP_TOKEN` and
   `STAGING_AUTH_BOOTSTRAP_DATABASE_URL` from the staging environment. Record
   the provider confirmation without recording values.
5. Restore only the two guarded tracked files to the clean checked-out
   `origin/main` state and remove only the two hash-verified untracked route
   files. Preserve `recovery-evidence/` and unrelated user work.
6. Create a separate clean detached worktree at
   `0db85f6192f7c96fd92282389cc970b35bae2e33`; assert clean status and deploy
   only that worktree to the known staging project. Alias only the canonical
   staging hostname after the deployment ID and commit are recorded.
7. Verify the removed route returns HTTP 404 with no body, then verify
   `/api/health` and `/api/readiness` return HTTP 200. Preserve request IDs and
   timestamps; do not invoke auth, command, financial, recovery, or stress
   routes.
8. Recheck that the bootstrap environment names are absent, verify the
   recovery-evidence hashes are unchanged, and write a redacted cleanup result
   to the approved evidence location. Stop immediately on any mismatch.

Static safety review: the procedure has exact project/origin guards, exact file
hash guards, no broad cleanup command, no production target, no database
command, no recovery command, and no rate-limit stress action. It was not
executed.

**Staging cleanup conclusion:** PREPARED; execution remains pending explicit
operator approval and must wait until the active recovery lane is complete.

## Lane D — local evidence ledger

The following is the complete inventory of the 16 JSON artifacts currently
present under `recovery-evidence/`. SHA-256 values were safely computed without
modifying files. The active timed recovery artifact is marked PENDING because
another operator session owns that lane; its raw result is preserved and not
rewritten.

| Artifact | Timestamp | Status/classification | SHA-256 |
| --- | --- | --- | --- |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/staging-checkpoint-20261001T182723Z/checkpoint.json` | 2026-10-01T18:27:23.068Z | checkpoint recorded | `a5a111cadcc8df098d966c722b610408d4ab6cfb63f9df67c8d0c47eb66efe0f` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/neon-recovery-run-2026-10-01T18-37-03-128Z/recovery.json` | 2026-10-01T18:37:03.128Z | `provider-result-unconfirmed` | `dab8bc477171fb05ce209c040eef3eceab9f4545b431d319a858ee95a9bbbcb8` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/neon-recovery-verify-2026-10-01T18-56-04-855Z/verification.json` | 2026-10-01T18:56:04.855Z | classification `A` | `b45c05505981e1c5df1e529e8a76d571879d70340999755a3626ea98f40e77cf` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/neon-recovery-verify-2026-10-01T19-26-10-743Z/verification.json` | 2026-10-01T19:26:10.743Z | `TypeError` recorded | `32d99b7f504d94205da30a398995a3f385a6ebdc20e03e60d88648bb1b0d5ac1` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/neon-recovery-db-verify-2026-10-01T20-40-09-094Z/verification.json` | 2026-10-01T20:40:09.094Z | DB verification recorded; no top-level status | `7622863ab0aa966204019e62c40cfe3881990406fb3feed4a1c5b9eb9116155a` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/neon-recovery-inspection-verify-20261001215337761/verification.json` | 2026-10-01T21:53:37.761Z | verification error recorded | `329d2b04471512802c64c312565a8140658915ea708a5362b1c5e8d312be0a67` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/neon-recovery-owner-verify-2026-10-01T21-54-45-614Z/verification.json` | 2026-10-01T21:54:45.614Z | owner verification recorded | `da4f4abbedadc9378684d3ddb14c98eaee33425cf1587e2b20e3332e1912f807` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/neon-recovery-one-process-20261002152528740/verification.json` | 2026-10-02T15:25:28.740Z | verification error recorded | `3c3f8682cb9ffd3c19a6e0671a95cc866702e79e0927749a864355ee37d313c0` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/recovery-app-dry-run-20261002T155213Z/verification.json` | 2026-10-02T15:52:13.883Z | app dry-run recorded | `708e6bc736f4ff61cd71af53b66432b3614e3ad49b97b887888b6daf751b47c1` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/neon-recovery-staged-20261002153206829/verification.json` | 2026-10-02T15:32:06.829Z | staged recovery verification recorded | `5502279b840ab5af9c2170551437cf80daa856f03575223cc92447eb1a3d7f6a` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/recovery-app-dry-run-20261002T175839Z/verification.json` | 2026-10-02T17:58:39Z | app dry-run recorded | `66ffe4a7dc6ed4b3406a8cfa8a75b8df394e8bc648d30d3cc31f2cae68d96fa5` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/r2-validation-20261002T192626Z/evidence.json` | 2026-10-02T19:26:26Z | R2 validation FAIL; secret retrieval blocked | `90471be1030998db6739b494e2bb654c86c02eb2aa5231797996728f9a2ee83a` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/r2-validation-20261002T193813538Z/evidence.json` | 2026-10-02T19:38:13.533Z–19:38:13.538Z | R2 validation FAIL; provider bucket mismatch | `e995f457133d042546185f4c30edb671d723a7e8ca9dd4e4adb692ee85d4a125` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/r2-validation-20261002T195734255Z/evidence.json` | 2026-10-02T19:57:34.249Z–19:57:34.255Z | R2 validation FAIL; provider bucket mismatch | `445ebefd43b747ba8b7c1bca9e2b8268718081c2b64da0957fe2c726d693ed40` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/r2-validation-20261002T201715607Z/evidence.json` | 2026-10-02T20:16:59.641Z–20:17:15.607Z | R2 validation PASS; checksum and cleanup passed | `694c32c2880f3cc2ac718a50fab85d91e764cf36da30016833f7ce63f86435cc` |
| `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel/recovery-evidence/timed-staging-recovery-20261003T054133Z.json` | 2026-10-03T05:41:33.865Z–05:57:39.509Z | **PENDING** active recovery lane; raw artifact records `RTO_FAIL` because R2 credentials were unavailable | `4cd7f7277d9ac940afa21549b5c40db6cdf298037045d0f4c6aee5bf7920d360` |

### Existing merged/release evidence ledger

- Security P0: PR #45, merge `843c3fa60977d591035157bd740c8a11a564b448`.
- CI security hardening/dependency and runtime-role checks: PR #49, merge
  `12106be`; dependency audit, secret scan, Semgrep, and runtime-role proof
  passed; CodeQL was skipped because GitHub code scanning is unavailable.
- Observability P0: PR #68, merge `d4f6e15`; local implementation and tests
  passed, provider integration remains open.
- Recovery/application/recovery evidence: PRs #38, #39, #40, #41, #73,
  #74, #76, and #78 are present in `origin/main` history; the runbooks and
  artifacts above preserve their claimed scope and exceptions.
- Next.js critical dependency/security update: PR #79, merge `6480d24`.
- Durable rate-limit implementation and staging proof harness: PR #80, merge
  `05f3b355e2440a3d83977f844709a99d0ad8c625`; the provider proof remains
  blocked as described above.
- Product/UI shell verification: PR #71, merge
  `d3721d37f1761c9c112210d0273f087c66930800`; the recorded manual review
  covers responsive screenshots at 390, 820, 1024, 1280, 1440, and 1920 px,
  light/dark themes, loading/error/WIP states, drawer/rail behavior, and axe
  checks. This is the recorded UI PASS evidence; it is not a production gate.
- Current main includes PR #81, merge `0db85f6192f7c96fd92282389cc970b35bae2e33`.

Other recorded local/release evidence:

- 21 canonical SQL migration files are present, through `0020`.
- Tenant hierarchy, authorization, RLS, fail-closed tenant context, and
  deployed Tenant A/B isolation are recorded as passed in the readiness ledger.
- The CI/runtime-role evidence records `app_runtime` use and least-privilege
  checks; migration `0020` restricts direct rate-limit-table access to the
  named capability. This is a measured least-privilege result, not a claim of
  universal least privilege.
- Authenticated staging smoke and tenant isolation/RLS are recorded as
  passed; cross-module staging journeys remain deferred.
- R2 deleted-object recovery is recorded as passed for the exercised staging
  scope, with the retained-copy checksum in `docs/release-readiness.md` and
  the successful local R2 artifact above.
- Historical recovery attempts and classifications are all retained above;
  the current timed recovery result remains PENDING under the active operator.
- Rate-limit, observability, staging cleanup, and production rollout remain
  open gates and are not represented as passes.

## Lane E — production go/no-go preparation

This is a repository/configuration checklist only. No provider or production
action was taken.

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Clean main SHA | Clean checkout at `0db85f6192f7c96fd92282389cc970b35bae2e33`; no temporary route/test changes | PREPARED; current checkout is dirty and not the deployment source |
| Production build/tests | CI quality run for the exact release SHA: format, lint, typecheck, migration check, unit/integration, build, browser/a11y | PREPARED; exact current-SHA CI evidence must be attached |
| Migrations | Canonical ordered migrations through `0020`; forward-only application via restricted direct path | PREPARED; provider application evidence still required |
| Runtime database role | `DATABASE_URL` is pooled and uses `app_runtime`; runtime role is not owner and cannot directly read rate-limit table | PREPARED from repository/runbook/CI evidence; production provider proof required |
| Direct database URL | `DATABASE_DIRECT_URL` is migration/deployment-only and absent from the deployed app | PREPARED; deployment environment inspection required |
| Secrets/config | Separate staging/production secret-manager entries; `APP_ENV`, HTTPS `APP_URL`, Better Auth, audit signing, R2, and email values validated without exposing values | PREPARED; provider evidence required |
| Health/readiness | `/api/health` and `/api/readiness` return expected no-store responses with request IDs | PREPARED; run only in an approved deployment window |
| RLS/least privilege | Tenant authorization, RLS, fail-closed context, runtime-role proof, and migration-0020 capability proof | RECORDED/PREPARED; exact production runtime evidence required |
| Rollback/recovery | Immutable deployment ID/commit/migration record; app-only rollback; incident/backup/R2 references; no down-migration | PREPARED; owner sign-off and current evidence required |
| Rate-limit gate | Application-level 429 proof plus provider edge/WAF owner and traffic-control evidence | BLOCKED |
| Observability gate | Sink, searchable event, five alerts, six panels, retention, delivery/acknowledgement, owners, backup-status source | BLOCKED |
| Staging cleanup gate | Bootstrap env removal, temporary route removal, clean `origin/main` deployment, 404 route proof, health/readiness, preserved evidence | PREPARED; not executed |
| Human approval | Explicit named approval before any production deployment, migration, smoke, secret change, or rollout | REQUIRED; absent by design in this task |

**Production decision:** NO-GO until the blocked gates and all other open
release-readiness items are closed and a named human approver authorizes the
controlled production action.

## Closeable now without provider mutation

- The rate-limit provider-support packet and smallest diagnostic request are
  complete.
- The observability closure matrix and exact provider actions are complete.
- Temporary staging bootstrap scope is identified, hash-guarded, and the
  cleanup procedure is prepared but not run.
- The local evidence ledger is assembled with exact paths, timestamps, statuses,
  and SHA-256 values; historical evidence was not altered.
- The production checklist is prepared and explicitly records the current
  no-go state.

## Safety confirmations

- Recovery lane untouched: **CONFIRMED**. No recovery script was modified or
  executed; no recovery evidence was modified or deleted; no recovery Vercel
  project or Neon recovery branch was touched.
- Canonical staging unchanged: **CONFIRMED**. No staging deployment, alias,
  secret, database, smoke, or route action was executed.
- Production untouched: **CONFIRMED**. No production provider, deployment,
  database, secret, smoke, or rollout action was executed.
