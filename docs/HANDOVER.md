# Handover: Audit #2 pass

Branch `fixtures`, worktree `.worktrees/fixtures`. Nothing is committed, pushed or deployed. Production was not contacted. The row-by-row account is in `docs/AUDIT2.md`; the reasons behind each judgement call are in `docs/DECISIONS.md` ("Audit #2 judgement calls"); the running log is `docs/PROGRESS.md`.

## What changed, in plain words

- **The same number is the same everywhere.** Operating profit is one calculation (staff fuel is posted on the day it happens, and the days add up to the period), and a test compares the dashboard, the profit statement and Daily Profit. The dashboard has one period control (Today by default) and every tile says which period or "As at" time it covers. Fixed costs follow one rule on every screen. Cash is counted in exactly five places that add up to what was collected. Money shows as cents on screen, in inputs and in Excel.
- **A missing report is found.** The dashboard now counts days with no submitted report from go-live to yesterday, per expected shift, using the organisation's "late after" setting, including gaps outside the selected period.
- **Closing the day is safe.** The last shift of a day cannot be submitted without a dip for every tank (Tank dips is now its own step), and a day cannot be locked while any report is waiting, sent back, or a tank has no dip. The button shows the reason.
- **Shifts cannot be duplicated or overlapped** (database guard, migration 0092), and a station cannot go live holding stock that has no cost.
- **Banking reaches "Banked".** Confirming a deposit takes the bank date and a reason when the amount differs; the status reads "Banked with difference" in that case.
- **New roles:** Auditor, Area manager, Cash collector (`docs/ROLES.md`).
- **Guardrails that will stay:** the data invariants (`modules/invariants`), the cross-company route sweep, the banned-words copy check, the cross-screen profit test, and the role parity test.
- **Wording:** the lock note, "Waiting for management approval", the Activity Log area names, stock cost instead of "valuation streams", and one rule for opening a day (opening the first shift opens it).

## Migrations added (all additive, none applied to production)

| Migration | What it does |
| --- | --- |
| 0092 shift_no_duplicates_or_overlap | One shift per template per day, no overlap, by trigger on new rows only |
| 0093 deposit_confirmation_details | `bank_date`, `confirmation_reason` on bank deposits |
| 0094 extra_roles | Auditor, Area manager, Cash collector and their grants |

0090 and 0091 (earlier work, station attendants) and 0089 are also uncommitted. Production migrations are explicit operations; run them in order and verify the state independently of any deploy.

## Checks run

Lint, format and typecheck are clean. The full integration suite passed on a fresh database (all new tests included). The unit suite passes except the UI-lock test, which fails by design because locked UI files changed; it needs the manifest rebaselined with the owner's sign-off. Not run: `pnpm test:e2e` and `pnpm test:a11y` (they need Clerk test keys), and a production build was not re-run after the last changes.

## Not done, and why

Listed in full in `docs/AUDIT2.md`. The big ones:

- **TEI Oils seed and `reset-demo` (section E) are built** (`bash scripts/demo/reset-demo.sh`, about two minutes, database `shanda_fuel_tei`). Still to do on top of it: the full cross-screen suite (G1), the all-routes browser crawl at 390 and 1440 px (G2), the golden-path browser test (G4), the end-to-end purchasing check (D6) and the screenshots. Next only runs one dev server per project, so to look at TEI Oils stop the usual one and start the app with the `DATABASE_URL` lines printed at the end of `reset-demo`. No fuel deliveries are seeded.
- Alerts bell and daily digest (D1), pump tests and meter rollover (D3), customer vehicles and drivers (D4), the staff shortage ledger (D7), PDF and Excel of the per-shift report (D8), custody location pickers and receiver confirmation (C7), stock and invoice linking (B2).
- Page speed (F6): on the 30-day TEI data a warm dashboard loads in about 0.5 s for Today and This month. Earlier 5 s and 17 s readings were development-server compilation. Confirm on a preview deployment with a real sign-in.

## Known limitations and findings

- The Clerk "secret key is invalid" error on every page is a local key mismatch (a publishable key from one instance, a secret key from another). The app now names it plainly; the fix is to put matching keys in `.env.local` (`docs/OPERATIONS.md`).
- The code and the database's permission lists differ for a few permissions (for example `cash.collection.record`); the app authorises from the code. Recorded in `docs/ROLES.md`.
- `src/app/api/forecourt/commands/route.ts` still has a `TEMP-DEBUG` console line, and these files hold local-only dev sign-in changes that must not be committed: `docs/DECISIONS.md` (its Audit #2 section is meant to ship; the rest of the diff predates this work), `src/app/login/page.tsx`, `src/design-system/entry/session-cookie.ts`, `src/platform/auth/provider.ts`, `src/proxy.ts`, `src/app/api/dev-login/`, `src/app/dev-login/`, `src/platform/auth/dev-bypass.ts`.
- A timing flake was seen once in `security-step-up.test.ts` (passes alone and on rerun).

## Open questions for TEI Oils

1. Should CSV and PDF exports also show money at two decimals (today only screens, inputs and Excel do)?
2. Should an invoice be required to link to a delivery (and a delivery to an invoice) before payment, or only flagged?
3. Which stations does each area manager cover, and who are the cash collectors?
4. What threshold should "cash unbanked after X days" and "expense above Y" use for alerts?
