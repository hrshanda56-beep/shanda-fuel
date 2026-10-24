# E2E failure classification (lane codex/v1-provable)

Date: 2026-10-23. Base: 737b8ae (Clerk-only). Local run only: `next dev` on
127.0.0.1:3300, `APP_ENV=test`, throwaway PostgreSQL database
`shanda_fuel_provable` (migrated with `db:migrate:test`, not seeded), 3
workers, `--timeout=30000`. No real Clerk instance was available, so
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` were syntactically
valid **placeholders** (`pk_live_...`, `sk_live_...`) that make the server start
but cannot authenticate against Clerk. CI has not been run.

## Totals (357 tests discovered)

| Run | passed | failed | skipped | did not run |
| --- | --- | --- | --- | --- |
| Baseline (before spec fixes, DB not migrated) | 260 | 91 | 6 | 21 |
| Final full run (after spec fixes, DB migrated) | 322 | 27 | 8 (2 are new `test.fixme`) | 21 |

Three further specs were fixed after that full run and verified individually
(A11 entry x2, reports unauthenticated x1), so the current expectation is
325 passed / 24 failed in this environment. The "21 did not run" are tests that
depend on a failed serial authenticated setup (Clerk users). Skips are skips,
not passes.

## Category key

- **A** needs real Clerk test instance and users (`sk_test_` key, `E2E_CLERK_USERS`),
  or fails only because of the placeholder Clerk keys. Cannot be fixed here.
- **B** stale spec expectation. Fixed in this lane unless stated.
- **C** real product defect. Not patched (UI is locked); evidence given.
- **U** unresolved: spec and UI disagree, needs a follow-up that reads the
  current UI flow; not guessed.

## Root cause found for most "stale" failures

Fixture pages (`x-shanda-e2e-navigation-fixture: synthetic`) render server-side
without a session, but the client context selector then calls `/api/context`,
which has no fixture bypass and returns 401 without a Clerk session; the shell
then `router.replace('/login')`. Specs that did not mock `/api/context` raced
that redirect. Fix: `tests/e2e/fixtures/context-route.ts` (`mockEmptyWorkContext`)
applied to smoke, a3, a12, accessibility, my-shift, daily-reconciliation,
a11-daily-operations, pr144 (/foundation), and unauthenticated reports.
The reported smoke "Demo user" expectation is NOT stale: `/foundation` still
renders "Good morning, Demo user"; it failed only because of this redirect.

## Fixed (category B)

| Spec | Cause | Change |
| --- | --- | --- |
| smoke (2), a3-forecourt (3), a12-valuation (3), accessibility (2), my-shift (13), daily-reconciliation (1), a11-daily-operations (2), management-reporting "unauthenticated" (1) | `/api/context` 401 redirect | mock context |
| acceptance-quality:296 | tablet drawer dialog is now named "Navigation" | accept `More` or `Navigation` |
| cash-workspace (4) | ambiguous locators (dialog close button matches name substring); "Cash" combobox ambiguous; conflict copy changed to "The cash collection is stale." + "Update and keep my details" | `exact: true`, regex name, new wording |
| product-shell:53 | Suppliers is now a collapsed nav group (button) | expect button |
| shell-consistency:82 | tablet rail control is "Expand menu" | updated |
| auth-entry invite-existing (20) | state renders `LoginForm invited`, heading "Sign in to join your workspace" | updated |
| auth-entry:81 | label is "Email or Staff Number" | updated |
| auth-entry:97, :124 | legacy Better Auth endpoint `/api/auth/sign-in/email` no longer exists | `test.fixme` (reported as skipped) |

## Still failing in the final run

| Spec | Category | Evidence |
| --- | --- | --- |
| management-reporting:83 (station filter) | A | `Authenticated E2E requires a dedicated Clerk development instance (sk_test_ key)` |
| production-reconciliation:311 | A | same error |
| settings:97 | A | same error |
| setup-readiness:108 | A | same error |
| staff-management:194 | A | same error |
| login-mfa:16, :99 | A | Clerk sign-in against placeholder instance; timeouts |
| account-menu:162, :168 (Clerk sign out) | A | Clerk sign-out against placeholder instance; timeouts |
| pr144-final-ui:60, :79 (console hygiene) | A (+C candidate) | console contains Clerk "unable to attribute this request to an instance" (placeholder key). It also logs `Creating a worker from 'blob:...' violates ... script-src ... worker-src not set`: clerk-js creates a blob worker which the CSP blocks. This will likely persist with real keys: candidate C (CSP needs `worker-src 'self' blob:` or equivalent), unverified without real Clerk. |
| mobile-station-context:118, product-shell:294 | A (harness) | Next dev error overlay (`nextjs-portal`) intercepts pointer events after Clerk console errors; click times out. |
| auth-entry login/invite-existing at 390px axe, product-shell:429 (sign-in tablet axe) | C | axe `color-contrast` (serious): `<button class="entry-link">Forgot your password?</button>` on the login form. Locked UI (`design-system/entry`, globals.css). Needs a contrast fix by the UI owner. |
| data-filled-screens:78 (390px axe) | C | axe `color-contrast` on `.shell-context-pill-label` ("Sample station") in the shell context pill at 390px. Locked UI. |
| overview-shell:352 | U (flaky) | passes when run alone, fails under load: `.state-error` not found within timeout. Needs timing review. |
| provider-settlements:153, :233 | U | spec expects button "Confirm reconciliation" and text "Reconciled"; neither string exists in `src` any more (settlement UI was reworded). Needs rewrite against the new flow. |
| ui-polish:504 (320px, 390px) | U | `Provider settlement reconciliation` list does not contain `ZSW-2026-09-20-000123456789`; same settlement UI drift. |
| ui-polish:587, :593 | U | waits for link "Open guided workflow" and sidebar link "Reports"; navigation changed to groups. Needs spec update. |

## Not run (21) and skipped (8)

- 21 did not run: serial authenticated suites behind the Clerk setup failures
  (management-reporting, production-reconciliation, settings, setup-readiness,
  staff-management). Category A.
- Skipped: owner-demo (2, opt-in env), screenshot-matrix (4, opt-in), and the
  authenticated-suite skips; plus the 2 new `test.fixme` in auth-entry.

## Cherry-pick review

`fcb317d` is already in this base as `08ae7b9` (conflicts only). Applied:
`640f433` (staff reload hydration wait). Not applied (conflict heavily with
Clerk-only code, or non-test): `42f8228`, `956ecb6`, `06f8274`, `f3f7de4`,
`26b579a`. Their stabilisation ideas (hydration waits, dev warm-up) were not
needed once the `/api/context` race was fixed; revisit only if flakes persist.

## To reach a fully green E2E

1. Add GitHub secret `CLERK_TEST_SECRET_KEY` and variable `CLERK_TEST_PUBLISHABLE_KEY`
   (`sk_test_` / `pk_test_` of a dedicated development instance), create the
   users in `E2E_CLERK_USERS`, then re-run category A.
2. UI owner: contrast of `.entry-link` and `.shell-context-pill-label`; decide
   CSP `worker-src` for clerk-js.
3. Rewrite the provider-settlement and ui-polish navigation expectations (U).
