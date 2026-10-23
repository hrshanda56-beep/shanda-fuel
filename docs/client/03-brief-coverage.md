# Your 22-section brief: where each part stands

**Written for:** the owner of TEI Oils. No technical knowledge is needed.

**Important limit on this table.** Our working audit numbers brief sections S2 to S20 and groups some
of them. Section 1, sections 21 and 22, and the exact titles were not in the project files we used.
Rows marked **UNVERIFIED** must be matched to your brief by the developer before this is sent.
The audit was done by reading the code, not by running the full test suite; the pass counts we quote
from the project notes are unverified. The end-to-end browser tests are currently failing (77 of 357
in the last count) and need test accounts before we can prove the whole flow works.

Status words: **Built** (in the app now, tested at the unit/database level), **Being built now**,
**Waiting on your decision**, **Not in v1**.

| Brief section | Topic | Status | What is done / what is missing |
| --- | --- | --- | --- |
| S1 | UNVERIFIED (title not in project files) | UNVERIFIED | Developer to fill in |
| S2 | Multiple stations and businesses | Built | Several stations and legal entities, separated from each other by the database |
| S3 | Roles, sign-in, audit trail | Built | Five roles, name and time on every change. Full role-by-role table still to be reviewed by you (see file 05) |
| S4 | Daily reconciliation | Built | Meters, attendants, supervisor, variance reasons, submit, approve, post, lock. "Submit blocked until a reason is given" is not confirmed |
| S5 | Payment methods | Built | All eight methods with expected vs accounted |
| S6 | Cash and banking | Being built now | Collections, handovers, counts, deposits and slips exist. Missing: the statuses "held by management" and "fully banked", compulsory deposit proof, confirmation that a shortage must give a reason |
| S7 | Card / EcoCash settlements | Being built now | Batches, fees, allocations exist. Missing: "awaiting" and "overdue" statuses aligned to the brief |
| S8 | Fuel purchases | Being built now | Invoices, landed cost, due date and status exist. Missing: cash-or-credit flag, credit period that sets the due date, reminders, invoice upload on the purchase screens |
| S9 | Supplier payments | Being built now | Instalments, multi-invoice payments, statements, credit limit exist. Missing: due in 7/14/30 days view. Proof-of-payment upload waits on your decision |
| S10 | Deliveries | Being built now | Supplier, transporter, driver, truck, note vs actual, before/after dips, one seal, photo exist. Missing: compartments, seals per compartment, water test, driver confirmation |
| S11 | Tank dips and stock | Built | Dips, calibration charts, expected stock, variance. Exact green/yellow/red cut-offs not confirmed |
| S12 | Fuel cost | Built | Weighted-average landed cost, cost of fuel sold, revaluation |
| S13 | Customer accounts | Being built now | Credit and prepaid, limit enforced, ledger, statement exist. Missing: vehicle, driver, voucher, approver, document on each transaction, manager limit override. Ageing and "staff benefit" wait on your decision |
| S14 | Expenses | Built | Expenses, receipts, corrections, fixed costs turned into daily amounts |
| S15 | Profit | Being built now | Gross margin and income statement exist. Missing: one daily view of gross profit minus expenses minus fixed-cost share, per fuel and combined. Per-litre and diesel/petrol split to be confirmed |
| S16 | Financial position | Being built now | Net position exists (cash not banked, card awaiting, debtors, creditors, prepaid). Missing: stock value, bank balance, unpaid expenses, other liabilities, positive/negative flag |
| S17 | Dashboard and reports | Being built now | Dashboard and 17 reports with CSV/PDF/Excel exist. Missing: finance tiles, filters by shift/fuel/supplier/customer/employee/payment method, a few dedicated reports. Sales by attendant and customer ageing wait on your decision |
| S18 | Alerts and controls | Being built now | Many alerts exist (late report, cash shortage, tank variance, reorder, provider overdue, supplier due and overdue). Missing: unbanked cash, customer overdue, over-limit, high expense, below-price sale, change to approved data, delivery shortage. Email delivery is off and waits on your decision |
| S19 | Approvals and locking | Built | Attendant, supervisor, management, lock; reversals; audit trail |
| S20 | Mobile use, offline, backups | Waiting on your decision | Phone layouts and photo upload built; daily report can be saved on the phone and sent later. Cash counts and handovers offline: not built, we recommend not in v1. Backups are a manual procedure today; a scheduled backup is part of release preparation. Offline and photo upload have never been tried in a real browser by us |
| S21 | UNVERIFIED | UNVERIFIED | Developer to fill in. Likely covers rollout items (data load, training); see below |
| S22 | UNVERIFIED | UNVERIFIED | Developer to fill in |

## Not in version 1 (already agreed)
- The link to the ShandaHR staff system.
- Currencies other than US dollars.
- Offline entry of cash counts and handovers (unless you tell us otherwise; file 05).

## Rollout work that is not software
Loading your opening data, training staff, the user test (UAT) and a one-week shadow run beside your
current paper and Excel process are planned but not yet done. Drafts exist for the test and training
plan. Releasing to the live system is done by you or with you; nothing goes live without your approval.

## Honest summary
Roughly three quarters of the first-version list is in the app. The estimate comes from reading the
code and is **UNVERIFIED** until the full test suites are run. The largest remaining gap is the
owner-facing layer: profit, financial position and dashboard tiles.
