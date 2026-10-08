# Phase 1 backend-to-UI handoff

Status: reviewed backend contract for the current Phase 1 branch. This is an
API/state handoff only; it does not prescribe visual design, navigation, or
shell changes.

## Customer reads

`GET /api/customers/summary?tenantId=<uuid>` returns the tenant-authorized
customer projection. Add `customerId=<uuid>` for one customer and its recent
transactions. Values used for money and litres are serialized as decimal
strings. The response shape is:

```text
{ customers: [{
  customerId, accountReference, displayName, status, contactMetadata,
  accounts: [{ accountId, accountType, status, currency, creditLimit,
    balance, availableBalance, availableCredit, reservedAmount,
    productBalances: [{ productId, productCode, productName,
      balanceLitres, availableLitres }] }],
  recentTransactions: [{ id, accountId, accountType, entryType, direction,
    occurredAt, businessDate, amount, currency, litres, productId,
    productCode, productName, note }]
}] }
```

The server resolves tenant, membership, scope, and RLS context. A URL
`tenantId` is not authorization. The read requires `customer.view`.

## Customer commands

All commands are sent as JSON to `POST /api/customers/commands` and require an
authenticated actor. Lifecycle/configuration commands require an
`Idempotency-Key` header and an optimistic `expectedVersion` where the command
schema defines one.

- `CreateCustomer`: `tenantId`, `accountReference`, `displayName`, optional
  string-valued `contactMetadata`; requires `customer.manage`.
- `UpdateCustomer`: `tenantId`, `customerId`, `expectedVersion`, and at least
  one of `accountReference`, `displayName`, or `contactMetadata`; requires
  `customer.manage`.
- `ActivateCustomer`: `tenantId`, `customerId`, `expectedVersion`; requires
  `customer.manage`.
- `DeactivateCustomer`: `tenantId`, `customerId`, `expectedVersion`; requires
  `customer.manage` and records the reversible inactive state.
- `CreateCustomerAccount`: `tenantId`, `customerId`, `accountType`, `currency`,
  and a positive `creditLimit` for `CREDIT`; requires
  `customer.account.manage`.

The command response is the persisted result. Replay with the same idempotency
key and request body returns the original result; reuse with a different body
is a conflict. Stale `expectedVersion` is a conflict. Mutations are audited,
tenant-scoped, and use exact decimal validation.

## Lifecycle and transaction semantics

Customer lifecycle values are `ACTIVE`, `SUSPENDED`, and `CLOSED`.

- `ActivateCustomer` moves a permitted customer to `ACTIVE`.
- `DeactivateCustomer` moves a permitted customer to `SUSPENDED`; it does not
  mean terminal closure.
- `SUSPENDED` and `CLOSED` customers remain readable but cannot initiate new
  account transactions. Account-level inactive states are also rejected.
- `CLOSED` is a terminal state in the established domain meaning, but the
  current Phase 1 contract does not define a `CloseCustomer` command, close
  reason/evidence, or authorized terminal transition. UI must not invent one.

Credit accounts require an explicitly positive hard limit. Over-limit use is
blocked. The existing A8 ledger/reservation and A5 fuel evidence boundaries
remain authoritative; this handoff does not add pricing, tax, FX, or a second
ledger.

## Permission and error behavior

Owner/Admin manage customer master data, account configuration, and lifecycle.
Supervisor and operational roles retain only the explicitly granted read/use
capabilities. Lifecycle writes must not be presented as operational actions.
All requests remain subject to tenant/legal-entity/station scope and RLS.

Expected public errors use the existing response shape:

```text
{ error, message?, details? }
```

Use the HTTP status and `error` code as the contract: `400` validation,
`401` unauthenticated, `403` forbidden/scope, `404` missing subject, `409`
stale-state/idempotency/business conflict, `429` rate limit, and `500` only
for an unexpected server failure. Responses are `no-store`; request IDs are
available through the existing observability wrapper.

## Daily Operations projection

`GET /api/forecourt/operations/overview?tenantId=<uuid>&stationId=<uuid>`
optionally accepts `businessDayId=<uuid>`. The caller must have
`business_day.view` and `shift.view`; reconciliation and audit details are
returned only when their separate permissions allow them.

The stable top-level projection includes station timezone, organization,
`currentBusinessDate`, selected/current business-day IDs, business days,
shifts, visible reconciliations, audit timeline, visibility flags, and
command-action availability. `status` is authoritative projection state:

```text
status.close    = NOT_STARTED | OPEN | IN_PROGRESS | READY_FOR_REVIEW |
                  CLOSED | BLOCKED | EXCEPTION
status.approval = NO_REVISION | DRAFT | READY | SUBMITTED |
                  PENDING_APPROVAL | RETURNED | REJECTED | APPROVED |
                  POSTED | LOCKED
```

The projection derives close/approval status from existing business-day,
shift, reconciliation, and revision state. It does not create or mutate a
generic approval/exception record. Station-local dates/times must use the
server-provided station timezone and business date.

## Monthly customer statements

`GET /api/customers/statement?tenantId=<uuid>&accountId=<uuid>` accepts:

- `period=YYYY-MM` for a monthly calendar business-date period;
- `asOf=<ISO instant>` for an as-of view; do not combine it with `period`;
- optional `limit` (1–200, default 50) and `cursor`.

The response contains `accountId`, exact-decimal `balance`, ordered `lines`
with ledger `entry` and `runningBalance`, and optional `period`, `asOf`, and
`nextCursor`. It is a read-only reporting artifact: it does not post,
record a payment, or mutate a balance. The caller requires
`customer.statement.view` and the server resolves the applicable tenant/
station business-date context.

## UI integration boundary

The UI may consume these read models and named commands, render loading,
empty, forbidden, conflict, validation, and server-error states, and refresh
after successful mutations. It must not calculate authoritative money/litre
values, infer approval from presentation state, bypass command permissions,
or add a terminal-close action until a separate product decision defines that
contract.
