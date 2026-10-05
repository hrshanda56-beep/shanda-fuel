# A8 Customer Accounts — Phase 0 UI

## Scope

Phase 0 exposes the customer-account capability already present in A8 as a
tenant-scoped, read-only owner/finance workspace. It restores Customers to the
canonical Finance navigation group and provides `/customers` plus a
customer-detail route.

The UI reads the existing `customers`, `customer_accounts`,
`customer_ledger_entries`, `customer_fuel_authorizations`, and `products`
records through a new permission-checked summary query. Money and litre values
remain exact decimal strings from PostgreSQL; the browser only formats them for
display.

## Supported now

- Customer identity, account reference, lifecycle status, and stored contact
  metadata.
- `CREDIT`, `PREPAID_VALUE`, and `PREPAID_LITRES` account types.
- Credit outstanding balance, configured limit, and available credit after
  active reservations where a limit is genuinely recorded.
- Prepaid value posted and available balance after active reservations.
- Product-specific prepaid-litre posted and available balances.
- Recent posted customer ledger activity, including A5-linked fuel usage,
  payments, top-ups, adjustments, and reversals where present.
- Authorised empty, loading, error, and no-match states; tenant isolation and
  `customer.view` / existing statement authorization remain server-owned.

## Deliberately not inferred

The Phase 0 UI does not add or expose writes. Existing customer commands remain
available only through their existing command routes and authorization,
validation, idempotency, audit, and RLS pipeline. The UI does not invent:

- invoices or formal statement cycles;
- staff/management benefit rules;
- vehicle registration or driver controls;
- customer-specific pricing, terms, credit-limit policy, or overdue ageing;
- station ownership for customer accounts, because the current A8 customer
  tables are tenant-scoped rather than station-scoped.

These are Phase 1 commercial/product decisions or existing-model gaps, not
placeholder figures in the Phase 0 surface.

## Security and integrity notes

`GET /api/customers/summary` resolves the authenticated tenant authority,
requires `customer.view`, and performs all reads inside the trusted tenant
transaction context. The query derives balances from append-only ledger entries
and active authorization reservations. No migration, RLS policy, account
state-machine command, or financial write semantics were added for this UI.
