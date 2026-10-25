# Brief gap audit — 2026-10-25

Audit of `origin/main` (`a3a769f`) against the TEI Oils brief and the owner's sample material (the
paper reconciliation form, the Excel Daily Report, the owner's paper financial position and a
WhatsApp shift message for 21/10/26). Read-only audit first, then the gaps that carry no open
product decision were closed on branch `codex/v1-audit-gaps-20261025`. Production was not contacted.

## Closed on this branch

- **Stock variance after approval.** The reconciliation record subtracted the litres sold a second
  time once the day was approved (sale stock movements are posted on approval, so they were already
  inside the expected stock). Submit-time checks were correct; the displayed figure was not. Fixed in
  `production-reconciliation.ts` `loadMetrics`; regression assertion in
  `tests/integration/a5-production-reconciliation.test.ts` (fails on the old code, passes on the new).
  Not fixed: for an old approved day the expected stock still includes movements after that day
  (see "Still open").
- **Three new reports** (CSV, Excel and PDF through the existing export route): Station Daily Report
  (per station and day: diesel and petrol litres, sales, cost and gross profit, then expenses, fixed
  costs, operating profit and notes), Sales by Day, Week and Month, and Stock Variances (green,
  yellow, red). Checked against real approved data in the A5 integration test.
- **Customer Debtors Ageing had no page.** The report was in the catalogue but `/reports/customer-ageing`
  had no route file, so it opened the wrong view. Added. A guard test now fails if any table report
  has no route.
- **WhatsApp shift message check** at `/operations/daily/check-message`. It reads the supervisor's
  message, shows the figures and flags what does not add up. It saves nothing. Applied to the 21/10
  sample it finds: diesel pump A1 off by 0.01 L (782.46 worked, 782.45 written), expenses listing 121
  against a written total of 8369, petrol tank 20.32 L short and diesel tank 38.58 L over (assuming no
  delivery). `src/modules/forecourt/shift-message.ts`.

## Closed after the owner's answers (2026-10-25)

The owner approved edits to the locked screens and answered the open questions: bank balance both
typed in and from deposits, keep revisions (no reversal commands), leave staff-benefit cost for now,
the 20 L tolerance placeholder is fine, and every tank must always be visible.

- **Tank dips on the daily sheet.** Every active tank at the station is listed, with "No dip yet" or
  "No allowed difference set" where that applies, the dip on the sheet, the difference against the
  books and a green, yellow or red mark. A supervisor types the dipstick reading in millimetres (or
  litres where the tank has no millimetre chart); it is saved and linked to the day in one step while
  the day is a draft or returned. `daily-tank-dips.tsx`, and `tanks` added to the reconciliation record.
- **Tanks never disappear from Stock Variances.** A tank with no dip in the chosen dates still gets a
  line saying so.
- **Link to the message check** from the daily screen.
- **Bank balance, both ways.** Migration `0072_bank_balance_statements` (append-only, tenant RLS,
  the app role can only insert and read), the `RecordBankBalance` command and a "Bank balances" card
  under Settings, Payments. The financial position uses the typed balance once every active account
  has one, and the deposits recorded in the chosen dates until then. It never counts both.
- **Fuel stock by station and fuel** on the financial position, as on the owner's paper sheet.
- **Transporters.** No new record: a transporter set up as a supplier is counted under "Owed to
  suppliers". Other creditors are still not recorded.

Decisions recorded here, not in `DECISIONS.md` (the owner gave them in chat; they should be copied
there before release): both bank balance sources; revisions stay and no reversal commands; staff-benefit
cost deferred; tank tolerance placeholder accepted; all tanks always visible; transporters as suppliers.

## Still open

- **Migration `0072` is new and applied nowhere.** It needs the same explicit, reviewed production
  migration as the others.
- **Dip time.** A dip saved on the daily sheet is stamped with the time it is saved. If it is saved
  after midnight, the station-date no longer matches the day's sheet and the server refuses it with
  an explanation; the supervisor then has to use the dip form on the inventory screen with the
  right time. Not changed.
- **Dipstick chart units.** The millimetre entry only works for a tank whose calibration chart is in
  `mm`. Other tanks fall back to litres.
- **Bank balances are entered from Settings, Payments** with the first station in the list as the
  authority context, so the person needs finance rights at that station.
- Alert emails (ADR-020 review, DNS, owner go-ahead), scheduled backups, first-user provisioning,
  production migrations, training and UAT, offline behaviour on a real phone, and a browser test of
  the new screens (the e2e suite needs the Clerk test secrets).
- Loading history: no import exists, and the workbook itself is needed.
- Stock variance for an old approved day uses all movements up to the dip time, so later movements
  can distort a day looked at weeks later (sale movements are stamped at the end of the meter
  segment, which can fall after the dip).
- Migration numbers are not contiguous and Drizzle snapshots stop at 0022, so `drizzle-kit generate`
  and `check` do not see later migrations.
- Not done on purpose: the supplier credit limit stays warn-only and a below-price sale stays
  flagged (DEC-045); no reversal of an approved reconciliation or a bank deposit; staff-benefit cost.

## Checks run

Typecheck, lint, prettier, unit suite (219 files, 1,550 tests) and `next build` pass. Integration suite
(44 files passed, 7 skipped on purpose; 334 tests passed, 45 skipped) on a fresh local PostgreSQL 18
with migration 0072 applied. The browser suite was not run: it needs the Clerk test secrets, so the
new screens have not been opened in a browser.
