# ADR-017: Customer credit usable at any permitted station

- Status: Accepted (product owner, 2026-10-08)
- Date: 2026-10-08
- Owner: Product owner

## Context

Customers should be able to draw credit at any station, not only the one that
opened the account. A8 customer balances and reservations are tenant-owned and
do not carry a station dimension, while every fuel authorization records the
station it was drawn at. Management reports currently hide all customer figures
whenever a station filter is applied.

## Decision

- A customer's balance, limit, and reservations stay one organisation-level
  record. They are never split per station, so two stations cannot spend the
  same credit.
- Each customer account belongs to exactly one legal entity (confirmed by the
  product owner: each customer's credit is with one entity only). Credit is
  never used across legal entities.
- Each customer account carries its own station scope: all stations of its legal
  entity (default) or a chosen list. The server enforces the scope when fuel is
  authorised.
- Every draw stays attributed to the station where it was drawn.
- A payment is recorded at the station where cash is received and applied to
  the organisation-level account. Cash custody stays per station; credit and
  cash remain separate domains.
- Reports show credit activity (drawn at the selected stations) for any station
  filter. Balances and exposure are shown only for all stations and are labelled
  organisation-wide.

## Alternatives considered

- Per-station balances or limits — allow overspend across stations; rejected.
- Credit across legal entities — an accounting and tax question the client has
  not answered; not invented here.
- One scope rule for all customers — rejected by the product owner in favour of
  a per-account scope.

## Consequences

- Reports gain a `customers.activity` section; balance availability rules are
  unchanged.
- A later slice adds the account station scope (schema, command, authorisation
  check, tests) and records the receiving station on customer payments.

## Affected modules

Customers (A8), reporting, cash (payment receiving station), authorisation.

## Specification impact

Refines the Blueprint's customer-account model; no deviation from a locked
invariant.

## Migration/backward compatibility

Existing accounts default to all stations of their legal entity. Existing
legal-entity ownership of accounts must be confirmed during onboarding; no
client data is invented.
