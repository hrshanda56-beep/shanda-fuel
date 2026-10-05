# Shanda Fuel — Master Coding Agent Instructions

> **Legacy supporting prompt; not authoritative.** The repository bootstrap
> authority is [`../../AGENTS.md`](../../AGENTS.md). The canonical knowledge
> base is [`../../docs/PRODUCT_SPEC.md`](../../docs/PRODUCT_SPEC.md),
> [`../../docs/DECISIONS.md`](../../docs/DECISIONS.md),
> [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md),
> [`../../docs/IMPLEMENTATION_PLAN.md`](../../docs/IMPLEMENTATION_PLAN.md),
> and [`../../docs/CURRENT_STATUS.md`](../../docs/CURRENT_STATUS.md). This
> preserved prompt may provide historical implementation detail only; it must
> not override those documents.

## 0. Your role

You are the implementation engineer for **Shanda Fuel**, a commercial multi-tenant SaaS for fuel-station operations, reconciliation, inventory, cash custody, electronic settlements, suppliers, customers, expenses, profitability, approvals, evidence, audit, and reporting.

Your job is to **build the product described by the attached Shanda Fuel specifications**. You are not being asked to redesign the product. The product/domain/UX architecture is already frozen at the logical-design level.

Work autonomously and make normal engineering decisions yourself. Do **not** stop to ask product questions that are already answered by the source documents. Do **not** weaken accounting, security, tenant-isolation, state-machine, or audit invariants for implementation convenience.

The implementation must be suitable for:

- the initial TEI Oils deployment in Zimbabwe;
- one strong developer maintaining the system initially;
- future commercial multi-company rollout;
- weak/intermittent station connectivity;
- mobile-first station operations and desktop-first finance/management work;
- traceable, auditable financial/operational records.

---

# 1. Read these files first, in this order

Treat these files as the canonical implementation context:

1. `AGENTS.md` — bootstrap authority and implementation rules.
2. `docs/PRODUCT_SPEC.md` — canonical product requirements and scope.
3. `docs/DECISIONS.md` — canonical recorded decisions.
4. `docs/ARCHITECTURE.md` — canonical system boundaries and constraints.
5. `docs/IMPLEMENTATION_PLAN.md` — canonical ordering and remaining work.
6. `docs/CURRENT_STATUS.md` — canonical current implementation/release snapshot.
7. Relevant ADRs, runbooks, contracts, tests, code, and preserved detailed reference artifacts.

## 1.1 Decision precedence

When two statements appear to conflict, use this order:

1. confirmed client operating facts and legal/accounting sign-off;
2. explicit integrity/security/accounting invariants in the Master Blueprint;
3. this `AGENTS.md` execution contract;
4. state-machine/database/source-of-truth rules in the Master Blueprint;
5. Wireframe Pack behavior and information architecture;
6. recommended defaults in the setup workbook;
7. ordinary implementation judgment.

A wireframe never overrides an integrity invariant. If a wireframe is inconsistent with the domain/state model, correct the wireframe implementation behavior while preserving the intended UX.

## 1.2 Do not guess business facts

Missing production data such as real bank accounts, tank capacities, calibration points, supplier/customer master data, cash floats, merchant IDs, pilot station, alert thresholds, and opening balances are **onboarding data, not development blockers**.

When such data is unavailable:

- build the data model and setup UI;
- use clearly synthetic fixtures in development/test only;
- never fabricate production values;
- never embed a guessed client-specific value in code;
- keep configurable values effective-dated/audited where the blueprint requires it.

Tax/VAT/statutory invoice treatment is specifically **not to be invented**. Build tax-ready extension points and neutral storage as described, but do not implement a made-up tax engine before accountant/client sign-off.

---

# 2. Product context that must be preserved

## 2.1 Product identity

- Product: **Shanda Fuel**
- Brand family: **Shanda Fuel by ShandaHR**
- Product domain: `fuel.shandahr.com`
- Initial working customer: TEI Oils / Triumph Energy Investments (Pvt) Ltd working identity; exact legal spelling remains onboarding-verifiable.
- Business timezone: **CAT**, represented technically as `Africa/Harare`.
- V1 operating currency: **USD**.
- Shift duration default: **8 hours**, but station shift templates are configurable and effective-dated.
- No broad historical migration. Cutover uses approved opening positions plus selective recent history only when genuinely useful.

Working location seed supplied by the client:

- Sandawana
- Hwange
- Bindura
- Makaha
- Kwekwe
- Kadoma
- Gweru
- Harare
- Mutare
- Masvingo
- Bulawayo

Do not assume every working location is definitely a retail station. Location type/status is confirmed during onboarding.

## 2.2 Product promise

Operational information should be entered once, while physical truth and financial truth remain explicitly distinct where necessary. The same authoritative source data must drive stock, cash custody, provider settlement, customer/supplier balances, profitability, reports, exports, alerts, and audit.

## 2.3 Product principles

- Simple by default.
- Powerful when needed.
- Explicit when risky.
- Exception-first, not dashboard-noise-first.
- No Excel recreation in the UI.
- No hidden business side effects.
- No silent historical mutation.
- No false “success” before authoritative server confirmation.

---

# 3. Non-negotiable domain invariants

These are hard rules. Do not reinterpret them.

## 3.1 Multi-tenancy

- Multi-company SaaS from day one.
- Hierarchy: `Tenant -> Legal Entity -> Station`.
- Every tenant-owned business relationship must be tenant-safe at both database and application layers.
- Tenant A must never be able to read, write, link, export, search, download, or process Tenant B data through application, job, report, storage, or support paths.
- Use composite tenant-aware foreign keys for integrity-bearing relationships.
- PostgreSQL RLS must fail closed when tenant context is absent.

## 3.2 Identity vs membership

- Authentication identity is global.
- Tenant membership is business authorization context.
- Better Auth owns identity/session/authenticator mechanics.
- Shanda Fuel owns memberships, roles, scopes, permissions, approval authority, and business access.
- Owner is a business role, not a database/security bypass.
- Shared user accounts are prohibited.
- Users with historical business activity are disabled, not deleted.

## 3.3 Ledgers and source of truth

Do **not** create a universal `transactions` table.

Authoritative balance-affecting domains remain distinct:

- inventory movement ledger;
- sale recognition ledger;
- cash custody ledger;
- bank movement ledger;
- provider account movement ledger;
- supplier account movement ledger;
- customer credit movement ledger;
- prepaid value movement ledger;
- prepaid litre movement ledger;
- posted expenses and recurring-cost recognition.

Current balance/state tables are **rebuildable projections**, not historical truth.

A projection may be repaired/rebuilt from authoritative movements. Never edit authoritative movements just to make a projection/dashboard match.

## 3.4 Physical forecourt truth

- Ordinary forecourt quantity is meter-derived.
- Meter boundaries create segments.
- Meter segment quantity is derived server-side from confirmed readings.
- Customer credit/prepaid/benefit fuel explains/classifies part of meter-derived fuel; it does **not** create duplicate litres or duplicate revenue.
- Meter reset/replacement/correction is a controlled boundary workflow. Never invent a meter reading.
- A broken/unreadable meter uses an exception/replacement flow.

## 3.5 Delivery vs supplier invoice

- Delivery = physical receipt.
- Supplier invoice = commercial claim.
- Inventory movement = stock/cost effect.
- Supplier account movement = creditor effect.
- Supplier payment = settlement effect.

An invoice must never rewrite accepted physical delivery quantity.

## 3.6 Tank physical vs book stock

- Tank dips are physical observations.
- Inventory Pool is canonical book stock/cost level.
- A physical dip does not directly mutate book stock.
- A variance requires a controlled approved inventory adjustment to change book quantity/value.

## 3.7 Cash, bank, and electronic providers

They are separate domains.

- cash collected != cash banked;
- deposit recorded != bank-confirmed money;
- POS/EcoCash declaration != provider record != provider settlement != bank receipt;
- provider fees are expenses/provider movements, not station shortages;
- cash in transit/dispute is represented exactly once.

## 3.8 Corrections

- Draft/workflow records may be corrected according to state rules.
- Posted/locked economic records are not edited/deleted.
- Correct posted effects with reversal, compensation, approved adjustment, credit note, revaluation, or post-close adjustment as appropriate.
- Distinguish a data-record correction from a real-world external financial reversal.

## 3.9 Approval semantics

Use one consistent vocabulary:

- Draft = editable before formal submission.
- Submit = attest current version/request review.
- Return = send submitted version back for correction.
- Reject = final negative decision on that submitted version.
- Approve = authorize that exact submitted version.
- Post = create official operational/economic effects.
- Lock = stop ordinary historical editing.
- Cancel = stop pre-post workflow.
- Reverse = compensate a posted effect.
- Expire = invalidate a time-limited unfinished process.
- Supersede = replace an old version/request while preserving history.

State transitions must be named commands. Do not implement generic arbitrary status updates.

## 3.10 Time semantics

Persist and use the correct dimensions:

- server timestamps in UTC;
- business timezone `Africa/Harare` for TEI default;
- explicit `business_date`;
- overnight shift belongs to the date it starts;
- effective-dated configuration uses half-open `[from, to)` intervals;
- reporting distinguishes `effective_at/business_date` from `posted_at`;
- report `as_of` means `posted_at <= as_of`.

---

# 4. Locked engineering stack

Use the following architecture unless a package is technically impossible to use. Do not swap frameworks based on preference.

- Next.js 16.x
- Node.js 24 LTS
- TypeScript strict
- Vercel project dedicated to Shanda Fuel
- Neon PostgreSQL
- Drizzle ORM with explicit PostgreSQL schema/migrations
- Better Auth
- Zod
- Tailwind CSS + semantic CSS variables
- Radix primitives + Shanda-owned design-system components
- Lucide icons
- React Hook Form for complex forms; simpler native/server forms where appropriate
- `decimal.js` for application decimal arithmetic
- Cloudflare R2 private object storage
- Resend behind an email adapter
- React PDF for deterministic PDF reports
- ExcelJS for actual XLSX reports
- Vitest
- Playwright
- axe accessibility checks
- IndexedDB/Dexie only for the limited offline-draft use case
- GitHub Actions + Vercel CI/CD
- pnpm

## 4.1 Version policy

- Pin package versions in `package.json`/lockfile.
- Stay within the locked architecture/major family unless there is a documented incompatibility.
- Do not make a major framework switch without explicit architecture approval.
- Security/patch updates may be applied when compatible; record meaningful changes.

## 4.2 Explicit V1 non-choices

Do not introduce these unless later approved:

- microservices;
- GraphQL;
- tRPC;
- Kafka or an external message broker;
- a separate BI warehouse;
- a general ledger/accounting suite;
- OCR/AI posting automation;
- native mobile apps;
- direct browser-to-database access;
- direct browser R2 credentials;
- direct bank integration as a V1 requirement;
- broad offline authoritative transaction processing.

---

# 5. Repository structure

If the repository does not exist, initialize it. If it already exists, first audit it against this required structure and adapt without destroying working code unnecessarily.

Use this structure conceptually:

```text
src/
  app/                         # Next routes/adapters only
  modules/
    tenancy/
    identity/
    authorization/
    stations/
    configuration/
    forecourt/
    pricing/
    tanks/
    inventory/
    deliveries/
    purchasing/
    creditors/
    cash/
    banking/
    settlements/
    customers/
    expenses/
    reconciliation/
    approvals/
    exceptions/
    documents/
    reporting/
    notifications/
    audit/
    onboarding/
  platform/
    db/
    auth/
    storage/
    email/
    jobs/
    security/
    observability/
    idempotency/
  design-system/
  shared/                      # deliberately tiny
```

Each substantial domain module should own, as applicable:

```text
module/
  domain/
  application/
  infrastructure/
  ui/
  schema/
  tests/
  index.ts                     # explicit public API
```

## 5.1 Dependency direction

- UI -> application -> domain.
- Infrastructure implements application/domain ports.
- Domain imports no Next.js/React/Drizzle/R2/Vercel code.
- React components do not query the database directly.
- Cross-module access must use published module contracts.
- Do not import another module's private repository implementation.

---

# 6. PostgreSQL structure and database roles

Use three logical schemas:

- `auth` — Better Auth identity/session/passkey/MFA structures;
- `app` — tenant/business domain;
- `platform` — technical metadata such as permission definitions, idempotency, outbox, jobs, audit key metadata, report definitions.

Recommended DB roles:

- `migration_owner` — schema owner/migrations only;
- `app_runtime` — normal request runtime; no schema ownership, no RLS bypass;
- `job_runtime` — background workers, still tenant-context constrained;
- `diagnostics_readonly` — narrowly controlled diagnostics.

The application runtime must not be database owner and must not be able to disable/alter RLS.

## 6.1 Tenant transaction wrapper

All tenant-owned reads and writes must use a controlled transaction/context wrapper that:

1. authenticates/validates tenant membership before entering business query logic;
2. starts a DB transaction;
3. executes `SET LOCAL app.tenant_id = ...`;
4. executes `SET LOCAL app.user_id = ...`;
5. performs reads/writes under RLS;
6. commits/rolls back atomically.

Missing/invalid context must fail closed.

Worker/job execution must establish the same tenant context from the job/source event. Do not give workers a hidden unrestricted bypass.

## 6.2 Tenant-aware FKs

For tenant-owned integrity relationships, parents expose a unique `(tenant_id, id)` key and children reference `(tenant_id, parent_id)`.

Do not rely only on application checks for cross-tenant relationships.

---

# 7. Numeric, ID, and reference conventions

Use exact database precision:

```text
Money                  NUMERIC(20,4)
Litres/dips             NUMERIC(18,3)
Selling price           NUMERIC(20,6)
Weighted unit cost      NUMERIC(20,8)
Intermediate valuation NUMERIC(24,8)
Ratios                  NUMERIC(18,8)
```

Rules:

- never use binary JS floating-point as authoritative money/quantity arithmetic;
- use `decimal.js` at application/domain boundaries;
- amount without currency is invalid;
- V1 allocation must remain same-currency unless a future explicit FX transaction model exists;
- internal IDs are UUIDv7;
- user-facing references use atomic counters; never `MAX()+1`;
- business documents normally store positive amounts; movement ledgers use signed deltas.

---

# 8. Mutation/command pipeline

Every consequential mutation follows this order:

```text
UI / Server Action / Route Handler
-> authenticate
-> resolve/verify active tenant membership
-> authorize permission + scope
-> validate exact typed DTO with Zod
-> check idempotency where applicable
-> begin tenant DB transaction
-> acquire aggregate/balance locks in deterministic order
-> verify optimistic record version
-> verify current workflow state
-> recheck live approval/security authority
-> execute named application/domain command
-> create/update business records
-> append authoritative movement rows where posting requires them
-> update rebuildable projection(s) transactionally when needed
-> append audit event
-> append outbox event(s)
-> commit
-> return authoritative result
-> UI shows success
```

If any mandatory step fails, rollback the entire command.

Do not partially post money/stock/approval effects.

## 8.1 Idempotency

Use central `idempotency_record` semantics keyed by:

- tenant;
- command type;
- caller-provided/generated idempotency key;
- request hash.

Same key + same request => return previous successful result.

Same key + different request => reject as idempotency mismatch.

Use idempotency for all high-risk/posting flows including payments, deposits, delivery posting, reconciliation posting, reversals, cash transfers, provider settlement effects, and opening positions.

## 8.2 Concurrency

- Use optimistic `version` fields for mutable workflows.
- Use explicit database row locks for balance/aggregate roots.
- Lock multiple roots in deterministic order.
- Treat serialization/deadlock conflicts as retryable when safe.
- Never let two simultaneous customer authorizations both spend the same available credit/prepaid balance.
- Never allow two active overlapping responsible assignments/installations/config versions when constraints say one.

---

# 9. State-machine implementation rules

Implement the named state machines from the Master Blueprint. Do not reduce them to CRUD/status dropdowns.

At minimum support the named command families documented in Appendix B, including:

### Business day / shift

- `OpenBusinessDay`
- `StartShift`
- `CloseMeters`
- `CompleteShift`
- `MarkNotOperated`
- `ExceptionalClose`

### Meter / price

- `ConfirmBoundary`
- `SealSegment`
- `RequestPriceChange`
- `ActivatePriceChange`
- `ReplaceMeter`

### Delivery / inventory

- `RecordArrival`
- `StartDeliveryVerification`
- `BeginOffloading`
- `ResumeOffloading`
- `FinishPartialReceipt`
- `ConfirmDelivery`
- `PostDelivery`
- `SubmitAdjustment`
- `PostAdjustment`
- `DispatchTransfer`
- `ReceiveTransfer`

### Reconciliation

- `CalculateReconciliation`
- `SubmitReconciliation`
- `ReturnReconciliation`
- `ApproveAndPostReconciliation`
- `LockReconciliation`

### Cash / bank

- `CountCash`
- `PrepareHandover`
- `SenderConfirmHandover`
- `ReceiverConfirmHandover`
- `ResolveHandoverDispute`
- `RecordDeposit`
- `ConfirmBankReceipt`

### Provider

- `RecordProviderBatch`
- `MatchProviderBatch`
- `RecordProviderSettlement`
- `ResolveSettlementDifference`

### Supplier

- `SubmitSupplierInvoice`
- `PostSupplierInvoice`
- `SubmitSupplierPayment`
- `PostSupplierPayment`
- `ReverseSupplierPayment`

### Customer

- `AuthorizeCustomerFuel`
- `CompleteCustomerFuel`
- `RecordCustomerPayment`
- `PostCustomerPayment`
- `GenerateCustomerInvoice`

### Expense

- `SubmitExpense`
- `ApproveExpense`
- `PostExpense`
- `GenerateRecurringCostPeriod`
- `RecognizeRecurringCost`

### Cross-cutting

- `CreateApprovalRequest`
- `ApproveStep`
- `ReturnForCorrection`
- `ExecuteReversal`
- `VerifyDocument`
- `GenerateReport`
- `GenerateExport`
- `PostOpeningPositionBatch`

Use more granular internal commands when useful, but do not merge distinct physical/business meanings into a generic update command.

---

# 10. Core business logic that must be exact

## 10.1 Meter sales

For a normal sealed segment:

- litres = confirmed end reading - confirmed start reading;
- a lower end reading is invalid unless a controlled reset/replacement/correction path exists;
- expected sale value uses the effective selling-price version assigned to the segment;
- the server computes and stores authoritative segment quantity/value snapshots;
- client-submitted litres are never authoritative for normal meter sales.

A controlled meter segment closure creates the **operational inventory sale movement immediately** to preserve stock/cost chronology.

Later daily reconciliation approval/posting creates official financial sale/payment/profit classification and must **not recreate the inventory sale movement**.

## 10.2 Price changes

- Old price remains authoritative until server-confirmed activation.
- Mid-shift price activation requires required nozzle/meter boundaries.
- A price change uses an explicit workflow and effective price version.
- No silent retroactive price overwrite.

## 10.3 Deliveries and WAC

- Accepted physical quantity comes from accepted tank allocations at the lowest meaningful level.
- Delivery-note quantity remains the commercial claim.
- Default V1 behavior is to pause affected-product dispensing during offload where operationally possible.
- Partial/interrupted delivery is a first-class workflow.
- Wrong product/contamination can quarantine affected tank/pool.
- Inventory receipt movement quantity/value posts atomically with Inventory Pool state.
- Moving weighted average is perpetual and chronological.
- Late direct/transport/final cost does not rewrite original receipt/sales. Create explicit cost adjustment/revaluation splitting value between remaining inventory and already-consumed COGS.

## 10.4 Cash custody

Expected physical cash conceptually derives from:

```text
opening physical cash
+ cash receipts
- cash disbursements
- confirmed collections
+/- approved adjustments
```

Distinguish cash sales from other cash receipts such as customer debt collection/prepaid top-up.

Handover conservation:

- sender confirmation moves source -> transit;
- receiver agreement moves transit -> receiver;
- disagreement moves transit -> acknowledged receiver amount + dispute custody amount;
- disputed money appears exactly once.

Confirmed cash movements are never edited.

## 10.5 Provider settlement

Expected net = gross - refunds/reversals - provider charges.

Settlement variance = actual bank receipt - expected net.

Provider fees create provider/expense effects and do not become unexplained sales shortage.

## 10.6 Supplier balances

- supplier invoice, delivery, payment, credit note, and account movement are separate entities;
- supplier payment may allocate across multiple invoices;
- partial/unallocated supplier payment is valid;
- payment reversal atomically reverses account movement + allocations and reopens obligations;
- fuel can exist as unbilled supplier exposure before the invoice arrives.

## 10.7 Customer accounts

Keep distinct ledgers/states for:

- credit receivable;
- prepaid value;
- prepaid litres by product;
- benefit/allowance classification as required.

Credit/prepaid authorization must reserve exposure atomically before dispense. Unused reservation releases on completion/cancellation/expiry.

Prepaid litres are product-specific. Do not silently convert diesel litres to petrol litres.

Customer invoice groups existing receivable activity and does not recreate the debt.

## 10.8 Expenses and fixed costs

- economic expense recognition is distinct from payment timing/source;
- direct inventory costs must not also be deducted as operating expense;
- recurring cost template -> period -> daily recognition -> payment allocation;
- payment of recurring cost settles the obligation and never recreates the expense.

## 10.9 Profitability

Canonical V1 operational profitability:

```text
recognized revenue
- inventory COGS
= gross profit

- posted operating expenses
- recurring/fixed cost recognition
= operational profit
```

Profit is not cash.

Do not label this as statutory net profit or a statutory balance sheet.

## 10.10 Operational financial position

Use the blueprint's **Shanda Operational Net Position** concept, including tracked physical cash, tracked bank money, provider receivable, customer receivable, inventory value, supplier/unbilled exposure, operating obligations, and prepaid obligations.

Disclose incomplete-bank-data/data-quality state. Do not claim a true external bank balance when bank feeds are incomplete.

---

# 11. Authentication, authorization, and security

## 11.1 Authentication

Use Better Auth.

Required posture:

- passkey preferred;
- password + TOTP fallback;
- no SMS MFA dependency in V1;
- MFA/passkey required for Owner, Admin, Finance, and Supervisor;
- separate Shanda Fuel session/cookies/secrets from ShandaHR;
- secure HttpOnly cookies, `Secure`, appropriate SameSite;
- membership disable/session security action revokes sessions/grants;
- short-lived step-up authentication for high-risk actions (roughly 10 minutes as architecture default, centralized in configuration);
- recovery flows audited and rate-limited.

## 11.2 Authorization

Use granular permission codes, role templates, and explicit scope (`Tenant`, `Legal Entity`, `Station`).

Never authorize only by checking a role name such as `if user.role === 'OWNER'`.

A role is a bundle; permissions are authoritative.

Seed at least the blueprint roles:

- OWNER
- ADMINISTRATOR
- FINANCE
- SUPERVISOR
- ATTENDANT

Add specialized roles only when a named workflow requires them.

At minimum, permission families should cover:

```text
tenant.view / tenant.manage
legal_entity.view / legal_entity.manage
station.view / station.manage
membership.view / membership.invite / membership.manage / membership.disable
role.view / role.manage
shift.view / shift.start / shift.close / shift.exceptionally_close / shift.mark_not_operated
meter.view / meter.boundary.capture / meter.correction.request / meter.replace
price.view / price.change.request / price.change.approve / price.change.activate
delivery.view / delivery.create / delivery.verify / delivery.offload / delivery.confirm / delivery.post / delivery.reverse
inventory.view / inventory.adjust.request / inventory.adjust.approve / inventory.transfer.dispatch / inventory.transfer.receive
cash.view / cash.count / cash.handover.prepare / cash.handover.confirm / cash.dispute.resolve / cash.collection.create
bank.view / bank.deposit.record / bank.deposit.confirm / bank.account.manage
settlement.view / settlement.batch.record / settlement.match / settlement.confirm
supplier.view / supplier.manage / supplier.invoice.create / supplier.invoice.approve / supplier.payment.create / supplier.payment.approve / supplier.credit_note.create
customer.view / customer.manage / customer.fuel.authorize / customer.limit.override / customer.payment.create
expense.view / expense.create / expense.approve
reconciliation.view / reconciliation.submit / reconciliation.return / reconciliation.approve / reconciliation.post
approval.view / approval.act
exception.view / exception.manage
document.view / document.upload
report.view / report.financial.view / report.export
audit.view
```

If a workflow needs a new capability, add a narrowly named permission code to the centralized permission catalogue. Do not create ad-hoc one-off authorization checks scattered in components.

## 11.3 Approval restrictions

- Self-approval prohibited by default.
- Single-Authority Mode may be supported only as an explicit audited tenant policy.
- Approval policy is snapshotted; current security authority is rechecked live at decision/commit.
- Editing a submitted business record invalidates/supersedes the old approval request and increments record version.
- Orphaned approvals must be reassignable/returned; no stuck workflow.

## 11.4 Sensitive data

- Field-level sensitivity is enforced server-side/serialization-side, not only hidden in the UI.
- Sensitive exports are security events.
- Large exports are private artifacts with short-lived signed download URLs and permission rechecks at request, worker execution, and download.
- Logs redact secrets, credentials, account numbers, and unnecessary sensitive values.
- No session-replay tooling that captures sensitive finance/customer data in V1.

---

# 12. Documents and storage

R2 objects are private.

Support V1 uploads for the approved document classes/formats in the blueprint:

- JPEG/PNG;
- HEIC converted/normalized safely where required;
- PDF treated as untrusted content.

For uploaded evidence:

1. authorize upload intent;
2. issue short-lived scoped upload mechanism;
3. receive into private storage;
4. persist `UPLOADED_UNVERIFIED` document version;
5. verify object exists/size/type/magic/checksum/tenant relationship;
6. only then transition to `AVAILABLE`;
7. rejected/quarantined versions do not satisfy evidence requirements.

Document is a logical identity. Each replacement creates a new immutable `DocumentVersion`/object; do not overwrite evidence in place.

For technical limits not explicitly specified in the blueprint (e.g. upload byte cap), choose a conservative security-oriented default, centralize it in configuration, write it to `docs/technical-defaults.md`, and make it easy to revise. Do not ask the business client to choose purely technical limits.

---

# 13. Audit and security events

## 13.1 Business audit

Consequential actions must record:

- tenant;
- actor type;
- actor membership/user identity where applicable;
- action code;
- resource type/id;
- old/new state or appropriate before/after snapshot;
- reason when required;
- request/correlation ID;
- timestamp;
- signing key ID/algorithm/signature metadata.

Use independent signed/HMAC-authenticated audit events plus periodic tenant checkpoint/root/Merkle-style digest written to retention-protected private R2.

Do not create one global sequential HMAC chain that becomes a concurrency bottleneck.

The runtime must not have ordinary UPDATE/DELETE permission on posted audit events.

## 13.2 Security events

Record appropriate events for login failure, MFA failure, recovery, passkey changes, denied escalation, cross-tenant access denial, sensitive export, support/break-glass access, session revocation, bank-account change, etc.

Keep security events distinct from business audit semantics.

---

# 14. Background jobs and outbox

- One application/database; no external broker required for V1.
- Business transaction writes an `OutboxEvent` in the same DB transaction.
- Outbox processing creates/triggers jobs after commit.
- `OutboxEvent` and `Job` are separate concepts/tables.
- Jobs use leases, attempt counters, retries, `available_at`, terminal failure state, and idempotency/effect keys.
- Promise **at-least-once execution with idempotent effects**, not exactly-once execution.
- Jobs must preserve tenant context and authorization/sensitivity requirements.

Typical jobs include notifications, large report generation, audit checkpoints, scheduled alerts, and projection rebuild/refresh work.

---

# 15. UX implementation contract

The attached Wireframe Pack is the UX implementation reference.

## 15.1 Mobile-first operational UX

Attendant and Supervisor flows are designed for phone/tablet use.

Use mobile bottom navigation:

- Home
- Tasks
- Work
- More

Keep active organisation/station/business-date/shift context obvious.

Attendant UI must remain intentionally minimal. Do not expose management profitability, supplier pricing, or irrelevant configuration.

Supervisor Today is the primary operational cockpit: current shift first, exceptions second, upcoming work/context after that.

## 15.2 Desktop finance/owner UX

Desktop uses a permission-generated sidebar and queue/action-center patterns.

Optimize Finance for resolving queues, matching, deposits, suppliers/customers, settlement differences, and cash position.

Optimize Owner for oversight, approvals, high-priority exceptions, profitability, cash, stock, and drill-down.

## 15.3 Design system rules

- Native/system font stack.
- Tabular numerals for financial values.
- 4px spacing foundation.
- Minimum 44px touch targets.
- Restrained elevation and motion.
- Motion roughly 120–240ms and functional only.
- Light/dark/system support.
- Status is never color-only.
- WCAG 2.2 AA target.
- Strong keyboard/focus behavior on desktop.
- Reduced-motion support.
- Persistent form labels.
- Numeric keyboards on mobile where appropriate.
- Non-ambiguous dates.
- Desktop tables become mobile cards; do not squeeze dense tables onto phones.
- Long forms are pages/steps, not modal stacks.
- Consequence-aware confirmations use descriptive action labels such as `Approve & Post`, not generic `Yes`.
- Empty/loading/error/offline/conflict states are required, not optional polish.

Wireframes specify information architecture, wording, field hierarchy, and primary actions. Final pixel spacing and visual polish can evolve inside the design system without changing domain meaning.

## 15.4 Offline truthfulness

Allowed offline/local work is limited to explicitly safe drafts such as meter draft, dip draft, expense draft, notes, and selected upload queue.

Authoritative actions require online server confirmation, including approval, posting, reversal, price activation, bank changes, supplier payment, and privilege changes.

Never show an authoritative success state from a local-only action.

Local IndexedDB data must be scoped to tenant/user and purged appropriately on logout/offboarding/context change.

---

# 16. Reporting and exports

Use one canonical calculation layer for dashboard, PDF, XLSX, and drill-down. Do not reimplement financial formulas separately in each output path.

A `ReportRun` is distinct from a `ReportArtifact`.

Report identity includes:

- report definition/version;
- period;
- `as_of`;
- exact filters;
- calculation version;
- data-quality state;
- revision/checksum/source snapshot as defined by blueprint.

Historical artifacts are never silently overwritten after later restatement.

PDF and XLSX exports must use the same authoritative server values and filters shown on screen.

Large exports run as private background jobs and require authorization again at download.

---

# 17. Onboarding and migration behavior

Do not block the build waiting for TEI master data.

Build setup/readiness screens that collect:

- station/location type/status;
- shift templates;
- banks;
- POS/EcoCash/payment channels;
- tanks and calibration;
- pumps/nozzles/meters;
- suppliers;
- customers/account types;
- approval policies;
- cash floats;
- variance/reorder thresholds;
- required tax/accounting confirmations;
- opening positions.

Station cannot go live until required configuration passes a server-side readiness validator.

## 17.1 Cutover

No broad transaction-history recreation.

Use a controlled `OpeningPositionBatch` that can post typed opening positions for inventory, cash, bank/provider, supplier, customer credit, prepaid value/litres, and known obligations.

Opening batch must be validated/approved/posted atomically according to the blueprint.

Selective recent closed history may be imported only for reference/comparison when useful and clean. Do not let imported reference history masquerade as authoritative new-ledger movements.

---

# 18. Testing requirements

Tests are part of implementation, not a cleanup phase.

## 18.1 Domain/unit tests

Write domain tests for:

- state-machine transitions and forbidden transitions;
- meter segment arithmetic;
- price segmentation;
- moving WAC;
- delivery variance;
- revaluation split;
- cash conservation;
- provider net/variance;
- supplier allocations/reversal;
- customer credit reservation concurrency;
- prepaid litre product isolation;
- recurring-cost recognition vs payment;
- reconciliation/sale recognition no-double-count rules;
- report as-of logic.

Use property-based tests for arithmetic/conservation rules where practical.

## 18.2 Real PostgreSQL integration tests

Do not mock away critical database behavior.

Use real PostgreSQL/Neon-compatible integration tests for:

- RLS SELECT/INSERT/UPDATE/DELETE;
- composite tenant FKs;
- unique/exclusion constraints;
- transaction-local tenant context;
- balance/root locking behavior;
- idempotency;
- migrations up/down/forward-compatible behavior where applicable;
- projection rebuild consistency.

## 18.3 Tenant-isolation test rule

Every new P1 tenant-owned table must have automated proof that Tenant A cannot access/mutate Tenant B data.

Add a schema manifest/check that causes CI to fail if a tenant-owned table is introduced without a declared module owner/security class/RLS expectation.

## 18.4 E2E / Playwright

Automate the highest-value flows early, not just at the end:

1. sign in / tenant context;
2. supervisor opens day and starts shift;
3. capture opening boundaries;
4. attendant declaration/account fuel path;
5. close shift;
6. reconciliation submit;
7. management approve/post;
8. read report/drill-down;
9. core delivery path;
10. cash handover/deposit path;
11. supplier payment allocation/reversal;
12. customer credit reservation concurrency where testable;
13. permission denial/tenant isolation routes;
14. offline draft persistence and online authoritative submit.

Run axe checks against critical screens.

## 18.5 Minimum acceptance scenarios

The V1 must pass all scenarios in Appendix D of the Master Blueprint, including:

- normal day;
- attendant handover;
- mid-shift price change;
- delivery shortage;
- late transport cost;
- cash dispute;
- partial provider settlement;
- supplier payment reversal;
- concurrent customer credit;
- prepaid litre draw;
- tenant isolation;
- report as-of;
- offline draft;
- opening cutover.

---

# 19. CI/CD and code quality

The default CI pipeline must include at least:

- format check;
- lint;
- TypeScript typecheck;
- unit/domain tests;
- PostgreSQL integration tests;
- RLS/isolation tests;
- migration validation;
- critical Playwright tests;
- production build;
- dependency/security checks appropriate to the stack.

Do not merge/build on a permanently red main branch.

Use feature flags for incomplete/risky features where useful. Disabled features should generally be absent from normal navigation rather than greyed-out everywhere.

Migrations use expand -> migrate/backfill -> switch -> contract-later when a breaking data shape change is required.

---

# 20. Environment and secrets

Maintain strict local/staging/production separation for:

- Neon databases;
- auth secrets/session config;
- R2 buckets/prefix/policies;
- audit signing keys;
- cron/job secrets;
- email credentials;
- integration credentials.

Create a comprehensive `.env.example` containing names/descriptions only, never secrets.

At minimum structure env configuration for:

- app URL/environment;
- database pooled URL and migration/direct URL where needed;
- Better Auth secret/config;
- R2 account/bucket/access credentials for the separated storage classes;
- Resend/email adapter;
- audit signing key ID/material source;
- cron/job authentication secret;
- observability/correlation configuration;
- optional future integration placeholders.

If a real external credential is missing, implement the adapter/interface and safe local/test stub. Do not block unrelated development and do not commit a fake production secret.

---

# 21. Error handling and observability

Use typed application errors and safe UI messages for at least these categories:

- validation/input error;
- forbidden/permission error;
- not found within authorized scope;
- business rule violation;
- optimistic concurrency/version conflict;
- idempotency mismatch;
- retryable database serialization/deadlock conflict;
- external dependency failure;
- internal unexpected failure.

Every request/command should have a correlation/request ID carried into structured logs and audit where appropriate.

Logs must be structured and redacted.

Health/ops diagnostics should cover app/database/jobs/storage/audit-checkpoint/backups at an appropriate level without exposing sensitive tenant data.

---

# 22. Implementation sequence

Do not attempt to build the whole product as a single uncontrolled change. Maintain a green, deployable system as vertical slices are added.

Follow this dependency order:

## Phase 0 — Repository and developer-readiness baseline

Before business features:

1. inspect existing repository if any;
2. initialize/pin pnpm/Node/Next/TypeScript/tooling;
3. establish module structure and import boundaries;
4. configure lint/format/typecheck/tests/CI;
5. create `.env.example`;
6. maintain `docs/CURRENT_STATUS.md`;
7. create `docs/technical-defaults.md` for purely technical defaults not specified by the client;
8. create schema/module security manifest mechanism;
9. establish real PostgreSQL integration test harness;
10. ensure local dev can start with synthetic data only.

## Phase 1 — Foundation

Implement:

- database schemas/roles/migration framework;
- Better Auth identity/session/authenticator foundation;
- Tenant, Legal Entity, Membership;
- roles/permissions/scope assignments;
- station identities and configuration foundation;
- document/document-version pipeline;
- audit events/checkpoint plumbing;
- idempotency registry;
- outbox/jobs foundation;
- RLS across all current tenant tables;
- seed permission definitions and default role templates;
- app shell, mobile nav, desktop sidebar, auth/context flows;
- station setup/readiness skeleton.

Phase 1 is not done until RLS/isolation tests pass.

## Phase 2 — First complete station vertical slice

Implement end to end:

`Business Day -> Shift -> Meter Installation/Boundary/Segment -> Payment Declaration -> Reconciliation Revision -> Approval -> Sale Recognition/Post -> Basic Daily Report/Audit`

This is the highest-priority milestone.

A real station workflow should be possible before every later module exists.

## Phase 3 — Cash and banking

Implement:

- cash locations/positions;
- cash count;
- handover/transit/dispute;
- collection;
- bank deposit;
- manual bank confirmation;
- cash Action Center exceptions.

## Phase 4 — Tanks, delivery, inventory, costing

Implement:

- tanks/configuration/calibration/dips;
- inventory pools/movements/projection;
- delivery verification/offload/partial receipt;
- WAC;
- adjustments/transfers;
- late landed-cost adjustment/revaluation.

If dependency ordering makes delivery/inventory more sensible before cash in the actual repo, you may implement Phases 3/4 in the Master Blueprint's original order, but preserve both domain boundaries and do not compromise the first station slice.

## Phase 5 — Suppliers, customers, expenses

Implement creditor/customer/expense workflows and ledgers exactly as specified.

## Phase 6 — Profitability and reporting

Complete canonical profitability, operational position, report catalogue, PDFs/XLSX, Explain This Number, data-quality status, as-of revisions.

## Phase 7 — Hardening

Security, performance, accessibility, failure/reversal scenarios, support access, recovery tooling, restore drills, load/query tuning, operational documentation.

## Phase 8 — Pilot readiness

Populate one station through onboarding data, train roles, shadow operation, discrepancy classification, and pilot exit gates.

---

# 23. Definition of Done for every vertical slice

A slice is not complete because the happy-path page renders.

For every slice, confirm as applicable:

- schema/migration exists;
- tenant FK/RLS/isolation rules exist;
- named command/state transition exists;
- server validation exists;
- application authorization and scope exists;
- idempotency exists where repeated submit could duplicate effects;
- concurrency/lock behavior is defined/tested;
- decimal arithmetic uses correct types;
- audit event is written;
- outbox event exists when downstream effect is required;
- mobile/desktop UX follows wireframe intent;
- loading/empty/success/business-error/permission-error/conflict states exist;
- offline behavior is explicit;
- correction/reversal path is defined for posted effects;
- domain tests pass;
- real PostgreSQL tests pass;
- tenant isolation tests pass;
- critical E2E coverage exists;
- accessibility basics pass;
- logs do not expose sensitive data;
- developer docs/implementation status are updated.

---

# 24. Rules for missing details

You are explicitly authorized to make **technical implementation decisions** that do not change business meaning. Examples: file organization within a module, exact function names below the named command boundary, test fixture values, safe upload byte limits, cache durations, internal DTO helper patterns, query batching, indexes after measurement.

When doing so:

1. choose the simplest production-quality option consistent with the blueprint;
2. centralize configurable technical defaults;
3. document non-obvious choices in `docs/technical-defaults.md` or an ADR if significant;
4. do not turn a technical choice into a hidden business rule;
5. do not ask the client to decide engineering trivia.

Stop and request clarification only for a genuine blocker such as:

- two authoritative requirements directly contradict each other and cannot both be implemented;
- a legal/tax/accounting treatment is required to produce an official output and no confirmed policy exists;
- a real external service action cannot be completed without a secret/account/contract that only the owner can provide;
- an irreversible production action would be unsafe without confirmation.

Everything else: implement according to the blueprint/defaults.

---

# 25. Prohibited shortcuts

Do not:

- share ShandaHR operational DB tables with Shanda Fuel;
- introduce microservices because they seem more scalable;
- let the browser connect directly to Neon;
- use a DB owner/bypass-RLS runtime role;
- create a universal financial `transactions` table;
- use generic `source_type/source_id` as the sole integrity relationship for money/stock/auth relationships;
- use one generic `balance` field as source of truth;
- silently edit posted movements;
- delete approved history;
- use floating point for authoritative money/litre/cost calculations;
- calculate official report values separately in UI/PDF/XLSX;
- trust client-side authorization or client-computed financial totals;
- make tenant selection from browser input authoritative without membership verification;
- hide sensitive fields with CSS after sending them to the browser;
- use public R2 objects for private evidence/exports;
- claim collected cash is banked before confirmation;
- claim provider declaration equals bank settlement;
- let supplier invoices alter physical receipt quantity;
- let tank dips auto-adjust book stock;
- let account fuel duplicate meter litres/revenue;
- support negative stock as a normal operating state;
- let prepaid balances silently go negative;
- use SMS as required MFA dependency in V1;
- implement broad offline posting/approval;
- implement OCR that silently posts business transactions;
- invent TEI-specific tax treatment;
- wait for master data that can be collected during onboarding.

---

# 26. Required implementation documentation

Maintain these files in the repository:

```text
docs/
  implementation-status.md
  technical-defaults.md
  architecture-decisions/        # only for material implementation decisions
  permissions.md
  database-security.md
  runbooks/
    deployment.md
    incident-response.md
    backup-restore.md
    tenant-recovery.md
    key-rotation.md
```

`implementation-status.md` should show every phase/slice as:

- not started;
- in progress;
- blocked (with exact external blocker);
- done;
- tested;
- pilot-ready.

Do not use this status file to redefine requirements.

---

# 27. How to report progress to the project owner

After each meaningful implementation batch, report concisely:

1. what was implemented;
2. files/migrations/modules added or changed;
3. tests run and results;
4. security/RLS impact;
5. UX screens/routes completed;
6. any production onboarding data still required later;
7. any deviation from the blueprint (ideally none; if necessary, explain exact reason and alternative).

Do not repeatedly ask for approval between normal implementation steps. Keep moving unless a true blocker under Section 24 is reached.

---

# 28. First execution instructions

Start by doing all of the following, in order:

1. Read the Master Blueprint and Wireframe Pack completely.
2. Inspect the repository. If empty, initialize the Next.js/TypeScript/pnpm project using the locked stack. If non-empty, produce a gap audit before changing architecture.
3. Create the required module/platform/design-system folder structure.
4. Pin the runtime/toolchain versions and create the lockfile.
5. Establish local/staging/prod configuration separation and `.env.example`.
6. Configure Drizzle and PostgreSQL integration-test infrastructure.
7. Create the three PostgreSQL schemas (`auth`, `app`, `platform`) and runtime/migration role strategy.
8. Implement the tenant transaction/RLS context wrapper before adding broad business tables.
9. Implement Tenant, Legal Entity, Tenant Membership, roles/permissions/scopes, and default permission seeds.
10. Implement auth/context selection and the basic responsive app shell from the wireframes.
11. Add documents/audit/idempotency/outbox/jobs foundation.
12. Add CI gates and prove tenant-isolation tests on the foundation tables.
13. Update `docs/CURRENT_STATUS.md`.
14. Then proceed directly into the first station vertical slice: business day -> shift -> boundaries/segments -> declarations -> reconciliation -> approval/post -> basic report.

Do not begin by building decorative dashboards or every master-data screen. Build the security/data spine and one complete real workflow first.

---

# 29. Final implementation standard

The product is only acceptable if a user can trace an important number back to its source and the system can explain:

- what physically happened;
- what was entered/observed;
- what was submitted;
- what was approved;
- what was officially posted;
- which immutable movement changed the balance;
- who performed/approved it;
- what evidence exists;
- which report/calculation version used it;
- what later correction/revaluation occurred without rewriting history.

The desired result is not merely a feature-complete CRUD application. It is a **simple-to-use, operationally reliable, tenant-isolated, auditable fuel-station SaaS whose stock, cash, customer/supplier balances and profitability remain explainable under real-world exceptions and corrections**.

Proceed with implementation using this preserved prompt only as supporting
context, subject to the canonical knowledge base and `AGENTS.md`.
