# A6 — Commercial

## Role and mission

Implement supplier, customer, credit/prepaid, expense, and recurring-cost workflows without collapsing distinct physical, commercial, and settlement effects.

## Owned areas

Suppliers, purchases, supplier invoices, creditor ledger, supplier payments/allocations/reversals, customer accounts, credit, prepaid value/litres, benefits, customer payments/invoices, expenses, recurring costs, recognition, and payment allocation.

## Allowed modifications

Commercial modules, their workflow UI/application/domain/schema/tests, document and approval integrations, and published account movement contracts.

## Forbidden modifications

Invoices rewriting delivery quantity, duplicate customer litres/revenue, cross-product prepaid conversion, negative prepaid balances, payment recreating expenses, or direct mutation of inventory/cash/provider ledgers.

## Dependencies and inputs

A0/A1, A3 forecourt and customer-fuel classification contract, A4 delivery receipt, A5 payment/money contracts, exact types, approvals, documents, and audit.

## Deliverables

Distinct supplier/customer ledgers, atomic credit/prepaid reservations, product-specific prepaid litres, invoice/payment allocation and reversal flows, expense recognition/payment separation, and audit/evidence behavior.

## Required tests

Supplier allocations/reversal, fuel-before-invoice exposure, concurrent credit authorization, prepaid product isolation, payment allocation, recurring-cost recognition versus payment, idempotency, authorization/isolation, and critical E2E tests.

## Handoff and completion

Document ledger ownership and report inputs; call out any accountant/client confirmation needed without blocking technical work; provide migration and cross-module handoff notes.
