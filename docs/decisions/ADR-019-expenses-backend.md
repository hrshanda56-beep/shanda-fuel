# ADR-019: Expenses backend (recognition, settlement and approval)

- Status: Accepted
- Date: 2026-10-18
- Owner: A6 Commercial (expenses)

## Context

Blueprint section 8.5 and Appendix B define the expense area (`SubmitExpense`, `ApproveExpense`, `PostExpense`, `GenerateRecurringCostPeriod`, `RecognizeRecurringCost`), the rule that an expense is an economic document separate from its settlement source, and the approval defaults in section 11.2 ("Station expense: policy-based; pilot step-up at USD 250, second approval target at USD 1,000"). The Blueprint is silent on several details; AGENTS.md forbids inventing client master data or tax treatment. This ADR records the conservative choices made in migration `0035_expenses`.

## Decision

1. **Own domain.** Expenses live in their own tables. Posting an expense writes only `expense_recognition_movements` (append-only; `RECOGNITION` and `REVERSAL` rows). A settlement (`expense_payments`) records how an obligation was settled and never creates or changes recognition, and the expense module never writes cash, bank, supplier or customer ledgers.
2. **Commands.** Blueprint commands are kept: `SubmitExpense`, `ApproveExpense`, `PostExpense`, `GenerateRecurringCostPeriod`, `RecognizeRecurringCost`. Added where the Blueprint implies them but does not name them: `RejectExpense` (Approval Decision includes Reject), `ReverseExpense` (posted records are corrected only by named reversals, section 11), `RecordExpensePayment` / `ReverseExpensePayment` (recognition vs payment separation), `CreateRecurringCostTemplate`, `ReverseRecurringCostRecognition`, `AdjustRecurringCostRecognition` (append-only correction of a reversed daily recognition), `CreateExpenseCategory`, `SetExpensePolicy`.
3. **State machine.** `SUBMITTED -> APPROVED -> POSTED -> REVERSED`, and `SUBMITTED -> REJECTED`. There is no draft: Blueprint section 12 keeps an expense draft as a limited offline convenience, not a server record. `REJECTED` and `REVERSED` are terminal; a corrected expense is a new submission (its reference is freed by rejection or reversal).
4. **Settlement sources.** `CASH`, `BANK`, `REIMBURSEMENT`. "Payable" is not a settlement: an expense with no settlement is an unpaid payable. A settlement must carry a link to an existing matching cash disbursement (`cash_movement_id`, cash only) or an external reference (voucher, bank reference). The cash module does not yet expose an expense disbursement command; until it does, cash settlements are linked by reference. A settlement cannot exceed the outstanding balance, and a posted expense cannot be reversed while settlements are recorded (reverse them first).
5. **Direct inventory cost.** Categories carry a classification (`OPERATING`, `FIXED_COST`, `DIRECT_INVENTORY_COST`). `DIRECT_INVENTORY_COST` is refused as an expense or recurring cost so landed cost is never deducted twice. Manual expenses require `OPERATING`; recurring costs require `FIXED_COST`. No category is seeded: categories are onboarding data.
6. **Thresholds are configuration, and fail closed.** `expense_policies` (per legal entity) holds `step_up_threshold` and `second_approval_threshold`. With no policy, every approval, posting and settlement requires a current step-up and no second approver is demanded. The Blueprint's 250 / 1,000 are pilot suggestions, not defaults baked into code. Reversals, settlement reversals, recognition reversals and policy changes always require step-up (high-risk permissions). The required approvals are snapshotted on the expense at submission so a later policy change cannot strand or weaken an in-flight expense.
7. **Separation of duties.** The submitter cannot approve their own expense while another active approver exists at the station (the shared solo-operator exception used by reconciliation and costing). Each approver decides once. Self-approval is therefore a function of who exists, not a flag.
8. **Recurring costs.** Template (monthly) -> period obligation (full calendar month, no proration) -> daily recognition -> payment. A period's amount is split exactly: each day gets `amount / days` rounded down to four decimals and the last day takes the remainder, so the schedule always sums to the obligation. Cost cannot be recognized for a future date. A reversed daily recognition is not re-recognizable for the same date; `AdjustRecurringCostRecognition` appends the reversal and a linked corrected recognition instead. Payment of a period is capped at the obligation and never recognizes cost.
9. **No tax, no period lock.** There are no tax fields and no VAT/withholding logic: amounts are gross USD. Closed business-day / reconciliation locking of expense dates is not implemented; expense dates are only refused when more than one day in the future.
10. **Scope.** Expense commands are station scoped (`STATION` authorization scope; legal entity derived from the station). Categories and the policy are legal-entity scoped master data. Permissions: `expense.view|submit|approve|post|reverse|payment.record|payment.reverse|manage|policy.manage|recurring.manage|recurring.recognize`. SUPERVISOR receives `view` and `submit` only; FINANCE everything except `policy.manage`; OWNER and ADMINISTRATOR everything.
11. **Authorization of reads.** `GET /api/expenses/list|summary|reference` require `expense.view` at station or legal-entity scope; PostgreSQL RLS (tenant context plus active membership, forced) backs every table.

## Alternatives considered

- Generating the settlement as a cash/bank movement from the expense module: rejected, it would directly mutate cash ledgers (A6 forbidden modification).
- Hard-coding the 250 / 1,000 pilot thresholds: rejected, the Blueprint calls them configuration.
- Drafts as server rows, tax fields, proration, a universal payment table: rejected as invented scope.

## Consequences

Cash settlement is by reference until the cash module adds an expense disbursement command. Reports can derive operating expense and fixed-cost recognition from `expense_recognition_movements` and payables from posted expenses and recurring periods less recorded settlements. A recurring recognition correction is an append-only adjustment: the original recognition is reversed with its reason and a new linked recognition carries the corrected amount. Accountant/client confirmation still needed: category list, thresholds, whether recurring costs prorate, and tax treatment.

## Affected modules

`src/modules/expenses`, `src/platform/db/schema/expenses.ts`, migrations `0035_expenses.sql`, `0039_expense_attachments.sql`, and `0040_recurring_cost_adjustments.sql` (hand-reviewed security layers after the generated tables, no snapshots, like the other hand-authored deltas), `src/platform/security/permissions.ts`, `/api/expenses/*`.

## Specification impact

Refines implementation only; no locked requirement changed.

## Migration/backward compatibility

Additive. New tables, permission definitions and role grants; no existing object changes. Rollback is dropping the new tables, triggers and permission rows.
