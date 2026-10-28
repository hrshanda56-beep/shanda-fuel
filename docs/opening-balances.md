# Go-live opening balances

Opening balances are loaded through the tenant-scoped opening-balance command flow. The import is
previewed, created as a draft, approved by a permitted owner/administrator/finance user, and then
locked. The batch and its lines are append-only after approval, and every transition is audited.

This is an operator procedure for a local or reviewed go-live run; it does not run against
production automatically.

## CSV shape

The CSV header is:

```text
line_key,line_type,legal_entity_reference,station_code,supplier_code,customer_reference,account_reference,cash_location_code,bank_account_name,tank_code,reference,effective_date,due_date,amount,quantity_litres,inventory_value,currency,notes
```

Supported `line_type` values are:

- `SUPPLIER_INVOICE` for an opening supplier liability;
- `CUSTOMER_CHARGE` for an opening customer balance;
- `CASH_BALANCE` for cash at a named station cash location;
- `BANK_BALANCE` for a bank statement opening balance;
- `TANK_STOCK` for opening litres and their cost per tank/product.

Use `USD` for `currency`. Cash lines require `station_code`, `cash_location_code`, and a positive
`amount`. Tank lines require `station_code`, `tank_code`, positive `quantity_litres` and
`inventory_value`; the importer resolves the tank's product and posts the auditable opening stock
and cost projection. Supplier and bank references are resolved by their tenant-scoped codes/names.

## Reviewed sequence

1. Prepare the CSV from the signed opening-balance sheet. Keep `line_key` stable and unique.
2. Call `PreviewOpeningBalanceImport` with the CSV and resolve every reported issue.
3. Call `CreateOpeningBalanceBatch` with the same CSV and an `asOfDate` that is not before any
   line's `effective_date`.
4. Review the resolved lines and approve the draft with `ApproveOpeningBalanceBatch`.
5. Lock the approved batch with `LockOpeningBalanceBatch` after the owner/finance review.

The command route is `/api/opening-balances/commands`. The caller supplies the tenant context,
an idempotency key, and the expected batch version for transitions. Do not put database URLs,
Clerk secrets, or audit-signing secrets in the CSV, chat, logs, or command-line arguments.

To correct a mistake, do not edit or delete a locked batch. Create a reviewed corrective opening
entry or a later accounting correction according to the relevant domain procedure.
