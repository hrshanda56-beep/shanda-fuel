# Past-day entry ("Record a past day")

Status: design, 2026-11-22. Nothing built yet. Needs a migration (not applied anywhere).

## Why
Stations need to enter figures for days that already happened: history at go-live, or days nobody closed. Today every date and time comes from the server clock, and closing uses the current selling price, so this cannot be done.

## What the live code does (checked in the repo)
- `openBusinessDayFromRequest` (`src/modules/forecourt/commands.ts`) derives the business date from the server clock.
- `runShiftLifecycleCommand` stamps `opened_at`, `meter_closed_at`, `completed_at` from `serverNow()`. `StartShift` also refuses to open a shift before its scheduled time.
- The shift record is the per-shift reconciliation (`production-reconciliation.ts`): meter readings, payments, cash, expenses, dips, deliveries. Its meter-reading step only accepts a selling price whose state is `ACTIVE` now, not the price in force on the day.
- Shifts may not overlap (`app.shift_schedule_conflict`).

## Approach
Reuse the live rules; do not copy them. A past day is a normal business day and shifts whose date and times come from a chosen date, not the clock, tagged as a late entry.

1. **Schema (one migration):** `stations.go_live_date date`; `station_business_days.entered_late boolean not null default false`, `entered_late_by uuid`, `entered_late_at timestamptz`. RLS and audit follow existing patterns.
2. **Command `OpenPastBusinessDay`:** date, station, business day id. Rules: date is before today in station time; on or after the go-live date; within the window (suggested 90 days); not already present; the previous day (if any) is closed or locked. Creates the day OPEN, tagged late.
3. **Shifts for that day:** created from the active shift templates at the template times for that date, stamped `opened_at` = planned start and `completed_at` = planned end unless the person supplies real times. No overlap by construction.
4. **Price on the date:** one helper `priceInForceAt(station, product, instant)` using `effective_from`/`effective_to`. The reconciliation reading step accepts the price in force at the shift start for a late-entry day.
5. **Who may enter:** supervisors for the last 7 days; owner and admin for anything older, within the window. A late-entry tag is shown on the day and in the activity log.
6. **Screen:** a wizard step "Record a past day": pick the date (a grid of missing days since go-live), then the same one-question-at-a-time steps as a live day, ending on the review screen.
7. **Locking:** the existing day lock; an owner-only "lock all back-entered days" action.

## Out of scope for the first slice
Dips, deliveries and payment totals are entered through the same existing steps. Customer, supplier and expense history are not backfilled (opening balances cover the starting position).

## Open points
- Window length and who enters: defaults above unless the owner says otherwise.
- Whether a shift closed late the next morning should block the next shift: separate decision, see PR #287.

## Tests planned
Unit: date rules, price-in-force lookup, window and role checks. Database: opening a past day, shift stamping, overlap refusal, price-on-date reconciliation, tenant isolation, late-entry tag.

## Progress
- Slice 1 (this branch): migration 0120, date rules, `OpenPastBusinessDay` command, tests. A past day can be opened and is tagged late.
- Slice 2: shift times and meter-close stamping from the shift schedule for late days; price and meter installation looked up as of the day.
- Slice 3: the "Record a past day" wizard and the missing-days list; go-live date setting.
