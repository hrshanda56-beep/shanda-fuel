# Pilot-readiness fixes

Branch `fix/pilot-readiness`. One commit per item. Nothing was pushed, merged or deployed, and production was never contacted. All checks ran against a throwaway local database.

**Migrations added (all unapplied to production):** 0080 supplier document files, 0081 expense payment method, 0082 tank red variance limit, 0083 provider account fees. Production is also still missing 0073 to 0079. Applying them is a separate, explicit operator step.

**Not possible here:** the Playwright end-to-end run and any browser check. There are no Clerk test keys on this machine and no browser was driven. See "Acceptance test" at the end.

## Priority 0

### 1. Station "Setting up" and activation

- Stations still being set up now show in the selector with a "Setting up" badge and can be chosen, so setup can be finished from the station.
- Readiness lists what is missing with a "Fix this" link each, and an Activate button once it can be activated.
- Files: `modules/context/*`, `design-system/context-selector.tsx`, `modules/setup/*`, `modules/forecourt/commands.ts`, `modules/settings/*`, `app/settings/page.tsx`.
- Tests: `tests/integration/phase0-station-activation.test.ts`, `modules/setup/readiness.test.ts`.
- Decision: activation needs at least one shift and a time zone, not the fixed 06:00/18:00 schedule. Opening stock is not required.

### 2. Edit staff

- New `UpdateStaffAssignment` command and an "Edit access" dialog. It needs a fresh identity check and writes an audit event.
- Server rules: you cannot edit yourself, only an owner can change owners or admins, and the last owner is protected.
- Files: `modules/staff/*`, `app/api/staff/commands/route.ts`, `modules/settings/ui/staff-panel.tsx`.
- Tests: `modules/staff/commands.test.ts`. No migration was needed.

### 3. Open shift

- After the first shift opens, the screen goes to the daily workspace. When a shift cannot be opened, it says why and links to readiness.
- Files: `modules/forecourt/ui/operations-control-room.tsx`. Test: `shift-prerequisite.test.tsx`.

### 4. Supplier invoice posting queue

- The supplier page shows the amount "Waiting to be posted". The queue itself already existed.
- File: `modules/creditors/ui/supplier-detail-workspace.tsx`.

### 5. Record delivery without a purchase order

- New one-page Record delivery form (supplier, note, litres received, dips before and after, compartments and seals, water test, driver confirmation). A failed step can be retried without repeating the saved ones. Shortage or excess is shown as you type.
- Files: `modules/deliveries/ui/record-delivery.tsx`, `modules/deliveries/record-delivery.ts`, `queries.ts`, `ui/deliveries-list.tsx`.
- Tests: `modules/deliveries/record-delivery.test.ts`.

### 6. Purchase order, single approver

- The person who sent an order may approve it only when nobody else could. The detail page says "You sent this order, so someone else has to approve it".
- Files: `modules/purchasing/*`. Test: integration case in `purchasing-orders.test.ts`.

### 7. Opening stock

- One form records the litres and the cost per litre together. No reorder alert is raised before opening stock exists.
- Files: `inventory-workspace.tsx`, `approvals/operations-facts.ts`, `operations-alerts.ts`.

### 8. Approvals inbox

- Expenses awaiting approval appear in the inbox. Credit-limit changes are applied directly (no pending state), so there is nothing to queue for them.
- Files: `approvals/document-approval-facts.ts`, `action-center-model.ts`.

## Priority 1

### 9. Step-up reuse

- A fresh identity check is reused for `STEP_UP_REUSE_MINUTES` (default 15). A fresh sign-in counts as one. The dialog does a silent check first.
- Decision: the assertion is no longer bound to one action. It stays tied to the organisation and to time.
- Files: `modules/identity/step-up.ts`, `platform/security/session.ts`, `platform/auth/clerk-step-up.ts`, `platform/env.ts`.
- Tests: `tests/integration/security-step-up.test.ts` (expiry test now uses 16 minutes; a flaky tamper test was fixed).

### 10. STEP_UP_REQUIRED and visible refusals

- New error code `STEP_UP_REQUIRED` (HTTP 403), so the screen can tell "verify again" from "not allowed". Read pages treat it like a refusal via `isAccessRefusal`. Every 403, 409 and 422 message is shown as a toast.
- Files: `platform/errors/index.ts`, `platform/security/permissions.ts`, `design-system/feedback-provider.tsx`, several read paths and tests.

### 11. Atomic Add Customer

- `CreateCustomerWithAccount` creates the customer and the account in one command, so a half-created customer cannot remain.
- Files: `modules/customers/*`, `add-customer.tsx`. Test: `customers-server-verification.test.ts`.

### 12. Supplier invoice form

- Delivery picker, required fuel type, landed-cost preview (invoice price plus transport), file attachments (migration 0080).
- Decision: landed cost is previewed, not posted automatically. ADR-018 says supplier invoices do not touch inventory, and an existing test enforces it. The cost is recorded through the existing receipt-cost command.
- Files: `modules/creditors/*`, `modules/documents/*`. Tests: `landed-cost-preview`, documents integration test.

### 13. Expense form

- "Paid with" (till cash, EcoCash, bank, and so on), migration 0081. A staff-fuel category is hidden and refused on the server (staff fuel is a benefit, not an expense). Station cash expenses reduce "cash to collect".
- Decision: an expense reduces cash to collect only when it is entered outside a shift sheet, and only since the last collection.
- Tests: `tests/integration/expense-payment-method.test.ts`.

### 14. Tanks

- Red variance limit per tank (migration 0082) with a `SetTankVarianceLimits` command, a tank detail page at `/inventory/tanks/<id>`, and calibration upload that skips a header row.
- Tests: `tests/integration/tank-limits-and-detail.test.ts`.

### 15. Provider account fees

- Fee percent and fixed fee per payment account (migration 0083). Settlements show the expected charge and the difference from what was taken.
- Tests: `tests/integration/settlement-account-fees.test.ts`, `settlements/domain` unit tests.

### 16. Prices

- A price change can have a planned start, and the price history is shown. The station time zone is used, never the browser's.
- Decision: the planned start is informational. The meter-reading boundary still sets the real start (DEC-050). The below-price-sale flag already existed as an alert.
- Tests: `tests/integration/price-history-and-planned-start.test.ts`.

### 17. Bank balances

- The panel refreshes after a change, and payments ask for a company, not a station.

### 18. Cash statuses

- Added the "Collected" status and the label "Still at the station". Confirming a deposit already required the slip.

### 19. Credit customers

- The ageing report shows "falls due" and "Overdue" columns, based on credit days. Credit-limit messages tell the user to ask a manager.
- Files: `customers/ageing.ts`, `customers/queries.ts`.

### 20. Staff fuel benefit

- Creating a staff benefit account uses the atomic customer command. The staff page lists staff records only.

## Priority 2

### 21. Session refresh and sign-out

- Commands refresh an expired session once and retry. Sign-out redirects to `/login`.
- Files: `design-system/session-refresh.ts`, `feedback-provider.tsx`, sign-out buttons.

### 22. Customer page refetch

- The customer page loads the new data before it shows the success message.

### 23. Supplier credit-limit placeholder

- Shows "Currently <limit>" or "No limit set".

### 24. Fuel name cleared

- The fuel name field in guided setup is now a controlled field.

### 25. Activity log names

- The activity log shows names (stations, products, people, customers, suppliers) instead of identifiers, and old and new names for renames. Tests in `audit-view.test.ts` and `audit-viewer.test.ts`.

### 26. Add Customer on All stations

- On All stations a company picker opens first. Test: `company-choice` unit test.

### 27. Open supplier and Open full account

- Both now navigate explicitly with `router.push`. This is defensive: I could not reproduce the original problem without a browser.

### 28. Report filters and exports

- Excel and PDF downloads on every statement. The debtors ageing report can be filtered by customer.

### 29. Dashboard

- New tiles: litres sold per fuel (diesel and petrol shown separately), cash expected against cash collected with the difference, stock variance over measured tanks, and days without an approved report. The "not available yet" note is gone.
- Unknown is shown as "Not available", never zero: a tank without a dip reading is left out of the stock variance.
- One management report now feeds both the money tiles and the new snapshot.
- Files: `modules/reporting/dashboard-snapshot.ts`, `modules/dashboard/queries.ts`, `app/_overview/today-overview.tsx`. Tests: `dashboard-snapshot.test.ts`.
- Decision: "reports not submitted" counts station days in the selected range that have activity but no approved report. It is not the 14-day late-report alert.

### 30. Offline drafts

- Already present before this work: installable app (manifest), a service worker that shows an offline page and caches no data, a local draft and a send-later queue for the daily report.
- Added: the Record delivery form keeps a draft on the device (24 hours), offers it back, and clears it once the delivery is recorded.
- Decision: drafts stay in `localStorage`, as DEC-045 recorded, not IndexedDB. The data is a few short text fields. Queuing submissions for other forms is not done: the daily report is the only queued workflow, because queued replays need idempotency and version handling per command.
- Test: `modules/deliveries/delivery-draft.test.ts`.

## Acceptance test

The scenario (one company and station, Diesel 1.95, Petrol 1.96, opening stock, a delivery with a 17 L shortage, an invoice at 1.78 plus 0.02 transport, a duplicate reference rejected, a shift, sales, an expense and its approval, a reversal, cash collection and banking) was **not** run as a single Playwright flow. Playwright needs Clerk test users, which are not available here. Each step is covered by its own automated test instead: delivery shortage and no-PO reason, invoice duplicate reference and posting, shift and reconciliation, expense approval, reversal, cash collection and deposit, and the new items above. A single end-to-end spec still needs to be written and run in CI where the Clerk test keys exist.

## Checks

See the final summary for the results of the last full run (typecheck, lint, format, unit, integration, `db:check`).
