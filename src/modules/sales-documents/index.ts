/**
 * Public Sales documents module boundary (DEC-045). Quotations, invoices and receipts are
 * standalone: nothing here posts to the customer ledger, cash, profit or any report. Server-only
 * persistence stays behind the command and query entry points.
 */
export {
  MAX_DOCUMENT_LINES,
  SALES_DOCUMENT_COMMAND_POLICY,
  SALES_DOCUMENT_COMMAND_TYPES,
  SALES_DOCUMENT_PERMISSION_CODES,
  SALES_DOCUMENT_STATUSES,
  SALES_DOCUMENT_TYPES,
  type SalesDocumentCommandType,
  type SalesDocumentStatus,
  type SalesDocumentTypeCode,
} from './contracts';
export {
  computeDocumentTotals,
  formatDocumentNumber,
  invoiceBalance,
  paymentState,
  type PaymentState,
  type SalesDocumentType,
} from './domain';
