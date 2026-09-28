# A8 Customer Credit and Prepaid Accounts

Status: merged and present in `main` at integration tip `6b85ae5`.
Canonical migration `0008_customer_accounts.sql` follows
`0007_supplier_creditors.sql` in the merged migration journal. This document
records the implemented customer-account boundary and remaining policy
decisions; it does not claim that customer invoices, benefits, or all customer
commercial workflows are implemented.

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

## Implemented domain in the merged slice

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
- Drizzle schema, tenant-scoped PostgreSQL persistence, command API routes, and
  statement query route;
- central permission definitions and role-permission seeds.

## Implemented migration tables

The canonical `0008` migration creates:

1. `app.customers`
   - tenant-scoped customer identity, account reference, display name,
     lifecycle state, and basic contact metadata;
   - unique `(tenant_id, account_reference)`.
2. `app.customer_accounts`
   - tenant-scoped account identity, customer, account type, currency, status,
     optional credit limit, and optimistic version;
   - one or more accounts per customer must remain structurally possible.
3. `app.customer_ledger_entries`
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

## Integrated constraints and database behavior

The canonical migration and persistence path include tenant-aware foreign keys
for tenant, customer, account, station, product, and actor relationships. The
merged implementation also includes:

- source-key checks that prevent duplicate customer ledger postings;
- append-only update/delete protection for ledger entries;
- state guards for authorization transitions;
- account/product and currency consistency checks;
- deterministic account/reservation loading before prepaid usage or credit
  authorization;
- RLS policies that fail closed without tenant context.

The unique source key is derived from the tenant-scoped immutable A5 evidence
identity, including the reconciliation revision and payment/allocation
evidence identifier; it does not rely on a client idempotency key alone.

## A5 integration design

A8 consumes immutable posted A5 evidence equivalent to
`a5.customer_fuel_allocation_posted.v1`, containing:

- tenant and station;
- reconciliation and posted revision identifiers;
- payment/allocation evidence identifier;
- `CUSTOMER_CREDIT` or `PREPAID` category;
- product, litres, amount, currency, business date, and occurrence time;
- an account reference resolved by trusted server-side workflow.

The customer posting adapter validates the supplied payment evidence against
an A5 `reconciliation_payments` row whose reconciliation revision is already
`POSTED` or `LOCKED`; it never recalculates reconciliation totals or creates a
second forecourt/inventory posting. The source identity is used for
idempotency. A retry with the same command key returns the first result; a
changed payload for that key is an idempotency conflict.

## Implemented permissions

These permissions are registered centrally in migration `0008` and the shared
runtime registry:

- `customer.view`
- `customer.manage`
- `customer.account.manage`
- `customer.credit.authorize`
- `customer.prepaid.top_up`
- `customer.payment.record`
- `customer.statement.view`
- `customer.account.adjust`
- `customer.limit.override`

Customer creation/account management are tenant-scoped; fuel authorization is
station-scoped and step-up protected where applicable. Credit-limit overrides
remain explicit management approval; no threshold is invented here.

## PostgreSQL integration evidence

`tests/integration/a8-customer-accounts.test.ts` provides the merged
PostgreSQL coverage for the implemented slice, including:

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

Dedicated customer Playwright/axe coverage and a customer-specific UI surface
remain future work; A11 preserves the customer-account semantics without
inventing account selection or prepaid conversion.

## Business questions intentionally left open

- credit limits and approval thresholds;
- billing cadence and statement cycle;
- interest, late fees, and collections;
- customer-specific pricing;
- prepaid value versus litre funding/conversion rules;
- tax invoice treatment;
- multi-currency conversion;
- vehicle/driver restrictions and benefit policy.
