# Final integration preparation — 2026-10-16

Status: **PARTIALLY PREPARED**. This is a non-release compatibility rehearsal,
not an alternate application candidate or release GO. No live service contacted.
Remote metadata was refreshed with `git fetch origin`; all other agents' checkouts
were read only or untouched. Branch heads below are a point-in-time snapshot;
re-resolve them before integration. No security, MFA, migration SQL, cloud config
or browser remediation was changed or cherry-picked here.

## Verified commit map

| Lane                          | Branch / full observed HEAD                                                                    | Relationship and disposition                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production source             | `origin/main` — `99bbe34cd9e978288f4ffb55fcad9f144e127922`                                     | Refreshed remote; accepted production baseline. Not independently live-deployment verified here.                                                                                    |
| Operational baseline          | `871dcd45c11893149947e7ee3e412505dcc1534b`                                                     | Descends from main; base for this rehearsal. Contains workflow/0030 plus support/training docs, not final security/E2E acceptance.                                                  |
| Release-owner integration     | `codex/workflow-integrated-verification-20261015` — `f3f7de48545a1a28aa364d1d0be445101fbf7dfc` | Contains 871dcd4, 9c87aa8, ff76bdd, 7153622, 377879a, dc674cc and 06f8274. Supersedes supplied 377879a; still active, not accepted. Hold whole security sequence for owner handoff. |
| Independent E2E remediation   | `codex/operational-e2e-remediation` — `baec0c9ebacea1b4d6a1a3872b1678de4f120b92`               | Forks at 871dcd4; does NOT contain 377879a, 7153622 or either evidence commit. Do not mistake its runner results for proof of release-owner security changes.                       |
| Validated onboarding patch    | `codex/station-onboarding` — `2707c83f9bf32daa648c48fcf3687ddee344d38c`                        | Direct child of 871dcd4; read-model current-meter correction, tests and pilot pack. Optional, not yet in either active branch.                                                      |
| Older onboarding docs         | `codex/phase1b-onboarding` — `2a7b6acd53f53385eea79ca844f91df2e97f409f`                        | Different older branch based on main; not the supplied 2707c83 lane. Do not substitute/broad-merge it.                                                                              |
| Optional command tests        | `codex/phase2-completion` — `c17a8f721785a07296d3b3ba5c08ec883a040c36`                         | Direct child of main; only 13 test lines for two named meter-exception dispatches. Does not contain 871dcd4 or historical Phase 2 UI. Pick this single commit only.                 |
| Deferred performance          | `codex/application-performance` — `fdbc20b1d7fafd6e17849071c0b165ae89569245`                   | Direct child of 871dcd4; explicitly excluded, despite no current path overlap. No performance patch in this rehearsal.                                                              |
| Journal evidence              | `9c87aa87cfb9da303fe7832f5ce86085bf6db32b`                                                     | Parent 871dcd4; already in release-owner branch, absent in E2E branch. Do not double-pick.                                                                                          |
| Security/0030 decision record | `ff76bdd950d307167a838ad36650a73ab694cee6`                                                     | Parent 9c87aa8; already in release-owner branch. Records pending decision, not approval.                                                                                            |

[Machine-readable ancestry snapshot](FINAL_INTEGRATION_MAP_2026-10-16.json)
records full refs and `merge-base --is-ancestor` results. No fetched remote branch
contained 2707c83, c17a8f7 or f3f7de4 at observation. This makes no claim about PR
status or local uncommitted work. Discovery does not authorize messaging agents.

## Dependency-ordered integration map

1. **Operational essentials:** release owner freezes a reviewed candidate containing
   the workflow baseline/0030, the complete approved durable-session/MFA fix and
   its positive/negative regression tests. 7153622 and 377879a edit the same auth
   adapter; dc674cc/06f8274 revise associated tests. Do not pick an intermediate
   implementation or transplant only passing tests. Security owner signs off.
2. **Browser essentials:** owners reconcile the selected runner/test changes from
   the two diverged branches. Many E2E files overlap (listed below). Do not broad
   merge or replace tests from one branch with the other. Run the complete final
   matrix on the resulting immutable SHA and exact approved harness.
3. **Evidence essentials:** retain 9c87aa8 and ff76bdd if already ancestors. Attach
   actual provider evidence and signed decisions; docs alone do not satisfy gates.
   Update stale historical snapshots only in release-owner-controlled docs.
4. **Optional additions:** after owner scope approval and before final freeze,
   pick 2707c83, then c17a8f7 individually. They applied cleanly here; neither
   changes migrations or auth. Optional means omit if it delays essential gates.
5. **Freeze final code:** compare diff, exclusions and exact SHA; run only the
   relevant combined gates plus required full release matrix. Checks on earlier
   SHAs do not authorize the final combined application.
6. **Provider sequence:** follow the [controlled rollout checklist](../runbooks/controlled-rollout-preparation.md).
   Current task stops before any cloud rehearsal, migration, push or deployment.

Do not merge the entire performance, older onboarding, Phase 2 integration or
historical UI branches. The final owner-approved candidate may already include
patch-equivalent work: check ancestry AND stable patch IDs before cherry-picking.

## File ownership and compatibility

| Patch / lane           | Paths                                                                                                                                                                                          | Dependency / conflict disposition                                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2707c83                | `src/modules/setup/{contracts,queries,readiness-queries,readiness,readiness.test}.ts`, `tests/integration/setup-readiness.test.ts`, `docs/onboarding/README.md`, `docs/onboarding/pilot/`      | Adds required `nozzlesWithoutMeter` fact, query mapping and current-active-meter predicates together. Keep entire coherent patch; check any newly added fact constructors. No schema migration. No path overlap with either observed active security/E2E delta from 871dcd4. |
| c17a8f7                | `src/app/api/forecourt/commands/route.test.ts`                                                                                                                                                 | Existing ReportMeterUnavailable/ResolveMeterException handlers must still dispatch through confirmBoundary; assertions passed on rehearsal. Test only. No current active-path overlap.                                                                                       |
| Security essentials    | `src/modules/identity/authenticated-actor.ts`, its tests, `tests/integration/{approval-session-boundary,security-step-up}.test.ts`                                                             | Release/security owner only; durable assurance and provider verification must stay coherent. No security code included here.                                                                                                                                                 |
| Diverged browser lanes | Both modify `tests/e2e/{management-reporting,pr144-final-ui,product-shell,production-reconciliation,staff-management,ui-polish}.spec.ts`                                                       | Human owner must review semantic assertion preservation and runner integration. Path overlap is confirmed; textual conflict status is NOT TESTED against changing branches. No conflict resolution attempted.                                                                |
| Runner support         | Release lane changes `playwright.config.ts`, `tests/e2e/global-setup.ts`; E2E lane changes `next.config.ts`, `tsconfig.json`, `.gitignore`, `playwright.postgres-dev.config.ts`, helper/warmup | Distinct entry points/configurations require one accepted execution contract, separate fixture/runtime credentials and isolated generated paths. Do not infer compatible behavior from disjoint filenames.                                                                   |
| Evidence docs          | `docs/CURRENT_STATUS.md`, migration README, release-security decision record                                                                                                                   | Already in release-owner history. Avoid replaying against divergent/stale status text. Existing support risk register still has historical 0025 deferral; use newer explicit evidence with owner reconciliation.                                                             |

The 2707c83 query correction uses existing meter installation columns and active
half-open intervals; it relies on existing schema, not on 0030's policy itself.
Final combined validation still needs restricted-runtime proof, as the onboarding
source's broad fixture suites used an owner connection. The optional command tests
mock handlers and do not by themselves prove database or real MFA behavior.

## Non-release rehearsal evidence

Branch: `codex/final-integration-rehearsal`.
Worktree: `/Users/wolftech/.codex/worktrees/final-integration-preparation/shanda-fuel`.
Base: 871dcd45c11893149947e7ee3e412505dcc1534b.

- 2707c83 cherry-picked with traceability trailer as
  `99a7afe051895d00541ae0d6b821bea61ded8abc`.
- c17a8f7 cherry-picked with traceability trailer as
  `f4754c83e68b8b38b16a7c98fec9355a0313f7b8`.
- Both applied without conflict. Stable patch IDs match originals:
  onboarding `dcc14f03ec7e3daa420d64ed7668be0cb6762601`;
  command tests `31ac48657d8837bba5a80426e50e2541c7419826`.
- Focused unit/static results are recorded in the final validation section below.
  No local/provider database was created or migrated, no E2E matrix rerun.
- No active security commits or evidence commits were cherry-picked. Read evidence
  via `git show` at the full recorded SHA; candidate-only paths are not local links.
- This branch must never be promoted as a release candidate. Integration owner
  should use the original optional commits, not broad-merge this rehearsal branch.

The independent E2E report at baec0c9 records its matrix at 42f8228 as **363 passed,
1 failed, 4 intentional screenshot skips, 0 not run/flaky**; focused smoke repeat
6/6 is not a full PASS. Release-owner f3f7de4 has subsequent different changes and
no final acceptance evidence was established by this task. Treat security and
complete-browser gates as BLOCKED pending exact-SHA owner evidence.

## Handoff and outstanding owner actions

Release owner selects a single reviewed security/E2E handoff; security owner
resolves BYPASSRLS discrepancy; migration owner obtains authorized isolated 0030
rehearsal and exact live-state preflight; provider owners supply Preview isolation,
source/alias, eligible rollback and recovery evidence; Owner approves optional
scope and final exact-SHA migration/deployment window; station/Finance/access
leads sign real pilot facts and acceptance. See the checklist for order and proof.
No GO can be inferred from clean cherry-picks or source documentation.

## Final preparation validation

Focused unit command:
`pnpm test:unit src/modules/setup/readiness.test.ts src/app/api/forecourt/commands/route.test.ts --maxWorkers=2`
— **18 passed**, 2 files, zero failed/skipped. Changed TypeScript/test ESLint
— **PASS**. `pnpm typecheck` (Next route generation plus TypeScript) — **PASS**.
Source patch IDs, exclusion/protected-file scope, document links, commit IDs,
Markdown/JSON formatting and whitespace checked. These are compatibility/static
checks only. No build, database integration, full unit suite or browser matrix
was rerun because security integration is deliberately excluded and this task
requests focused preparation. Existing onboarding database/build evidence is
attributed in `docs/onboarding/pilot/validation.md`, not re-labelled as this
rehearsal passing those gates. Independent review disposition is recorded in
the final handoff. No production/staging or provider action; no push/merge/deploy.

Independent final review: **GREEN**. Reviewer inspected actual optional-patch
diff, all ancestry booleans, document links, 0030 hash, security decision record
and rollout order; no actionable findings. Unit/lint/typecheck evidence was
attributed rather than independently rerun. Release remains BLOCKED pending
the checklist's security, browser, provider and authorization evidence.
