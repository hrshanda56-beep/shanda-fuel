# A8 Customer Credit and Prepaid Accounts — Parallel Preparation

Status: domain/application preparation only. This document is not a canonical
database migration and does not claim PostgreSQL production completion.

## Scope

A8 owns the customer-account concepts needed to represent credit receivables,
prepaid value, product-specific prepaid litres, authorizations/reservations,
account ledger entries, payments/top-ups, and statement/query contracts.

Staff or management fuel remains the separate A5
`STAFF_OR_MANAGEMENT_FUEL` classification. It is not mapped to customer
accounts here.

## Existing contracts consumed

- A1 trusted tenant authority, authorization, transaction-local RLS context,
  signed audit events, and session security.
- A3 server-derived meter segments and product/selling-price identity.
- A5 reconciliation payment evidence, including the existing
  `CUSTOMER_CREDIT` and `PREPAID` classifications.
- A4 product identity and inventory movement truth.
- Existing idempotency and outbox patterns. A8 does not add a second command
  or transaction framework.

Customer fuel must classify an authoritative A5/forecourt allocation. It must
not recalculate meter litres, recreate reconciliation payments, or post a
second sale/inventory movement.

## Domain prepared in this branch

Implemented in `src/modules/customers/`:

- customer and account value types;
- `CREDIT`, `PREPAID_VALUE`, and `PREPAID_LITRES` semantics;
- append-oriented ledger-entry types and source references;
- exact-decimal balance derivation;
- no-negative prepaid value/litre checks;
- product-specific prepaid-litre balances;
- authorization/reservation lifecycle and release on cancellation/expiry;
- partial and complete fuel-use transitions;
- customer payment and prepaid top-up entry factories;
- A5 evidence and audit contracts;
- repository/query ports and validation schemas;
- proposed permission names without central permission wiring.

No database adapter, API route, migration, Drizzle schema, or canonical
permission grant is included.

## Proposed future tables

The following is migration intent only. A6/A0 must assign the migration number
and integrate the reviewed schema after the preceding workstream is merged.

1. `app.customers`
   - tenant-scoped customer identity, account reference, display name,
     lifecycle state, and basic contact metadata;
   - unique `(tenant_id, account_reference)`.
2. `app.customer_accounts`
   - tenant-scoped account identity, customer, account type, currency, status,
     optional credit limit, and optimistic version;
   - one or more accounts per customer must remain structurally possible.
3. `app.customer_account_ledger_entries`
   - immutable entries for credit charges, customer payments, prepaid top-ups,
     prepaid usage, adjustments, and reversals;
   - exact `NUMERIC(20,4)` monetary values and `NUMERIC(18,3)` litre values;
   - one source reference per authoritative posting.
4. `app.customer_fuel_authorizations`
   - station/account/product authorization, requested/used/remaining exact
     values, lifecycle state, source evidence, and version;
   - reservations are released by state transition, not by mutating ledger
     history.

Statements and current balances are derived read models, not authoritative
`balance` columns.

## Deferred constraints and database behavior

The production migration must include reviewed tenant-aware foreign keys for
tenant, customer, account, station, product, actor membership, and source
relationships. It must also include:

- a unique source key that prevents one posted A5 allocation from creating two
  customer ledger entries;
- append-only update/delete guards on posted ledger entries;
- state guards for authorization transitions;
- account/product consistency for prepaid-litre entries;
- currency consistency for credit and prepaid-value entries;
- a transaction-scoped posting function or equivalent deterministic lock path
  that derives balances and active reservations before allowing a prepaid
  usage or credit-limit reservation;
- RLS policies that fail closed without tenant context.

The unique source key should use the tenant plus the immutable A5 evidence
identity, including the reconciliation revision and payment/allocation
evidence identifier. It must not rely on a client idempotency key alone.

## A5 integration design

A5 should publish immutable posted evidence equivalent to
`a5.customer_fuel_allocation_posted.v1`, containing:

- tenant and station;
- reconciliation and posted revision identifiers;
- payment/allocation evidence identifier;
- `CUSTOMER_CREDIT` or `PREPAID` category;
- product, litres, amount, currency, business date, and occurrence time;
- an account reference resolved by trusted server-side workflow.

The customer posting adapter consumes this evidence inside the existing
tenant transaction and uses the source identity for idempotency. A retry with
the same source returns the existing entry; a changed payload for the same
source is an idempotency conflict. A8 does not implement fake persistence for
this path during parallel preparation.

## Required permissions for later integration

These names are proposed locally and are not added to the central permission
catalogue in this branch:

- `customer.view`
- `customer.manage`
- `customer.account.manage`
- `customer.credit.authorize`
- `customer.prepaid.top_up`
- `customer.payment.record`
- `customer.statement.view`
- `customer.account.adjust`
- `customer.limit.override`

Final role grants, scope, assurance, and approval semantics require A1/A0
integration review. Credit-limit overrides remain explicit management approval;
no threshold is invented here.

## PostgreSQL integration-test plan

After canonical migration integration, add real PostgreSQL tests for:

1. tenant A cannot read, link, post, or query tenant B customer data;
2. absent tenant context fails closed under RLS;
3. customer/account/product composite foreign keys reject cross-tenant links;
4. posted ledger entries cannot be updated or deleted;
5. duplicate A5 source posting returns the first result and creates one entry;
6. the same source with changed payload is rejected;
7. two concurrent prepaid reservations cannot consume the same balance;
8. two concurrent credit reservations respect an explicitly configured limit;
9. prepaid value and product-specific litre balances cannot go negative;
10. cancellation/expiry releases remaining reservation capacity;
11. correction/reversal creates compensating evidence without rewriting the
    original entry;
12. authorization and audit records contain trusted actor and tenant context.

Playwright/axe coverage should follow only after the server routes and A2
presentation surfaces are integrated. It should cover permission denial,
loading/empty/error/conflict states, statement rendering, and truthful pending
authoritative confirmation.

## Business questions intentionally left open

- credit limits and approval thresholds;
- billing cadence and statement cycle;
- interest, late fees, and collections;
- customer-specific pricing;
- prepaid value versus litre funding/conversion rules;
- tax invoice treatment;
- multi-currency conversion;
- vehicle/driver restrictions and benefit policy.
