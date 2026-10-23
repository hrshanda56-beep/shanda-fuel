# Supplier credit (brief S8 and S9): what was built and what is left

Branch `codex/v1-supplier-credit`. Migration 0055.

## Built

- **Cash or credit on a supplier invoice.** `payment_terms` (`CASH` or `CREDIT`) and
  `credit_period_days` on `app.supplier_documents`. Rules live in
  `src/modules/creditors/credit-terms.ts` and are repeated as database checks:
  - Credit needs a credit period or a due date. With a period, the due date is the invoice date
    plus the days, always calculated; a typed date that disagrees is refused.
  - Cash has no period and no due date. Credit notes carry no terms.
  - Invoices sent without terms (older callers, existing rows) are unchanged: "terms not recorded",
    optional typed due date.
  - Terms are frozen once the invoice is posted (trigger `supplier_documents_terms_guard`), like the
    due date already was.
- **Command.** `SubmitSupplierDocument` accepts `paymentTerms` and `creditPeriodDays` and returns
  the calculated `dueDate`.
- **Due view.** `GET /api/suppliers/due` and the page `/suppliers/due`: unpaid invoices grouped as
  overdue, next 7 days, 8 to 14, 15 to 30, later, no due date. Instalments and multi-invoice
  payments are already supported by payment allocation; the view shows only the unpaid balance.
- **Reminders before the due date** already exist: the Action Center and the alert digest raise
  "due today" and "due in N days" supplier items (N is the organisation's alert setting). No change
  was needed; email stays off pending ADR-020.

## Not built (needs a decision or a locked-file change)

1. **Proof of payment upload.** Not built. Documents are attached to station-owned subjects
   (`DOCUMENT_SUBJECTS` in `src/modules/documents/catalog.ts`); a supplier payment belongs to the
   whole business, and `docs/v1-owner-decisions.md` item 6 recommends leaving it out of v1.
   Ready design if the owner says yes: add subject `SUPPLIER_PAYMENT` with a legal-entity-scoped
   (not station-scoped) document link table protected by the same tenant + legal entity RLS as
   `supplier_payments`; permission `supplier.payment.post` to attach, `supplier.creditor.review`
   to view; kind `RECEIPT`; behind a flag so it is off until the owner answers.
2. **Supplier default credit period** (`suppliers.default_credit_period_days`) was left out: it
   needs a new command, permission wiring and a locked supplier form. The invoice carries its own
   period, which is enough for the brief.
3. **Navigation entry and the invoice form fields** need locked files (see below).

## Locked-file changes proposed (not applied)

- `src/design-system/navigation.ts`: add a child under Suppliers, label "Payments due", path
  `/suppliers/due`.
- Supplier invoice form (inside `src/modules/creditors/ui/supplier-detail-workspace.tsx` and the
  purchasing invoice form): replace the typed due date with a Cash / Credit choice; for Credit a
  "Credit period (days)" number field and a read-only "Due date" computed with
  `calculateDueDate(invoiceDate, days)`; send `paymentTerms` and `creditPeriodDays` in the command.
  Remove the typed `dueDate` once the form sends terms.
- Optional: a link "See what is due" on `/suppliers`.

## Decisions for the owner

- Should a credit purchase without terms be refused outright (today: terms are optional so the
  locked form keeps working, and the due-date requirement applies only when terms are sent)?
- Proof of payment: leave out of v1 (recommended) or attach at business level.
