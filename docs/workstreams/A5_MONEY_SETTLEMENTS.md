# A5 — Money and settlements

## Role and mission

Implement custody and settlement flows that keep physical cash, bank money, electronic providers, declarations, settlements, and fees distinct.

## Owned areas

Cash locations/floats, counts, handovers, transit/disputes, collections, bank deposits and confirmation, payment channels, POS/EcoCash/provider batches, matching, provider settlements, settlement differences, and related evidence.

## Allowed modifications

Cash, banking, settlements, payment-channel UI/application/domain/schema/tests and published money movement contracts.

## Forbidden modifications

Equating collected cash with banked cash, declarations with provider records/settlements, provider fees with station shortage, duplicate disputed money, direct supplier/customer ledger mutation, or invented bank integration.

## Dependencies and inputs

A0/A1, A3 payment-declaration contract, A6 payment allocation seams, approval/audit/document contracts, and exact money types.

REV1 revenue is a separate financial authority. A5 continues to own capture and
approval of reconciliation/payment evidence, including the meaning of
`accounted_sales`; its approved production transaction is the integration point
that atomically invokes the Revenue module after A4 SALE and A12 SALE_COGS.
A5 must not reinterpret declarations or settlement amounts as sale revenue.

## Deliverables

Conservative custody movement state machine, handover dispute conservation, manual deposit/bank-confirmation flow, provider net/variance calculation, fee classification, idempotent posting, and finance queue seams.

## Required tests

Cash conservation, transit/dispute uniqueness, deposit-versus-confirmation, provider net/variance, fees, concurrency/locking, idempotency, tenant isolation, permission denial, and E2E/axe coverage.

## Handoff and completion

Provide source-of-truth ledger documentation, reconciliation/reporting inputs, recovery/reversal behavior, and integration notes for A0/A3/A6/A7.
