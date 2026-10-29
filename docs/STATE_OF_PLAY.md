# State of play: code verification (hardening pass)

Basis: branch `fixtures`, origin/main `81168380`, checked 2026-10-29 by reading source, migrations and tests. Docs were not relied on. No product code was changed. Claims marked "inferred" were read from code but not executed.

## 1. Gate baseline

| Gate | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm format:check` | Pass |
| `pnpm db:check` | Pass |
| `pnpm test:unit` | Pass: 245 files, 1724 tests |
| `pnpm test:integration` (CI-equivalent roles, throwaway PG18) | Pass: 52 files, 375 tests |
| `pnpm build` | Pass |
| Integration, intentional skips | 7 files, 45 tests: finance-read-performance, first-user-role-preflight-pg18, first-owner-provisioning, navigation-context-snapshot, first-user-provisioning, navigation-read-budget, unified-expense-versions. Opt-in (extra flags or fixture IDs). Skipped, not passed. |
| `pnpm test:e2e`, `pnpm test:a11y` | Not run. Need Clerk `sk_test_` keys and `E2E_CLERK_USERS`. Skipped, not passed. |
| Browser walk | Not yet done |

Note: a first integration run failed because the harness used the restricted `app_runtime` role. CI uses a superuser URL and `migration_owner` ownership of the migration metadata. This was a harness mismatch (AGENTS.md 10.1), not a product defect.

## 2. Works and tested

- Sale price comes only from the active selling-price table; DB check forces litres x price (`reconciliation_meter_readings_sales_value_ck`, 0005). Selling prices are immutable once ACTIVE (0003).
- Credit-limit, missing-customer, wrong-account-type and prepaid-overdraw refusals when reconciliation payments are saved (`production-reconciliation.ts` `assertPaymentReferences`; `tests/integration/payment-references.test.ts`).
- Credit-limit override: permissioned, approver-checked, append-only (0061; `customer-account-controls.test.ts`).
- Negative stock blocked by DB trigger (`inventory_movements_negative_guard`, 0004; `a4-inventory.test.ts`).
- Tank variance colours (`approvals/operations-alerts.ts`; `operations-alerts.test.ts`).
- Reconciliation immutability after submit/approve/lock (triggers 0005, 0003, 0078; `a3-forecourt.test.ts:406-470`, `a5` returned-revision flow).
- Audit log append-only at DB level (RLS with no update/delete policy, REVOKE; `a1-isolation.test.ts:412-480`); rows HMAC-signed.
- Meter reset/replace/correct require reason, open day and shift, and write audit events (`a3-forecourt.test.ts`).
- Landed cost divides by litres received (`landed-cost.test.ts`); shortage = actual - note enforced by DB check (0004); WAC replayed from ledger (`costing/domain.test.ts`, `a12-costing.test.ts`); late-cost revaluation append-only and audited.
- Supplier credit terms (due date rules) in server and DB (`credit-terms.test.ts`, `supplier-credit-terms.test.ts`); payment allocation sum limits by deferred DB trigger (`a7-supplier-creditors.test.ts:68`); due status and buckets tested.
- Cash: collected is never counted as banked (`status.test.ts`); handover receiver differs from deliverer (`cash-handover.test.ts`); deposit confirmation needs a slip (`a6-cash-banking.test.ts:270`).
- Provider settlement status, fee and variance (`settlements/*.test.ts`, `a9-provider-settlements.test.ts`).
- Dashboard shows unavailable, not zero (`finance-tiles.test.ts`, `dashboard-snapshot.test.ts`).
- Offline outbox ordering, dedupe, resume, conflict and reject handling (`outbox.test.ts`, `local-draft.test.ts`).
- Auth: every route authenticates itself, then runs in a tenant transaction with RLS settings (`tenancy/authority.ts`, `platform/db/transaction.ts`). Cron route uses constant-time bearer check. Upload routes validate size, type and magic bytes. Rate limit covers all mutating routes in staging/production. Dev-only routes 404 outside development.

## 3. Works but untested (add tests in Phase B)

- Reconciliation maths in `loadMetrics`: covered only by integration tests; the unit-tested `daily-reconciliation.ts` is not in the production path. No pure formula test.
- Server throw for closing < opening on the reconciliation meter path (only UI message tested).
- Expected closing stock formula: one test.
- Inactive or suspended account, and station-scope refusal on the reconciliation payment path.
- Duplicate supplier invoice, duplicate payment reference, duplicate deposit and collection reference (DB constraints exist, no rejection tests).
- XLSX and PDF export responses (only CSV has a route test; no test opens the XLSX; no test that export totals equal on-screen totals).
- Audit rows for supplier payment, expense approval and revaluation (exist in code, not asserted).
- Cross-tenant tests missing for: inventory, production reconciliation, supplier creditors, opening balances, opening cost per litre, staff commands, settings commands, report export. No test drives HTTP routes with two tenants.
- Stock is not double-subtracted for account/benefit fuel (true by code: only METER_SEGMENT_SALE moves stock; no explicit test).
- `/owner-demo` proxy gate (e2e only, no unit test); route-level upload stream cap.

## 4. Candidate defects (to triage with the owner)

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| D1 | P1 | Customer credit/prepaid drawdown is not wired to the reconciliation sale path. The ledger is written only by `CompleteCustomerFuelTransaction`, which nothing in the UI or reconciliation approve/post path calls. Limit checks read only the ledger, so unposted sales are not counted and several days could exceed a limit (inferred). | `customers/persistence.ts:994-1030`; no ledger insert under `forecourt/` or `revenue/` |
| D2 | P1 | `createDelivery` accepts client-supplied unit and total landed cost with no server recomputation. | `inventory/commands.ts:143-150` |
| D3 | P1 | Cash collection can be received by the person who recorded it (no check). Handovers do have the check. | `cash/persistence.ts:278` |
| D4 | P2 | Opening meter reading is client-supplied on the reconciliation path and not checked against the previous closing. | `production-reconciliation.ts` meter save |
| D5 | P2 | Water test requirement is server-code only and default off; deposit slip requirement is server-code only. | `deliveries/domain.ts:236`, `cash/persistence.ts:485` |
| D6 | P2 | `readReceivedNotInvoiced` uses the UTC server date, not the station business date (breaks AGENTS 9.2). | `dashboard/queries.ts` |
| D7 | P2 | Audit rows carry `after` but rarely `before` (forecourt price change, meter reset, reconciliation; creditors, inventory, expenses). | `audit/contracts.ts`; command call sites |
| D8 | P2 | `shifts` and `meter_boundaries` have no column immutability trigger; APPROVED/POSTED reconciliation headers allow non-listed columns (e.g. `version`) to change. | 0003, 0005 |
| D9 | P2 | `GET /api/reports/activity` and `/api/context` do not check a permission code; `/api/context` has no rate limit (unconfirmed). Rate limit is per IP, not per user. | `reporting/report-events.ts:79`, `app/api/context` |
| D10 | P3 | Float arithmetic on money in UI only (display). | `reconciliation-board.tsx`, `expense-workspace.tsx`, `tank-detail.tsx`, others |
| D11 | P3 | PDF export is a plain text dump with no table layout; stale "CSV layout" comment in `reporting/catalog.ts:23`; noisy `[DEBUG-read-latency]` log. | `export-documents.ts` |
| D12 | P3 | Sign-in/sign-out are not audited by the app (Clerk owns them). | `identity/step-up.ts` only |

Each defect gets a failing test first. D1 may be a missing connection of an existing command, which could be new behaviour; it needs the owner's ruling before any change.

## 4b. Second pass: owner said "fix everything" (uncommitted on `fixtures`)

Decisions I made inside that instruction, each small and reversible. Please confirm or reverse.

| ID | Outcome |
| --- | --- |
| D1 | Limit hazard closed. A credit or prepaid sale is now checked against the ledger plus sales waiting in other reconciliations that are not in the ledger yet (`production-reconciliation.ts`). Not done: writing the ledger automatically when a day is posted. The existing design records it with the explicit authorise and complete commands, and no screen calls them. That needs an owner decision on how litres and product are valued. |
| D3 | Fixed. The person who recorded a cash collection cannot receive it (same rule as handovers). Single-person stations must have a second person receive. |
| D4 | Not a defect. Approval already requires each reading to match the sealed segment chain (`segment-sale-chronology.ts`, unit tested). |
| D5 | Water test is an owner switch, default off, by design. Deposit slip is now also enforced by a database trigger (migration 0089). |
| D6 | Fixed. The "received not invoiced" date uses each company's station time zones, latest local date (`latestStationLocalDate`, unit tested). |
| D7 | Mostly done. Audit rows now carry "before" for reconciliation approve, submit and return, cash receive and bank-deposit confirm. Expense approve, reject, post, reverse and correct; supplier document post, return and reverse; supplier credit limit; tank status and variance limits; delivery confirm now carry it too (tests in a6-expenses, a7, a12). Other commands (price change, meter reset, customer and staff changes) still record "after" only. |
| D8 | Shift business date was already guarded. Added migration 0089 triggers: meter boundaries are append-only (price change link excepted) and shifts cannot move station, day or date. Approved reconciliation headers still allow the `version` column to change, on purpose. |
| D9 | `/api/reports/activity` now needs report view permission at some scope. `/api/context` is left alone: it lists only what the signed-in person may already select. |
| D10 | Left. Float use is display only (chart heights, comparisons); nothing stored is computed from it. |
| D11 | Stale comment fixed. The debug log only runs when `APP_ENV` is `local`. PDF stays a plain text layout (a layout redesign is a new build). |
| D12 | Left. Clerk owns sign-in and sign-out (DEC-043). |
| New defect found and fixed | A repeated collection or deposit reference returned a 500. Now 409 with a plain message, and any unique-value database error maps to 409 in the shared error handler. |

New tests: cash receiver rule, repeated references, deposit slip trigger, boundary and shift guards, audit "before" values, pending credit and prepaid, inactive or out-of-scope customer account, lower closing reading refused, activity route permission, cross-tenant commands on cash, customers, suppliers, stock and reconciliations, time zone date, duplicate-value 409.

Gates after this pass: lint, typecheck, format, `db:check`, build pass; unit 1737 pass; integration 387 pass and 45 intentional skips (fresh DB, 53 files). Browser: 19 existing routes return 200 on the seeded dev server (port 3000, the dev-bypass build). The 390px phone check was not possible in this browser (the window will not narrow and iframes are blocked), so it is not done. e2e and a11y still not run (no Clerk test keys).

## 4a. Phase B outcome, first pass (hardening changes made, uncommitted on `fixtures`)

| Item | Result |
| --- | --- |
| D2 landed cost | Fixed. `assertLandedCostPairMatchesLitres` (`inventory/landed-cost.ts`) is called from `createDelivery`: a supplied cost must be complete (unit, total, currency) and total must equal unit x litres received (rounding allowed). Tests: 5 unit tests in `landed-cost.test.ts`; existing costed-delivery integration suites still pass. |
| D3 collection receiver | Not changed. Existing tests record and receive with one person; blocking it is a policy choice (it could lock out single-person stations). Owner decision. |
| D6 UTC date | Not changed. The figure is tenant-wide across stations, so no single station timezone applies. P3. Owner decision. |
| D1, D4, D5, D7, D8, D9 | Not changed. Each would add behaviour, a migration, or a policy; listed for the owner. |
| New tests | XLSX and PDF contents checked cell by cell against the CSV, incl. formula neutralising (`export-documents.test.ts`, +3). Duplicate invoice and payment reference refused for one supplier, allowed for another (`a7-supplier-creditors.test.ts`). Cross-tenant: another tenant cannot submit into this tenant or use its supplier (`a7-supplier-creditors.test.ts`). |

Gates after Phase B: lint, typecheck, format pass; unit 1732 pass; integration 377 pass, 45 intentional skips (fresh DB).

## 5. Not built, needs a decision (no work done)

Meter rollover; pump tests; customer-specific negotiated prices; provisional delivery cost; staff shortage ledger and deductions report; monthly period close; head-office allocation; supplier debit notes and prepayments; write-off entity; accounting journal export; pluggable notification channels and in-app centre; staff CSV import; image compression and sync indicators; session idle timeout; attendant PIN login (conflicts with DEC-043); Super-admin, Area Manager, Cash Collector and Auditor roles; reversal or reopen of locked records (conflicts with locked-stays-locked); authorised vehicle/driver list; separate supervisor confirmation of deliveries; cash float concept; mandatory proof of payment; offline outbox for deliveries, cash, supplier and expense forms; correction of an approved/posted reconciliation.

Needs an owner ruling because semantics are unsettled: staff/benefit fuel is kept in revenue and deducted as cost at selling price (reconciliation path) or at WAC (monthly expense path); the brief says it is not revenue.
