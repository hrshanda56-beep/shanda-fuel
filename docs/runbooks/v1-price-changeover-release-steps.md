# Release steps: price changeover and delivery reason (migrations 0078 and 0079)

**Written for:** the person who runs the production release (the owner, or the operator they name).
**Status:** draft. Nothing here has been run. No production system was contacted. No secret appears in this file.

This is a short extra for [`v1-migration-and-release.md`](v1-migration-and-release.md), which stays the
main runbook (ground rules, restore point, rollback, release record). Follow that file's section 4 in
order; this file only says what is special about these two migrations.

## What the two migrations do

- **0078 `price_changeover`.** The rule that two prices for one fuel may not overlap now covers only
  prices that are in use (ACTIVE). Drafts and pending prices can sit beside the price in use. A price in
  use may have its end date set once, and nothing else about it may change. It drops and recreates the
  `selling_prices_effective_no_overlap` constraint and replaces the shared trigger function
  `app.reject_authoritative_forecourt_mutation`, which other forecourt tables (for example
  reconciliation revisions) also use. Their rules are unchanged; the integration tests cover them.
- **0079 `delivery_no_po_reason`.** Adds two nullable columns to `fuel_deliveries`: `no_po_reason` and
  `no_po_note`. Nothing is dropped or rewritten.

Neither migration changes existing rows. Both are forward-only (no down-migration).

## Behaviour that changes the day the new app is live

- A fuel delivery cannot be confirmed unless it is linked to a purchase order or carries a reason.
  Deliveries confirmed before the release are untouched. Tell staff before go-live.
- Prices can be changed from `/operations/daily/price-change`. The new price starts at the earliest
  pump-meter reading taken for the change. Finance at TEI Oils has **not** confirmed this rule; get
  that confirmation before the first real price change.

## Order

1. **Merge first.** The release commit must be a commit on `main` that has passed review and CI.
   Record its full SHA. Do not migrate from the `halfway` branch.
2. **Read production's migration state** (runbook section 4, step 2). Note the count and the last tag.
   `main` ends at 0077 and the merge commit at 0079, so everything from production's last tag up to
   0079 is applied together, in order. Do not skip the older ones.
3. **Take and record the restore point** (runbook section 4, step 3).
4. **Check the files.** From a clean checkout of the release commit run
   `shasum -a 256 src/platform/db/migrations/0078_price_changeover.sql src/platform/db/migrations/0079_delivery_no_po_reason.sql`
   and compare with runbook section 6. A mismatch means stop.
5. **Apply** with `pnpm db:migrate` through the reviewed operator flow. `DATABASE_DIRECT_URL` is typed at
   the hidden prompt and never pasted into chat, a file or a command line.
6. **Verify** (read-only):
   - the migration table has 65 rows and the last tag is `0079_delivery_no_po_reason`;
   - `app.fuel_deliveries` has `no_po_reason` and `no_po_note`;
   - the `selling_prices_effective_no_overlap` constraint exists and its definition ends with
     `WHERE (state = 'ACTIVE')`;
   - RLS is still forced on `selling_prices` and `fuel_deliveries`, and `app_runtime` owns nothing.
7. **Deploy** the web app at the release commit only after step 6 passes, then smoke test as the real
   owner on `https://fuel.shandahr.com`.

## First live use

Browser tests for the new screen have not been run (no Clerk test keys on the development machine).
Before the first real price change, open `/operations/daily/price-change` as the owner on a phone-width
screen and walk one price through on a quiet day, with the pumps' meters to hand.
