# Application performance — 2026-10-16

Status: **PERFORMANCE IMPROVED locally**. No production performance improvement
is claimed. No production/staging service or infrastructure was contacted.

## Identity and integration boundary

Accepted production baseline: `99bbe34cd9e978288f4ffb55fcad9f144e127922`.
Implementation base: operational candidate
`871dcd45c11893149947e7ee3e412505dcc1534b`.
Branch: `codex/application-performance`.
Worktree: `/Users/wolftech/.codex/worktrees/application-performance/shanda-fuel`.
This report and the implementation are committed together; obtain the exact
handoff SHA with `git log -1` on that branch (avoids a self-referential SHA).

Reviewed prior fixes: PR #127 (`76b735a`) already forwards verified dashboard
context and avoids a second shell resolution; PR #128 (`9bf5d42`) already reuses
operations authority/transaction and an authenticated actor. Neither is recreated.
Read-only inspection of active release and Phase 2 work showed report queries,
report UI, page context and tenant authority overlap those lanes. Those files
remain unchanged. No other agent worktree was edited. Canonical status remains
with the release owner; this bounded report adds no new product semantics.

## Confirmed redundant work and change

Shell navigation previously resolved the authenticated actor and selected tenant
membership again after context discovery had just validated both. It now uses
`resolveCurrentContextWithAuthority`, which returns the selected authority beside
the context resolution to server-only consumers. The authority Map lives only
inside that discovery call. There is no persistent/request-keyed/global cache.
Public `resolveCurrentContext` returns its original shape and strips authority;
no authority or session is passed to the client shell or context API.

Navigation checks tenant agreement and applies the existing scope permission
projection. A subsequent call reloads authentication and membership. Explicit
RLS transactions, scope checks, no-store routes, financial calculations, schema,
MFA and privileged step-up are unchanged. The optimization removes one extra
session lookup and one membership transaction (five execute calls plus transaction
boundaries) per successful selected-context navigation projection. This is a
source-path count, not a provider network-packet count.

## Reproducible local measurement

Dedicated loopback-only PostgreSQL 18.6, UTC, port 55489; canonical bootstrap and
all 31 candidate migrations under the existing ownership procedure. Application
connection is `app_runtime`, separate fixture-owner connection, synthetic actors,
real signed Better Auth sessions, one active tenant/legal entity/station per actor,
no financial fixtures for this navigation benchmark. Node 26.10.0; existing locked
dependencies were reused then cloned to task-owned storage. No package changes.

The optional benchmark in
`tests/integration/context-authority-reuse.test.ts` reproduces the original
context-then-authority navigation algorithm using the same production resolvers
and projection. The optimized path calls `getServerShellAccess`. It warms both
paths five times, then alternates execution order for 40 samples each with the
same actor/data/scope. Every sample requires ready status; a separate assertion
compares complete before/after projection and context equality. No injected
network delay, auth stub, disabled RLS or timing assertion is used.

| Local server-function measurement | Before    | After     | Reduction |
| --------------------------------- | --------- | --------- | --------- |
| p50                               | 28.566 ms | 18.135 ms | 36.5%     |
| p95                               | 59.149 ms | 38.285 ms | 35.3%     |

Raw synthetic timing samples: [benchmark JSON](context-authority-benchmark-2026-10-16.json).
This measures context/navigation server functions, not browser render, HTTP/TLS,
cold starts or end-to-end dashboard latency. The reference path uses the refactored
public context resolver, so both incur its small temporary Map overhead; it is
not a separate checkout/binary benchmark. Concurrent local validation can add
noise. Do not extrapolate the saved milliseconds to production multi-second times.

To reproduce, prepare a fresh dedicated local PostgreSQL 18 database using
`scripts/db/bootstrap-test.sh` and canonical migrations, retaining migration_owner
ownership. Give the disposable local app_runtime LOGIN and use it for DATABASE_URL;
keep DATABASE_FIXTURE_URL on the separate synthetic fixture owner. Supply synthetic
APP_ENV=test, AUTH_PROVIDER=BETTER_AUTH, APP_URL=http://127.0.0.1:3198 and signing/auth
configuration through the process environment. Never substitute live credentials.
Run:

```sh
PERF_BENCHMARK=true pnpm test:integration tests/integration/context-authority-reuse.test.ts --reporter=verbose --disableConsoleIntercept
```

The test also supports ordinary CI's disposable owner DATABASE_URL when no
separate fixture URL is supplied; the recorded isolation evidence above used the
restricted runtime connection. Benchmark timing collection is optional and is not
a CI timing threshold. Fixture data stays in the disposable database.

## Other latency findings — bounded inspection, not confirmed causes

| Path                | Existing work / remaining investigation                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard           | Candidate loads daily report, operations overview, customer summary and management chart as separate no-store requests. Shell lookup improved here; customer summary and full management payload remain separate costs. No endpoint/render production timing was collected.                                                                                                          |
| Operations overview | PR #128 already consolidates authority/transaction. Candidate adds operational controls; do not duplicate its optimization or alter locks without measured evidence. Existing A11 tests passed.                                                                                                                                                                                      |
| Management reports  | `queries.ts` authorizes stations in one tenant transaction then builds the full multi-domain report in another. Promise.all on one PostgreSQL transaction does not establish independent parallel database execution. Chart consumers read sales from a broader report; measure per-query time/payload before considering a narrower reviewed read contract. Phase 2 owns this file. |
| Daily reports       | Existing `readDaily` performs aggregate and payments reads after fresh authority/station checks. No missing index or lock bottleneck was demonstrated. Preserve source-specific dates and exact decimals.                                                                                                                                                                            |
| Station context     | Discovery still loads active tenant IDs and each tenant's authority/tree sequentially. This change reuses the selected result for navigation only. Multi-tenant scaling remains unmeasured; no unbounded concurrency or shared cache added.                                                                                                                                          |
| Authentication      | Navigation's second authentication lookup is removed. `AuthorizedAppShell` still separately reads Better Auth user name for display; it and other API authentication remain independent. No auth adapter or session cache change.                                                                                                                                                    |

Historical engineering evidence recorded Vercel runtime region iad1 while the
canonical database documentation records Neon Frankfurt. Those facts were not
reverified here. Cross-region network travel, connection establishment, cold
starts and database/provider time may dominate remaining latency. Frankfurt
function placement, region alignment and pooling/connection changes require a
separate owner-approved measurement and infrastructure decision. No configuration
change, new service, paid resource, index or migration is proposed as proven.

## Validation and handoff

- Full unit suite: **872 passed**, 114 files, two workers.
- Focused context/navigation unit run: **9 passed** (included in full unit suite).
- New real-runtime context/isolation/benchmark integration: **5 passed**.
- Existing A1 isolation, A10 management-reporting and A11 daily-operations suites:
  **31 passed**, zero failed/skipped, fresh separate PostgreSQL 18 database.
  These retain report totals and authorization assertions.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`: **PASS** with local synthetic build
  configuration. No direct migration credential in the build runtime.
- Changed-source Prettier, explicit new-report formatting and `git diff --check`:
  checked before commit. Repository format rules ignore docs by default.
- Independent reviewer inspected actual diff, tenant/freshness boundaries and
  benchmark fairness: **GREEN**, no actionable findings.
- Browser/E2E and hosted CI: **NOT RUN** for this isolated server-only change;
  release owner must run combined gates on the final integrated SHA. No fixture
  or production-mode test substitution was made.

Integration owner should review/cherry-pick this single focused commit onto the
chosen candidate, checking context/server and navigation ownership first. Rerun
context/navigation unit tests, restricted-runtime context integration, existing
isolation/report/operations suites and final combined quality/browser gates.
Changes are compatible with the supplied candidate and do not depend on Phase 2.
Do not cherry-pick Phase 2 report or tenancy files to obtain this optimization.
New shared-context API changes must preserve the server-only authority boundary.
Deployment authorization and monitoring remain separate gates. Obtain approved
same-SHA production observations before claiming a user-facing latency gain.

Production/staging contact: **NO**. Push/merge/deploy: **NO**. Migrations, pooling,
regions, credentials, schema, financial logic and auth policy changed: **NO**.
Safe for review/integration; production improvement remains unverified.
