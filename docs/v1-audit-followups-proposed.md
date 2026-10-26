# Audit follow-ups — proposal (not decided, no migration written)

Status: PROPOSED 2026-10-26 for the project lead's priority call. Nothing here is built. Per AGENTS.md §6.1 these need a recorded decision first.

## 1. Sign-in counting as a fresh identity check (policy)

Today a password sign-in never satisfies step-up; the person is asked again for high-risk actions (setup, customer accounts, expenses with no limit). Options: (a) keep as is; (b) treat a sign-in within N minutes as fresh. Recommendation: (b) with N = 10 minutes, server-checked against the Clerk session's `factorVerificationAge`, never client-claimed. Needs a decision on N and a security review. Touches `src/platform/security/permissions.ts` and `src/platform/auth/provider.ts`.

## 2. Expense payment method

Payment method is chosen at the pay step, not on the expense. The audit wants till cash, EcoCash or bank recorded when the expense is entered. Proposal: optional `intended_payment_method` on the expense draft (display only; the pay step stays authoritative). One nullable column plus a field on the add form; no accounting change. Question: should paying from till cash reduce the shift's expected cash? (Unsettled; not assumed.)

## 3. Supplier invoice

Already in the schema: delivery references with a station (`deliveryReferences`), line items, payment terms (now required). Still missing: fuel type on the invoice header, transport/other cost lines, file attachment, and a required due date when on credit. Proposal: require `dueDate` when terms are CREDIT (validation only, no migration); reuse the existing proof-of-payment upload pattern for the invoice file; model transport/other cost as ordinary invoice lines with a kind. Question: does transport cost add to the fuel's unit cost for valuation? (Unsettled; not assumed.)

## 4. Customer and account in one command

Add Customer makes two writes (customer, then account) with one idempotency key each; a failure between them leaves a customer with no account, which the form now retries safely. A single `CreateCustomerWithAccount` command would remove the window. Proposal: add it, keep the two existing commands. No schema change.

## 5. Needs a product decision before any work

Offline drafts beyond the daily report, tank-variance defaults, extra alert types, Sales by Attendant crediting rule, ShandaHR link (deferred, DEC-044).
