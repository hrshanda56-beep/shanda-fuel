# Frontend ⇄ PR #120 (Clerk / staff-number auth) integration handover

Prepared 2026-10-12, **read-only**. No checkout, rebase, commit, push, merge, deploy or migration was run.
Nothing under the frozen frontend worktree or Codex's worktree was modified. This is the detailed working copy
(untracked, repo root of the `ops/staging-auth-bootstrap-one-shot-20260930` worktree).

> **Correction (2026-10-12, round 3):** the frontend's own frozen handover already exists at
> `~/Downloads/Shanda_Fuel_Frontend_Handover_v1/F0_outputs/FRONTEND_INTEGRATION_HANDOVER.md` (my earlier search was cut
> short, so the first line of this header — "no earlier copy" — was wrong). It now carries a short
> "Post-#120 assessment" section pointing here. Also corrected below: the frozen shell **does** have an account menu
> (`AccountMenu`, `app-shell.tsx` ~893–975; identity + theme, no sign-out/Settings link) — my earlier "no profile code"
> statements in §3.3 and §13.1 are superseded by §15. **§15 supersedes §11.1, §12.4 and §13.1.**

## 1. Refs inspected

| Item | Value |
| --- | --- |
| Common base | `origin/main` = `9005569` (both sides branch from it; main has not moved) |
| Frozen frontend | `901256769263d1d5a5d87b1e622a087bb1c91d79` = tip of `ui/visual-polish-20261010`; 49 commits, 79 files |
| PR #120 | `feat/clerk-staff-number-auth-0027` @ `9669c46`; 20 commits, 73 files; GitHub: OPEN, not draft, MERGEABLE/CLEAN against `main` |
| PR #120 CI at `9669c46` | quality, Dependency audit, Secret scan, SAST, Runtime-role proof, 3× Vercel: SUCCESS. CodeQL: SKIPPED (by design, `CODEQL_ENABLED` unset) |
| Codex 0028 WIP | uncommitted in `~/.codex/worktrees/ci-arm64-gitleaks/shanda-fuel` (on `9669c46`) — see §6 |

Method: `git diff --name-status` for each side against the base, then `git merge-tree --write-tree` between the
frozen SHA and the PR head. `merge-tree` wrote loose objects (tree `7ef1d46…`) into the shared object store but
touched no ref, index or working tree.

## 2. Headline

The brief anticipated conflicts in `app-shell.tsx`, shared navigation, Profile, Staff and Settings. **None of
those conflict textually.** The two branches touch disjoint files except for two:

| # | File | Result |
| --- | --- | --- |
| 1 | `src/modules/forecourt/ui/operations-control-room.tsx` | **Content conflict, and git's partial result is wrong** (see §3.1) |
| 2 | `tests/e2e/production-reconciliation.spec.ts` | Content conflict, trivial (see §3.2) |

Everything else merges cleanly in git — but a clean merge is not a correct integration. §4 lists the semantic
touchpoints that need a deliberate check.

## 3. Conflict matrix

### 3.1 `operations-control-room.tsx` — the only real work

- **Frontend (F2-02 etc.)** re-laid the page into `operations-layout-main` / `operations-layout-side` panels,
  renamed the section heading to `Shifts`, and reworded copy (e.g. "Open this business day?").
- **PR #120** (non-UI-layout, +93/−7) adds, inside the unchanged "Lock business day" step-up area:
  1. `import { useReverification } from '@clerk/nextjs'` (line 3)
  2. a new top-level `ClerkStepUpForm` component (~70 lines, self-contained)
  3. `authProvider` state (`'BETTER_AUTH' | 'CLERK'`)
  4. `loadMfaStatus`: a 404 from `/api/auth/mfa/setup` ⇒ `CLERK`, `mfaEnabled=false`; success ⇒ `BETTER_AUTH`
  5. a `authProvider === 'CLERK' ? <ClerkStepUpForm …/> : mfaEnabled !== true ? <existing password+TOTP form/> …`
     branch in the lock block, plus new help text ("privileged reverification … provider or server")
  6. a one-line `if (!response.ok) throw …` reformat (no behavior change)
- **Why git's output is unsafe:** the frontend moved the lock block (FE line ~880–1021) while the PR edited it in
  place, so git produced two conflict hunks (merged-file lines ~814–1004 and ~1193–1220) *and* auto-merged a
  **duplicated lock block** (`Lock business day` / `lock-business-day-step-up-help` appear ~5× in the merged
  result, two with different `requiresStepUp` conditions). Do not hand-edit conflict markers in that result.
- **Resolution (file-level):** start from the **frontend file verbatim**, then re-apply PR items 1–6 by hand at
  the frontend's equivalents. Concretely:
  1. Add the import (1) and paste `ClerkStepUpForm` (2) above `tone()`.
  2. Add `authProvider` state (3) next to `mfaEnabled`; apply the `loadMfaStatus` change (4).
  3. In the frontend's lock block (`requiresStepUp ? (…)` at FE ~885), wrap the existing
     `mfaEnabled !== true ? <form/> : …` chain with the `authProvider === 'CLERK'` first branch (5). Keep the
     frontend's markup/classes for everything else.
  4. Replace only the help-text sentence (5). Keep the frontend's "Lock is irreversible." note.
  5. Keep the frontend's "Open this business day?" wording (the PR's "server-derived" wording is the *old* text,
     not a PR change — the PR did not edit it; git only shows it because the frontend changed it).
- **Security invariants to keep (Codex-owned behavior):** `ClerkStepUpForm` posts to `/api/auth/step-up` with
  exactly `{tenantId, action: 'LOCK_BUSINESS_DAY'}`; Clerk's `clerk_error` body must be returned (not thrown) so
  `useReverification` can prompt; lock button remains server-gated (`requiresStepUp`/`permissionGranted`).
  Under `BETTER_AUTH` the component tree must not require a `ClerkProvider` (PR added an e2e assertion for this).
  `ClerkStepUpForm` is only mounted when `authProvider === 'CLERK'`, so `useReverification` is never called
  outside a provider — preserve that conditional mount; do not hoist the hook.
- **Owner/time:** ~30–45 min by hand; then `typecheck`, `lint`, `format:check`, and the control-room e2e specs.

### 3.2 `tests/e2e/production-reconciliation.spec.ts` (DB-gated)

- Frontend: heading assertion → `getByRole('heading', { name: 'Shifts', exact: true })`.
- PR: adds `await expect(controlRoom).toBeVisible()` (with comment) and keeps the old
  `'Shift boundaries and team context'` heading.
- **Resolution:** keep the PR's `toBeVisible()` guard + comment, then the **frontend's** `Shifts` assertion. Drop
  the old heading assertion (it no longer exists in the frozen UI).

### 3.3 Clean-merge files that still need a deliberate decision (semantic matrix)

| Area | Textual | PR #120 change | Frozen frontend state | Required action |
| --- | --- | --- | --- | --- |
| `design-system/app-shell.tsx` | none (FE only) | not touched | has `AccountMenu` (identity + theme; **no sign-out, no Settings link**) — corrected, see §15.2 | No textual merge. Approved scope (§15.2): add provider-aware sign-out + Settings link to this menu; never a Better-Auth-only handler. |
| Shared navigation (`navigation-server.ts`) | none | cookie check → `hasProviderSessionCookie()` (`session_token` vs `__session`) | untouched (still the old `includes('session_token')` form on the base) | Takes PR version automatically. Verify shell still renders signed-out/ready states with the e2e navigation fixture header (`x-shanda-e2e-navigation-fixture`). |
| Profile / Account tab | none | `settings-workspace.tsx`: `provider` prop, email fallback "No email provided" | untouched | Auto-merges. Visual QA at 320/375/1440 (FE F4-07 wraps long values). |
| Staff panel | none | `staff-panel.tsx` +137/−19 (staff-number onboarding UI), `staff/commands.ts` +277 | untouched, **but FE changed shared CSS (`components.css`, `approved-ui.css`, `shell.css`), `modal.tsx`, new `modal-lock.ts`, 16 px phone form-control rule (F4-07)** | Visual + axe QA of the staff panel and any dialog it opens against the new modal-lock/overlay behavior. |
| Sign-out | none | `sign-out-button.tsx` provider-aware (`useClerk().signOut` vs `authClient.signOut`), `/login` replace + refresh | untouched | Takes PR version. `workplace-views.tsx` also changed by PR; FE untouched. |
| Entry pages | none | new `/join`, `clerk-login-form.tsx`, `manual-activation.tsx`, edits to `/login`, `/invite/[token]`, `/workplace` | `/login` is exercised by `ui-polish` and `product-shell` specs; FE's phone ≥16 px rule applies | New components were never run through the FE a11y/screenshot specs. Add `/join` (and Clerk-mode `/login`) to QA; Clerk widgets only render with real keys, so use Better-Auth-mode checks for layout. |
| `app/layout.tsx` | none | wraps children in `ClerkProvider` only when `AUTH_PROVIDER=CLERK` and a publishable key exists | untouched | Takes PR version. No FE action. |
| `src/proxy.ts` (new) | none | Clerk middleware; no-op (`NextResponse.next()`) under `BETTER_AUTH` | FE adds `/dev-preview/**` routes | Matcher covers every page incl. `/dev-preview`. Harmless under Better Auth; under Clerk the middleware runs there. **Not verified:** that `/dev-preview` is unreachable in production builds — confirm before any prod promotion (FE-owned). |
| `playwright.config.ts` | none | `webServer.command` adds `AUTH_PROVIDER=BETTER_AUTH` | unchanged (keeps the synthetic-fixture header in `use`) | Auto-merges cleanly; both edits are in different hunks. |
| `package.json` / `pnpm-lock.yaml` | none | adds `@clerk/backend`, `@clerk/nextjs` | no dependency changes | Run `pnpm install --frozen-lockfile` after merge; lockfile should not need regeneration. |
| `vitest*.config.ts`, `tests/vitest/environment.ts` | none | default `AUTH_PROVIDER=BETTER_AUTH` for unit/integration | FE unit tests added (`modal-lock`, `dashboard-figures`, `my-shift-summary`, `tank-overview-model`, `settlement-summary`, `operations-labels`, `preview-reports`, `format`) | FE units never read the provider; expected clean. |
| Reports / dashboard / inventory / cash / customers / suppliers / settlements UI | none | not touched | FE-only | No auth interaction. |
| `.github/workflows/ci.yml`, `.env.example`, `docs/DECISIONS.md` | none | runner → `ubuntu-24.04`, native Semgrep, `AUTH_PROVIDER` env | not touched | Takes PR version. |
| DB schema / migrations | none | `0027` + schema `identity.ts`, `staff.ts`, `auth.ts` | none | FE adds no migrations — **no migration-number collision with 0027/0028**. |
| `AGENTS.md` | n/a | not touched | has an uncommitted `next dev` regeneration edit in the FE worktree | Preserve as-is; do not include in the integration commit unless the owner wants it (same rule as your existing worktrees). |

## 4. Smallest safe integration sequence

Do this in a **new, separate worktree/branch** (e.g. `integration/fe-9012567-pr120`), created from the PR head
*after* Gate 2A and the new CI candidate land, so the frozen branch and Codex's worktree stay untouched.

1. **Pin inputs.** Record the final PR head SHA (Gate 2A + 0028 + new CI candidate) and the frozen frontend SHA
   `9012567`. If the PR head moves, re-run `git merge-tree` (command in §9) — conflicts are re-derivable in seconds.
2. **Create the integration branch from the PR head**; `git merge 9012567…` (merge, don't rebase the frozen branch).
3. **Resolve the two conflicts** per §3.1/§3.2. Everything else is automatic.
4. **Static gates (parallel, ~minutes, no DB):** `pnpm install --frozen-lockfile` → in parallel
   `format:check`, `lint`, `typecheck`, `test:unit`.
5. **DB bring-up** (isolated, §7) → `scripts/db/bootstrap-test.sh` → `pnpm db:migrate:test` (applies 0001–0028 to the
   *throwaway* DB only) → `pnpm db:check` → `pnpm test:integration` (serial by design).
6. **Build once**, then the Playwright queue (§5) against that single build.
7. **Review gate:** screenshot matrix (opt-in) for new auth surfaces + owner sign-off on the lock-business-day
   step-up screen in both providers.
8. Only then push/PR — outside this prep task.

## 5. Post-integration Playwright queue

All specs run through `playwright.config.ts` (Chromium, header `x-shanda-e2e-navigation-fixture: synthetic`,
port 3100, `APP_ENV=test AUTH_PROVIDER=BETTER_AUTH`). 24 spec files exist on the frozen branch.

**Queue A — DB-free, no secrets, parallel-safe (19 files).** These use the synthetic navigation fixture and/or
`page.route` mocks:
`a11-daily-operations`, `a12-valuation`, `a3-forecourt-workspace`, `acceptance-quality`, `accessibility`,
`auth-entry`, `cash-workspace`, `customers`, `daily-reconciliation`, `data-filled-screens`, `login-mfa`,
`my-shift`, `overview-shell`, `product-shell`, `provider-settlements`, `shell-consistency`, `smoke`,
`suppliers`, `ui-polish`.

> **Open question — "the 18 frontend suites":** I could not find a list of 18 in the repo, docs, or evidence
> folder. By file count the DB-free set is 19; the frontend-owned set depends on how you counted
> (`auth-entry` and `login-mfa` exercise the auth-entry UI and are mocked, so they may be the one(s) you counted
> under "auth"). Please confirm the list; until then Queue A runs all 19 and nothing is lost.
> Note some DB-gated files also contain ungated tests (`settings` 7 tests, `management-reporting` 5), so test
> counts differ from file counts.

**Queue B — DB/auth-gated, serial (4 files).** Skip themselves when `DATABASE_URL` is unset, mint Better Auth
session cookies with `better-auth/crypto` `makeSignature`, and seed rows directly via `postgres`:
`settings`, `staff-management`, `management-reporting`, `production-reconciliation`.
These are the suites that validate the *integration*: PR #120 changed Settings/Staff/control-room, the frontend
changed the surrounding UI. Run them with `--workers=1` (as CI does).

**Queue C — opt-in:** `screenshot-matrix` (needs `SCREENSHOT_DIR`); run once for visual review of `/login`,
`/join`, Settings→Account/Staff and the control-room lock block.

**Separately gated Clerk checks (no Playwright suite exists):** Clerk-mode behavior is covered only by unit and
integration tests (`provider.test.ts`, `session-cookie.test.ts`, `clerk-step-up.test.ts`, `0027…test.ts`,
`security-step-up.test.ts`) and Codex's Gate 2A. A live Clerk e2e (sign-in, reverification, sign-out) is **not
part of this queue** and would need a Clerk test instance — record as a known gap rather than inventing a suite.

Suggested order: static gates → build → Queue B (serial, owns the DB) ∥ Queue A (parallel, DB not needed) →
Queue C last. Failing-first order if time is short: `production-reconciliation`, `settings`, `staff-management`,
`product-shell`, `accessibility`, `auth-entry`.

## 6. Codex's 0028 work (read-only observation)

Uncommitted in `~/.codex/worktrees/ci-arm64-gitleaks/shanda-fuel` (on `9669c46`): edits to
`src/app/api/staff/commands/route.ts`, `src/modules/staff/commands.ts`, `src/platform/auth/provider.ts`,
migrations `README.md` and `meta/_journal.json` (adds idx 28 `0028_clerk_target_identity_revocation`); new
`src/modules/staff/revocation.ts`, `provider-revocation.test.ts`, `commands.test.ts`, `commands.route.test.ts`,
and `0028_clerk_target_identity_revocation.{sql,test.ts}`. **Zero overlap** with the 79 frontend files, including
`_journal.json`. Expectation after Gate 2A: the PR diff grows by those files only; §3 stays valid. Re-run the
`merge-tree` check on the final SHA to confirm.

## 7. Fixtures, isolated databases, credentials (names only; no values read)

| Need | Used by | Source / note |
| --- | --- | --- |
| Throwaway PostgreSQL 16 (`shanda_fuel_test`), never staging/prod | Queue B, `test:integration`, `db:migrate:test` | CI uses a `postgres:16` service container. Locally: a disposable container/DB with a fresh name per run. `.neon` and staging/prod URLs in `.env*` must **not** be used. |
| Role bootstrap | migrations, RLS tests | `scripts/db/bootstrap-test.sh` (creates `migration_owner`, runtime role, first-user provisioner); then `assert-ci-first-user-provisioner.sh`, owner fix-up for `drizzle` schema, `db:check`. Runtime-role proof job additionally uses `prepare-ci-runtime.sh` and `assert-ci-runtime-role.sh` and starts the app with **`DATABASE_DIRECT_URL` unset**. |
| `DATABASE_URL`, `DATABASE_DIRECT_URL` | above | Local test DB only. Direct URL is migration-only (app must not see it). |
| `APP_ENV=test`, `APP_URL=http://127.0.0.1:3100`, `AUTH_PROVIDER=BETTER_AUTH` | all | Public config. |
| `BETTER_AUTH_SECRET`, `AUDIT_SIGNING_KEY_ID`, `AUDIT_SIGNING_KEY` | Queue B (cookie signing), integration | CI uses clearly-labelled integration-only dummy values committed in `ci.yml`; reuse those, never a real secret. |
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | only Clerk-mode manual checks | **Not needed** for any automated queue (unit tests use fixture strings). If a manual Clerk check is wanted, it requires a Clerk *test* instance whose keys the owner provides; I did not and will not read them. |
| Seed data | Queue B | Created inline by the specs via direct SQL (tenants, users, roles, staff). No external fixture files; frontend adds `tests/e2e/fixtures/data-filled.ts` for the DB-free screens. |
| Browsers | all | `pnpm exec playwright install --with-deps chromium` (CI) / local Chromium. |
| Node / pnpm | all | Node 24, pnpm 11.25.0 (per CI). |

## 8. Parallelization opportunities

- Resolving the two conflicts (human) can overlap with spinning up the throwaway DB and `pnpm install` in the new worktree.
- `format:check`, `lint`, `typecheck`, `test:unit` are independent → run concurrently.
- `test:integration` is deliberately serial (shared DB, fault-injection triggers) → keep it single-stream, but it
  can run concurrently with the **Queue A** browser run if each uses its own database/port (separate PG + port 3101).
- Queue A is `fullyParallel` and DB-free → use multiple workers. Queue B must stay `--workers=1`.
- The visual review of §3.3 surfaces (staff panel, `/join`, `/login`, lock step-up) can be done by a second
  person/agent from the screenshot matrix while Queue B runs.

## 9. Reproduce / re-verify (read-only)

```bash
# conflict check against the final PR head — touches no working tree
git fetch origin feat/clerk-staff-number-auth-0027
git merge-tree --write-tree --name-only \
  901256769263d1d5a5d87b1e622a087bb1c91d79 origin/feat/clerk-staff-number-auth-0027
# overlap by filename
comm -12 <(git diff --name-only 9005569 901256769263d1d5a5d87b1e622a087bb1c91d79 | sort) \
         <(git diff --name-only 9005569 origin/feat/clerk-staff-number-auth-0027 | sort)
```

## 10. Not verified / caveats

- No code was built or tested for this prep; all claims are from diffs and `merge-tree`, not execution.
- PR #120 CI status is as of this read (head `9669c46`); Gate 2A and the new CI candidate are not yet reflected.
- The "18 suites" list and `/dev-preview` production reachability need owner confirmation (§5, §3.3).
- Whether `staff-panel.tsx` opens a `Modal` (and so interacts with the FE's `modal-lock` change) was not checked;
  it is on the QA list rather than assumed safe.

---

# Addendum — decisions review (2026-10-12, still read-only)

Nothing was committed, merged, rebased, pushed, deployed or changed in either source worktree. Frozen frontend
remains `901256769263d1d5a5d87b1e622a087bb1c91d79`.

## 11. Decision 1 — test inventory vs the runner's 18-name allowlist

### 11.1 The allowlist itself was not found

I searched the repo, the frozen worktree (`scripts/`, `ops/`, `docs/`, `evidence/`), `/private/tmp`
(`shanda-fuel-prioritized-verification-queue-2026-10-11.md`, `shanda-fuel-qa-acceptance-and-e2e-matrices-2026-10-11.md`,
the three `shanda-fuel-*playwright*.config.ts` files, `shanda-e2e.9WB4n7/test-results`) and home. None contains an
18-name list; the configs have no allowlist and the queue docs describe checks, not spec names. **The exact
name-by-name diff therefore cannot be produced yet — please give me the runner path or paste its list.** Once I
have it, the diff is mechanical:

```bash
# allowlist.txt = one spec basename per line, no extension
ls tests/e2e/*.spec.ts | xargs -n1 basename | sed 's/\.spec\.ts$//' | sort > actual-24.txt
sort allowlist.txt > a.txt
comm -13 a.txt actual-24.txt   # on disk, NOT in allowlist
comm -23 a.txt actual-24.txt   # in allowlist, NOT on disk (stale/renamed names)
```

### 11.2 What the arithmetic already proves

- Database-free set on the frozen tree = 19 files (earlier handover §5).
- Removing the two auth suites you named (`auth-entry`, `login-mfa`) leaves **17**, not 18.
- So the 18-name allowlist **must contain at least one name that is not in the 17 DB-free non-auth specs.**
  Candidates, from the evidence: (a) `management-reporting` — its first test ("unauthenticated shell explains the
  required organisation context") is not DB-gated, the other four are; (b) `settings` — all of its tests skip without
  `DATABASE_URL`/`BETTER_AUTH_SECRET`, so it would run as 0 executed tests and look "green"; (c) a name that no
  longer exists on the frozen tree (stale); (d) `screenshot-matrix`, which self-skips without `SCREENSHOT_DIR`.
  I am not assuming any is safe or including it. Also check whether the runner's list is missing any of the 17.

### 11.3 Classification of all 24 specs on the frozen tree (evidence-based, not executed)

| Class | Spec files | Why |
| --- | --- | --- |
| **Database-free UI (17)** | `a11-daily-operations`, `a12-valuation`, `a3-forecourt-workspace`, `acceptance-quality`, `accessibility`, `cash-workspace`, `customers`, `daily-reconciliation`, `data-filled-screens`, `my-shift`, `overview-shell`, `product-shell`, `provider-settlements`, `shell-consistency`, `smoke`, `suppliers`, `ui-polish` | Use the synthetic navigation fixture header and `page.route` / fixture data; no `DATABASE_URL`, no session minting. `product-shell` and `ui-polish` visit `/login` (and `/settings`) only as signed-out pages. |
| **Authentication / Clerk dependent (2)** | `auth-entry`, `login-mfa` | Mock `**/api/auth/sign-in/email` and the MFA challenge; Better-Auth-flow specific. Excluded from the FE runner by design. **No spec exercises Clerk mode** — Clerk coverage is unit/integration only (§5). Post-integration they must run with `AUTH_PROVIDER=BETTER_AUTH` (the PR pins it in `playwright.config.ts`) and are *not* evidence for the Clerk path. |
| **Database dependent (4)** | `settings`, `staff-management`, `management-reporting`, `production-reconciliation` | Skip without `DATABASE_URL` (+`BETTER_AUTH_SECRET`); seed via `postgres`; forge Better Auth cookies with `makeSignature`. `staff-management` is also heavily auth-coupled (42 auth references). `settings` contains the **logout test** ("signs out from Account"); `management-reporting` has one ungated test. |
| **Screenshot opt-in (1)** | `screenshot-matrix` | `test.skip` unless `SCREENSHOT_DIR` is set. |

### 11.4 Prepared queues (not run)

| Queue | Contents | Env | Mode | Gate |
| --- | --- | --- | --- | --- |
| **Q1 — DB-free UI** | the 17 above | `APP_ENV=test AUTH_PROVIDER=BETTER_AUTH`, no DB | `fullyParallel`, multiple workers | Runs first and on every candidate SHA. Fail = stop. |
| **Q2 — Auth (mocked)** | `auth-entry`, `login-mfa` | same | parallel OK | Explicit, separate sign-off; not merged into Q1 totals. |
| **Q3 — Database** | `settings`, `staff-management`, `management-reporting`, `production-reconciliation` | throwaway PG + roles + migrations through the final PR migration (incl. 0028) + dummy CI secrets (§7) | `--workers=1`, serial | Must show executed (not skipped) counts: assert 0 skipped. This is the integration-acceptance queue. |
| **Q4 — Screenshots** | `screenshot-matrix` | `SCREENSHOT_DIR=<fresh dir>` | single | Review artefact, not pass/fail; add `/join`, Clerk-mode-neutral `/login`, Settings→Staff/Account and the lock step-up. |
| **Q5 — Clerk-mode (gap)** | none exist | Clerk *test* instance (owner-supplied) | manual | Needed for the VQ-18/22 provider claims; record as an explicit gap until a suite exists. |

Reporting rule for every queue: record `expected / passed / failed / skipped` per file. A "green" run with skips
in Q3 is a fail, because Q3 is exactly the set that silently no-ops without a database.

## 12. Decision 2 — `/dev-preview` production-access review

### 12.1 What exists (frozen tree)

15 files under `src/app/dev-preview/`: pages `/dev-preview`, `/attendant`, `/scenarios`, `/valuation`,
`/valuation/revaluations/[id]`, `/valuation/streams/[tankId]/[productId]`; route handlers
`/dev-preview/scenario/[name]` (sets a cookie, 302) and `/dev-preview/api/my-shift`. Fixture data only; the client
shell installs a fetch shim (`installFixtureFetch`) so no real API is called.

### 12.2 Actual guards

| Surface | Guard | Fails closed? |
| --- | --- | --- |
| `layout.tsx` (covers all 6 pages) | `if (NODE_ENV !== 'development') notFound()` | Yes for production **and** test (stricter than `/design-system`, which only blocks `production`) |
| `scenario/[name]/route.ts` | same check → `404` before reading params or setting the cookie | Yes |
| `api/my-shift/route.ts` | same check → `404` | Yes |
| Individual pages | **none** | — |
| Middleware / proxy | **none.** `src/proxy.ts` (PR #120) is session-only; under Better Auth it is a no-op, under Clerk it adds nothing for this path. `next.config.ts` has no rewrite/redirect for it. | — |
| Tests | **none.** `dev-preview/preview-reports.test.ts` tests data only; nothing asserts the 404. The only referencing spec is the opt-in screenshot matrix (which depends on dev mode). | — |

### 12.3 Verdict

- **Production builds appear to deny it, including direct URLs**, because `NODE_ENV` is `production` for
  `next build`/`next start` and Vercel (preview, staging and production deployments alike), so the layout 404s and both
  handlers return 404; the app is also built by CI's runtime-role job, which starts `pnpm start`. **This is a code
  reading, not an observed result** — no production build exists in the frozen worktree (`.next` holds only `dev`), I
  did not build, and I did not request any deployed URL (read-only boundary).
- **The protection is thin and untested.** (1) It relies on a single layout. Next 16's own auth guide warns that
  layout checks are not a boundary because of partial rendering and multiple entry points
  (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`, "Layouts and auth checks"). The pages render only
  fixture data today, so the blast radius is low, but nothing prevents a future page there from rendering data.
  (2) No automated test pins the behavior, so a refactor could silently open it. (3) `valuation/page.tsx` already uses
  `AuthorizedAppShell` (real auth) while the others use the synthetic `AppShell`; keeping that distinction is worth a
  comment. (4) Anything running `next dev` (including Playwright's webServer, `pnpm dev`) exposes it by design — never
  run `next dev` on a shared or internet-reachable host.
- **Related synthetic surface — fine, noted:** the `x-shanda-e2e-navigation-fixture` header is only honoured when
  `NODE_ENV !== 'production' && APP_ENV === 'test'` (`allowsE2ENavigationFixture`). `/design-system` and
  `/design-system/entry` 404 only when `NODE_ENV === 'production'` (`isDesignSystemReferenceAvailable`) and already
  have `availability.test.ts`.

### 12.4 Smallest fix + focused regression test (proposal only — not applied)

The frozen branch is not to be changed, so this belongs on the integration branch (or a small follow-up on
the frontend branch once unfrozen). Two small, independent additions:

1. **Routing-layer deny** in `next.config.ts`, so every path under the prefix (pages, RSC requests, handlers, future
   additions) 404s before any route code runs, outside `development`:

   ```ts
   async rewrites() {
     if (process.env.NODE_ENV === 'development') return [];
     // Synthetic previews exist only under `next dev`; deny at the routing layer so a
     // future page under this prefix can never be reached in a built app.
     return { beforeFiles: [{ source: '/dev-preview/:path*', destination: '/__dev-preview-disabled__' }] };
   },
   ```

   (destination is an intentionally non-existent path → standard 404; keep the existing layout/handler guards as
   defence in depth.) *Unverified assumption:* `:path*` also matches the bare `/dev-preview`; the test below checks the
   config shape, and the CI step below checks real behavior.

2. **Regression tests (focused):**
   - `next.config.test.ts` (already stubs `NODE_ENV`): for `production` and `test`, `rewrites()` contains a
     `beforeFiles` rule for `/dev-preview/:path*`; for `development` it is empty.
   - `src/app/dev-preview/guard.test.ts` (vitest, stub `NODE_ENV=production`): `DevPreviewLayout` throws the
     Next not-found error; `GET` on `scenario/[name]` and `api/my-shift` returns status 404 **and sets no
     `set-cookie`**.
   - CI runtime-role job (already runs `pnpm start`): add `curl -s -o /dev/null -w '%{http_code}'` for
     `/dev-preview`, `/dev-preview/attendant`, `/dev-preview/scenario/normal`, `/dev-preview/api/my-shift` → all `404`.
     This is the only check that proves the real production server, and it needs no secrets.

Do not apply until the integration branch exists.

## 13. Additional integration blockers / risks found this round

1. **No auth-aware profile/sign-out exists in the frozen shell.** The verification queue (VQ-18) expects a "Profile
   dropdown ref 06" consistent with Settings→Account and both providers' logout. The frozen `app-shell.tsx` has no
   profile or sign-out code (0 references). `ui/redesign-shell-overview` (`28cccb9`, not an ancestor of the frozen SHA
   nor in `main`) does have one — and it calls `authClient.signOut()`, which is **Better-Auth-only** and would break
   Clerk sign-out. Decide: is the profile dropdown in scope for this integration? If yes it must be built/ported
   provider-aware (reuse PR #120's `SignOutButton provider`); if no, VQ-18 must be re-scoped to Settings→Account only.
   Either way, do not cherry-pick the redesign `SignOutButton` as-is.
2. **VQ-21 "shared root layout" risk is smaller than the queue assumes.** The frozen branch does not edit
   `src/app/layout.tsx`, so PR #120's `ClerkProvider` wrapper merges untouched; the genuine risks are CSS import order
   (PR doesn't touch it) and the new auth screens vs FE CSS (§3.3).
3. **Q3 silently no-ops without a database** (see 11.4 reporting rule).
4. **`production-reconciliation` and `settings` are the only specs touching both changed areas**; both are Q3, so a
   Q1-only run is **not** integration acceptance.
5. **The integration must start from the final security-approved PR #120 SHA**, which will include 0028 and Codex's
   in-flight staff-command/provider changes (§6); rerun §9 on that SHA and re-check that `_journal.json` has no
   frontend counterpart (currently none).
6. **Modal scroll-lock and phone inputs** (your acceptance list) are verified only for FE screens today. Add to the
   post-integration checklist: open a dialog from Staff panel and from the lock step-up flow → page does not scroll,
   background inert, body unlocked on close; and every input in `/login`, `/join`, `/invite/[token]`, manual
   activation, staff invite form computes to ≥16 px on a phone viewport.
7. **Clerk step-up must be reapplied "exactly"** — add a post-merge diff check: the Clerk-specific blocks in the
   integrated `operations-control-room.tsx` should diff clean against PR #120's versions (`ClerkStepUpForm`, the
   `authProvider` state, the 404 ⇒ `CLERK` branch in `loadMfaStatus`, and the `authProvider === 'CLERK'` first
   branch in the lock block), and the lock button must appear exactly once.

## 14. Open items for the owner

- Path to (or paste of) the runner's 18-name allowlist, to produce the exact diff in §11.1.
- Is a shell Profile dropdown in scope (§13.1)?
- Approve applying the `/dev-preview` fix + tests to the integration branch (§12.4)?

---

# 15. Decisions applied (2026-10-12, round 3 — still read-only)

Frozen frontend: `901256769263d1d5a5d87b1e622a087bb1c91d79`. Nothing implemented, merged, rebased, pushed, deployed;
neither source branch touched. Codex still owns Gate 2A (Clerk session-revocation proof), migration 0028 and the final
security candidate; **integration starts only from that final security-approved PR #120 SHA.**

## 15.1 Decision 1 — test inventory (resolved; supersedes §11.1)

Allowlist read from `~/Downloads/Shanda_Fuel_Frontend_Handover_v1/F0_outputs/runner/run-queue.sh` (`ALLOW=`, 18 names).
Compared with `tests/e2e/*.spec.ts` on the frozen tree (24 files):

- Allowlist names missing from disk: **none**. Disk files not in allowlist: **exactly 6** —
  `auth-entry`, `login-mfa`, `settings`, `staff-management` (auth / #120; the runner comment says so) and
  `management-reporting`, `production-reconciliation` (database-backed).
- The 18 = **17 functional database-free UI suites + `screenshot-matrix` (opt-in)**. My earlier "19 database-free"
  was wrong in the sense that matters: it counted `auth-entry`/`login-mfa` (not database-backed but auth-coupled) and
  omitted `screenshot-matrix`. §11.2's list of "candidates for the 18th name" is closed: it is `screenshot-matrix`.

### Exact classification (final; supersedes §11.3)

| Class | Specs | Runner / queue |
| --- | --- | --- |
| **Database-free UI (17)** | `a11-daily-operations`, `a12-valuation`, `a3-forecourt-workspace`, `acceptance-quality`, `accessibility`, `cash-workspace`, `customers`, `daily-reconciliation`, `data-filled-screens`, `my-shift`, `overview-shell`, `product-shell`, `provider-settlements`, `shell-consistency`, `smoke`, `suppliers`, `ui-polish` | **Q1** — isolated runner, allow-listed |
| **Screenshot opt-in (1)** | `screenshot-matrix` (needs `SCREENSHOT_DIR`; job form `NN screenshot-matrix screenshots`) | **Q4** — isolated runner, allow-listed; = 18th name |
| **Authentication / Clerk dependent (2)** | `auth-entry`, `login-mfa` (route-mocked Better Auth flows; no Clerk-mode spec exists) | **Q2** — NOT in the old runner; separate sign-off after Codex coordination, `AUTH_PROVIDER=BETTER_AUTH` |
| **Database dependent (4)** | `settings` (includes the "signs out from Account" test), `staff-management`, `management-reporting`, `production-reconciliation` | **Q3** — NOT in the old runner; throwaway PG + roles + migrations through the final PR migration, `--workers=1`, must show 0 skipped |

Totals: 17 + 1 + 2 + 4 = 24. Queue order after integration (matches the frozen handover §7): static gates → Q1 →
Q4 (new folder, compared with `screenshots-20d`) → Q2 → Q3. Q1 pass criterion from the frozen handover: all pass, no
new skips (expected counts from the last frozen run: 107/149/87/24 across queue runs; the integrated run is judged by
"no new skips, no new failures", not by those numbers).

### Runner blocker for post-integration use (new)

The runner cleans the environment with `env -i` and starts `next dev` with **only `APP_ENV=test`** (plus PATH/HOME…).
After PR #120, `getAuthProviderName()` calls `assertAuthProviderName(process.env.AUTH_PROVIDER)` directly and **throws
when it is unset** (the zod `default('BETTER_AUTH')` in `env.ts` is not consulted on that path), and the root
`layout.tsx` calls it on every render. By code reading, every page would 500 under the unchanged runner. Required
change for an integrated copy of the runner (the frozen original must stay byte-identical — its SHA-256 is recorded
in the frozen handover): add `AUTH_PROVIDER=BETTER_AUTH` to the `run_clean` server start (and to the
`playwright` child env), and re-point `REPO`/`BRANCH` constants to the integration worktree/branch. Also: the runner
forbids installs, so `pnpm install --frozen-lockfile` (adds `@clerk/*`) must be done in the new worktree beforehand.
Its `not_configured` readiness gate still works because no `DATABASE_URL` is set.

## 15.2 Decision 2 — account/profile control (in scope; corrects §3.3 and §13.1)

**Correction:** the frozen shell has a working `AccountMenu` (`app-shell.tsx` ~893–975, `shell-account-menu`,
`account-menu-panel` in `approved-ui.css`): trigger with initials avatar + name/role, `role="menu"` panel with identity
and theme controls, Escape closes and restores focus to the trigger, outside-pointer dismiss, `aria-haspopup`/
`aria-expanded`, desktop and phone placements. It has **no Sign out and no Settings link** (reference 06 expects
"view profile / account settings" and "log out"; the frozen component map defers both to "after provider-aware logout
is confirmed"). My earlier statement that the shell had no profile code was wrong (my grep errored and I did not
re-run it).

Facts about #120 relevant to it: BE-02 as recorded in the frozen contract inventory (sign-out calls Better Auth only,
`/api/auth/*` is 404 under Clerk) was true of the pre-fix PR; the current head (`9669c46`, commit `38343c5`
"use provider-aware logout controls") makes `settings/ui/sign-out-button.tsx` provider-aware
(`useClerk().signOut()` → `router.replace('/login')`, else `authClient.signOut()`), and the session-cookie check is
provider-aware (`hasProviderSessionCookie`). `ui/redesign-shell-overview` (`28cccb9`) has a shell `SignOutButton`
calling `authClient.signOut()` — **Better-Auth-only; do not port it.**

### Integration design (smallest change that preserves the frozen UI)

1. **One sign-out implementation.** Extract the PR's two sign-out paths from `sign-out-button.tsx` into a shared
   client module (e.g. `useProviderSignOut(provider)` returning `{ signOut, pending, error }`), consumed by both the
   existing Settings `SignOutButton` and the new menu item. Behavior must stay identical to the PR (same
   `/login` replace + refresh, same error text, `Signing out…` state).
2. **Server-selected provider.** `AuthorizedAppShell` (server) passes `authProvider={getAuthProviderName()}` to
   `AppShell` → `AccountMenu`. The client never decides the provider. When the prop is absent (dev-preview, design-system
   reference, tests) the menu renders **without** a sign-out item (so no `useClerk` outside a `ClerkProvider`).
3. **Clerk mounted only in Clerk mode.** The Clerk hook lives in a child component rendered only when
   `authProvider === 'CLERK'`, exactly like the PR's Settings split, so `useClerk` is never called without a provider.
4. **Menu additions, nothing else changed:** a `role="menuitem"` link "Account settings" → `/settings` preserving the
   current context query (tabs are local state in `SettingsWorkspace`, so no deep-link to the Account tab exists —
   do not invent one), and a `role="menuitem"` "Sign out" button. Same CSS tokens/classes; no new visual language.
   Keep the existing Escape/outside-dismiss/focus code; add: arrow-key/Home/End movement between menuitems only if the
   frozen component already does (it currently focuses the panel, so keep that — do not widen scope).
5. **No new auth surface in the shell:** no password/MFA/social/delete controls (frozen finish-line F4-05).

### Verification list (post-integration; each needs evidence)

| Check | How | Queue |
| --- | --- | --- |
| Profile navigation: "Account settings" opens `/settings` with context kept; no other links | DOM + route assertion | extend `product-shell`/`shell-consistency` (Q1, synthetic-fixture provider omitted ⇒ link only) + `settings` (Q3) |
| Sign-out, Better Auth: session cookie cleared, lands on `/login`, back button does not restore product UI | `settings` "signs out from Account" analogue from the menu | Q3 |
| Sign-out, Clerk: `useClerk().signOut()` called, `__session` cleared, lands on `/login` | **No automated path exists** — manual on a Clerk test instance (owner-provided keys) or a unit test with a mocked `useClerk` | Q5 gap |
| Protected-route denial after sign-out | request `/settings`, `/daily-operations` with no cookie ⇒ signed-out shell/redirect; with the *other* provider's cookie name ⇒ still signed-out (`session-cookie.test.ts` already covers the predicate) | Q3 + existing unit |
| Responsive | 320 / 390 / 803 / 1440, light/dark; trigger does not collide with the one-row phone header or the More drawer | Q4 screenshot diff vs `screenshots-20d` |
| Keyboard | Enter/Space opens, focus moves into panel, Tab order includes the new items, Escape closes and **returns focus to the trigger**; activating "Account settings" closes the menu | new focused assertions in `shell-consistency`/`product-shell` |
| Focus restoration after a failed sign-out | error text announced (`role="alert"`), focus not lost | unit/e2e with forced failure |
| Modal scroll lock + phone inputs (carry-over) | dialog from Staff/Settings and the lock step-up: body locked/unlocked; inputs ≥ 16 px on phone | Q1 `acceptance-quality`/`ui-polish` + manual on the new auth screens |
| Null email truthful | Settings fixture with `email: null` ⇒ "No email provided" (PR) and no empty identity row in the menu | Q3 `settings` |

## 15.3 Decision 3 — development-only route denial (approved for the future integration branch only)

Scope approved: `/dev-preview/**`, `/design-system`, `/design-system/entry`. Do not change the frozen branch now.
**Supersedes §12.4** (which proposed a `next.config` rewrite; per your instruction I did not assume it).

### Current state by route (frozen tree; from code, no build was run)

| Route | Guard today | Predicate | Test today |
| --- | --- | --- | --- |
| `/dev-preview` + 5 sub-pages | layout only (`notFound()` unless `NODE_ENV === 'development'`); pages unguarded | fail-closed | none |
| `/dev-preview/scenario/[name]`, `/dev-preview/api/my-shift` | per-handler 404 before any data/cookie | fail-closed | none |
| `/design-system`, `/design-system/entry` | per-page `notFound()` via `isDesignSystemReferenceAvailable()` | `NODE_ENV !== 'production'` — **fail-open** if `next start` is ever run with `NODE_ENV` set to e.g. `test` | `availability.test.ts` (pure predicate) |
| Production navigation | no link to either prefix anywhere in `src` (only a README mention) | — | none |

### Options considered

| Option | Verdict |
| --- | --- |
| A. `next.config` `rewrites()` to a missing path | Works in principle, but it is a third copy of the predicate, evaluated at config time, and its behavior for the bare path/RSC requests is unverified here. Test can only assert config *shape*. **Not chosen.** |
| B. Deny in `src/proxy.ts` | Runs on every request and the file is PR #120/Codex-owned security code (Clerk loop-prevention logic). Coupling a UI-preview concern into it is the wrong ownership. **Not chosen** (fallback only if per-route guards prove insufficient). |
| C. **Per-route guard from one shared predicate** (the pattern `/design-system` already uses), enforced by a structural test | **Chosen.** Runs in the leaf page/handler itself, so it cannot be skipped by layout partial-rendering; consistent with the codebase; fully unit-testable; `notFound()` in a page bakes a static 404 into `next build`. |

### Minimal change set (proposal; apply only on the integration branch after the release gates)

1. One predicate, fail-closed: `isDevOnlySurfaceAvailable(nodeEnv = process.env.NODE_ENV) => nodeEnv === 'development'`
   (e.g. extend `design-system/reference/availability.ts` or a tiny shared module; `/design-system` switches to it —
   a one-line tightening of the current `!== 'production'`; update the `'test' → true` expectation in
   `availability.test.ts` accordingly. Playwright and the isolated runner run `next dev`, i.e. `development`, so
   `accessibility.spec.ts` (which opens `/design-system`) and `screenshot-matrix` (`/dev-preview`) are unaffected.)
2. Call it at the top of the **six `/dev-preview` pages** (keep the layout guard as defence in depth); handlers already
   do the equivalent check — point them at the shared predicate.
3. No `next.config`/proxy change.

### Required tests (all four requirements covered)

| Requirement | Test |
| --- | --- |
| Production build denies direct requests | **CI step in the existing runtime-role job** (it already runs `pnpm build` + `pnpm start` as production): `curl` each of `/dev-preview`, `/dev-preview/attendant`, `/dev-preview/scenarios`, `/dev-preview/valuation`, `/dev-preview/valuation/revaluations/x`, `/dev-preview/valuation/streams/x/y`, `/dev-preview/scenario/normal`, `/dev-preview/api/my-shift`, `/design-system`, `/design-system/entry` → expect HTTP 404, **no `set-cookie` header**, body not containing "SAMPLE DATA". This is the only check that proves the built server. Local equivalent (not run): `next build` then `next start` on a spare port in a clean env. |
| Handlers cannot expose synthetic data in production | vitest: `vi.stubEnv('NODE_ENV','production')`; `GET` of both handlers returns 404, empty body, no `set-cookie`; layout and each page component throws the Next not-found error (iterate the page files so a new page cannot be skipped). |
| Dev previews still work in the isolated local environment | same vitest with `NODE_ENV=development`: handlers 302/200 with expected shape; plus the existing Playwright coverage that runs under `next dev` (`screenshot-matrix` → `/dev-preview?scenario=normal`, `accessibility` → `/design-system`) via the isolated runner. |
| No production navigation exposes these routes | vitest over `navigation.ts` / `navigation-projection.ts` (every href/key, for every permission combination the projection tests already enumerate) asserting none starts with `/dev-preview` or `/design-system`; plus a structural scan of `src/**` outside the two prefixes for string literals linking to them (currently only a README line). |
| Regression guard | structural test: every `page.tsx`/`route.ts` under `src/app/dev-preview` and `src/app/design-system` references the shared predicate (fails when someone adds an unguarded route). |

## 15.4 Integration rules checklist (from your note) mapped to evidence

| Rule | Where it is enforced / verified |
| --- | --- |
| Start only from the final security-approved PR #120 SHA | §4 step 1; re-run §9 dry run on that SHA |
| Preserve the frontend control-room layout | §3.1: take the frontend file verbatim, re-apply the 6 Clerk items |
| Reapply Clerk step-up, error propagation, server-gated lock exactly | §3.1 invariants + §13.7 post-merge diff check (blocks must diff clean against the PR; lock button exactly once) |
| Preserve both the PR visibility guard and the frontend `Shifts` assertion | §3.2 |
| Verify auth-aware shell, Staff, Settings, logout, modal lock, phone inputs | §15.2 table + Q1–Q4 |
| Rerun the real merge dry run on Codex's final candidate | §9 command; expect §6 files only |

## 15.5 Remaining open items (not owner questions)

- Final PR #120 SHA (blocked on Gate 2A / 0028): re-run the `merge-tree` dry run and §3 review of any new files.
- Clerk-mode sign-out has no automated e2e; evidence will be manual unless Codex provides a Clerk test instance.
- The integrated runner copy needs `AUTH_PROVIDER=BETTER_AUTH` (15.1) — create it only on the integration branch.

---

# 16. Provisional integration workspace (2026-10-12, round 4) — NOT acceptance

Authorised: an isolated, disposable local integration workspace. Gate 2A / migration 0028 / the final security-approved SHA are
still Codex's. **Nothing here is integrated acceptance.** Nothing was committed, pushed, merged into main, deployed, or run
against production or any shared database. Frozen branch, Codex's worktree, `AGENTS.md`, the original runner
(`run-queue.sh`, SHA-256 `d5a55982…`) and all frozen evidence are untouched.

## 16.1 Where things are

| What | Where |
| --- | --- |
| Integration prep worktree (PR head `9669c46` + frozen `9012567`, uncommitted merge, changes staged) | `~/1TheStudio/1The Studio/shanda-fuel-integration-prep` (branch `integration/prep-fe9012567-pr120-9669c46`) |
| Baseline worktree (plain PR head, no frontend) — for telling integration failures from PR/environment failures | `…/shanda-fuel-integration-baseline` |
| Rehearsal on the newer PR head `4ef3c72` (see 16.5) | `…/shanda-fuel-integration-cand-4ef3c72` |
| Kit: scripts, patches, new runner, DB helpers, evidence, README | `…/shanda-fuel-integration-prep-kit/` (**start with its `README.md`**) |

All three worktrees are disposable (`git worktree remove --force`). The kit is outside every repo so it does not trip
prettier/eslint and survives deleting the worktrees.

## 16.2 What is reusable once Codex gives the final SHA

`reapply.sh <final-sha> <new-dir>` rebuilds everything: new worktree from the final SHA, merges `9012567` without committing,
asserts the conflict set is exactly the two known files (stops otherwise), re-applies the Clerk step-up pieces **from the
final PR's own file** (`apply_clerk_stepup.py`, asserts on drift), applies four patches, runs
`verify-integration-invariants.sh`. **Determinism proven:** replaying onto `9669c46` gave a git tree identical to the hand-built
prep tree. It also ran cleanly on the newer head `4ef3c72` (same two conflicts, all invariants hold).

Provisional changes (ledger in the kit README): C1 control room (frontend file + PR Clerk step-up + `data-shift-id`),
C2 reconciliation E2E (PR visibility guard + frontend `Shifts` assertion; row located by `data-shift-id`), C3 account menu
(approved visual base + Account settings + provider-aware Sign out, provider chosen server-side), C4/C5 fail-closed
dev-only routes (`NODE_ENV === 'development'` for `/dev-preview/**`, `/design-system`, `/design-system/entry`) with
discovery-based tests, C6 production-server route probe (+ CI step), C7 two new DB-free specs (`account-menu`,
`business-day-lock`). `src/proxy.ts`, the root layout, API routes, platform, identity/staff/settings code and migrations are
untouched (checked by the invariant script).

## 16.3 Results on `9669c46` + frontend (Mac, Node 26, TZ forced UTC; provisional)

| Check | Result |
| --- | --- |
| format / lint / typecheck / unit | pass; unit 99 files, 768 tests |
| Integration (fresh DB) | 119 passed, 23 skipped (CI-equivalent) |
| Runtime-role proof, `next build`, `next start` | pass |
| **Production route probe** (`/dev-preview/**`, `/design-system*`; GET/POST/HEAD) | all 404, no `Set-Cookie`, no redirect/JSON, no synthetic content; same probe against a dev server fails (negative control) |
| Runner phase `ui` (17 DB-free specs) | 146 passed, 0 failed, 0 skipped |
| Runner phase `new` | 12 passed (account-menu 8, business-day-lock 4) |
| Runner phase `screenshots` | 4 passed; 30 images captured (not yet diffed against `screenshots-20d`) |
| Runner phase `auth` (`auth-entry`, `login-mfa`) | passes when quiet, **timing-flaky here**; plain PR head also flaked (1 of 3 runs) |
| Runner phase `db` | management-reporting 5/5, production-reconciliation 4/4, settings 7/7 (incl. sign-out), **staff-management red** |

## 16.4 Findings that change what you should expect

1. **`staff-management` is red on the plain PR head too** (2 of 2 baseline runs; fails at different steps) — not caused by the
   integration; Codex's new commits rewrite the Staff panel and this spec, so it must be judged on the final SHA.
2. **The frozen UI broke one DB-gated spec's assumptions** (`production-reconciliation` located the shift row by raw id, and
   the old heading). These specs never ran against the frontend (no DB there). Fixed by C2; no visual change.
3. **Pre-existing axe finding in the approved `AccountMenu`** (critical, `aria-required-children`: `role="menu"` contains the
   theme radio inputs). Not introduced here; needs a frontend-owner decision. The new spec excludes only that rule.
4. **Environment traps worth knowing:** Mac timezone (CAT) breaks 3 integration tests unless `TZ=UTC` + UTC database; `next dev`
   cold compiles caused spurious 30 s timeouts in DB specs (fixed in the new runner with warm-up + 90 s timeout, not retries).
5. **404s of denied preview routes still contain the route's `<title>` in the RSC payload** (route name only). Optional hardening.
6. **PR #120's root layout imports `ClerkProvider` statically**, shipping the Clerk SDK on every page even in Better Auth mode.
   Perf note for Codex.
7. **Decision 8 coverage:** exactly-one lock action (step-up required → one disabled button + step-up form; satisfied → one
   enabled button; no permission → none), server-gated refusal changes nothing — all in `business-day-lock`; Clerk step-up
   integrity is verified by source (ClerkStepUpForm identical to the PR's, mounted once, conditional on the server-detected
   provider, `clerk_error` propagated). **Not automatable:** the live Clerk reverification and Clerk sign-out — manual on a Clerk
   test instance.

## 16.5 Newer PR head noticed: `4ef3c72`

While working, origin's PR #120 head moved from `9669c46` to `4ef3c72` ("complete Clerk staff revocation step-up flow", migration
0028, +20 files incl. Staff panel, step-up route, provider revocation). PR checks: quality, runtime-role, audit, secret scan,
SAST pass; **two Vercel deployment checks fail** (merge state UNSTABLE) — so I treat it as a candidate, not the final approved
SHA. Dry run against it: same two conflicts. `reapply.sh` rehearsal on it succeeded and all invariants hold; the evidence pass
on it is in the kit (`logs/cand/`, see README for the outcome). Still waiting for Codex to declare the final SHA.

---

# 17. Integrated candidate (2026-10-12, round 5) — supersedes §16.3/§16.5 numbers

**Candidate (local, not pushed): `4a9f89e515bb730dd9ccf63d29c7c5667264df80`** on branch `integration/cand-fe9012567-pr120-4ef3c72`
(worktree `shanda-fuel-integration-cand-4ef3c72`): a merge of PR #120 `4ef3c72` and the frozen frontend `9012567`, tree clean, replay of the
kit's `reapply.sh` reproduces the identical git tree. **Full report, PASS/FAIL/SKIP matrix, baseline-vs-integration table, security-route and
fixture probe results, Clerk-coverage limits and blockers:** `~/1TheStudio/1The Studio/shanda-fuel-integration-prep-kit/FINAL_INTEGRATION_REPORT.md`.

Headline: static gates, 798 unit tests, 119 integration tests, runtime-role proof, production build, the dev-only-route probe (incl. `/foundation`) and the
new navigation-fixture probe all pass; the frontend's 17 DB-free UI specs pass 146/146; the 2 new specs pass 12/12; `management-reporting`,
`production-reconciliation` and `settings` pass in every database run; `staff-management` is unreliable (click-before-hydration race) on the plain PR head and on the
integrated tree alike; `login-mfa` is order-sensitive in the DB-less phase (passes alone 6/6 on both). Open: Vercel deployment checks fail on PR head `4ef3c72`;
live Clerk reverification/sign-out is manual-only; the approved AccountMenu has a pre-existing critical axe finding.
Adopted from the other agents: sign-out unit test, `/foundation` coverage, runner safety (`.env*` refusal, unreviewed-spec halt, PROV/FINAL labels).
Hardened in this round: the synthetic E2E navigation fixture is now fail-closed (development + `APP_ENV=test` + non-Vercel + loopback `APP_URL`), with unit tests and a production-server probe.

---

# 18. Phase 1 urgent fixes (2026-10-12) — integration HEAD now `06d5814061da9c70cd0c27faf7d5b3522336b6a1`

AccountMenu accessibility fixed (non-modal labelled dialog disclosure; axe clean light/dark, no rules disabled); station-switch bug fixed
(nav links kept the old station after a switch); mobile station-context spec added; evidence and blockers in
`~/1TheStudio/1The Studio/shanda-fuel-integration-prep-kit/PHASE1_REPORT.md`. Clerk Development sign-out unverified (no keys). No Codex handoff yet.

---

# 19. Combined candidate with Codex's backend repair (2026-10-12)

**`8df6e76bde1080eb791213a81ee023f2011a472d`** (local; frontend candidate `06d5814` + Codex `e00763f` + 3 test-only fixes). Full matrix, baselines, the defects found in
Codex's commit and the hosted-CI plan: `~/1TheStudio/1The Studio/shanda-fuel-integration-prep-kit/COMBINED_CANDIDATE_REPORT.md`. Not pushed; hosted CI not run.
