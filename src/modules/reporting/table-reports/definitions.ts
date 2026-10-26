/**
 * Reports that are one plain table of rows for a date range and a set of stations.
 * This file is the pure part: what each report is called, which category it sits
 * under and which columns it shows. The queries live in `read.ts`.
 */
import type { ReportCategoryId } from '../catalog';
import { CUSTOMER_AGEING_REPORT } from './customer-ageing';

export type TableReportColumn = Readonly<{
  key: string;
  label: string;
  /** Numbers are right-aligned and exported unquoted; text is guarded against spreadsheet formulas. */
  kind: 'text' | 'number';
}>;

/** Extra ways a person can narrow a report, besides stations and dates. */
export const TABLE_REPORT_FILTER_KEYS = [
  'product',
  'supplier',
  'customer',
  'employee',
  'shift',
  'paymentMethod',
] as const;
export type TableReportFilterKey = (typeof TABLE_REPORT_FILTER_KEYS)[number];

export type TableReportRow = Readonly<Record<string, string | null>>;

export type TableReportDefinition = Readonly<{
  slug: string;
  title: string;
  description: string;
  category: ReportCategoryId;
  /**
   * `organisation` figures are kept for the whole organisation, not by station (ADR-017), so
   * choosing stations shows an explanation instead of figures that would not match the choice.
   */
  scope: 'station' | 'organisation';
  /** Said on the page when there is nothing to show for the chosen dates. */
  emptyMessage: string;
  columns: readonly TableReportColumn[];
  /** Extra filters this report understands (the page shows only these). */
  filters?: readonly TableReportFilterKey[];
}>;

export const TABLE_REPORTS: readonly TableReportDefinition[] = [
  {
    slug: 'tank-dip-history',
    title: 'Tank Dip History',
    description: 'Every tank dip reading taken, by tank and day.',
    category: 'inventory',
    scope: 'station',
    emptyMessage: 'No tank dips were recorded for these dates and stations.',
    filters: ['product'],
    columns: [
      { key: 'businessDate', label: 'Date', kind: 'text' },
      { key: 'measuredAt', label: 'Time measured (UTC)', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'tank', label: 'Tank', kind: 'text' },
      { key: 'product', label: 'Fuel', kind: 'text' },
      { key: 'physicalLitres', label: 'Litres in tank', kind: 'number' },
      { key: 'notes', label: 'Notes', kind: 'text' },
    ],
  },
  {
    slug: 'stock-movements',
    title: 'Stock Movement History',
    description: 'Every change to fuel stock: deliveries, sales and adjustments.',
    category: 'inventory',
    scope: 'station',
    emptyMessage: 'No stock movements were recorded for these dates and stations.',
    filters: ['product'],
    columns: [
      { key: 'businessDate', label: 'Date', kind: 'text' },
      { key: 'effectiveAt', label: 'Time (UTC)', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'tank', label: 'Tank', kind: 'text' },
      { key: 'product', label: 'Fuel', kind: 'text' },
      { key: 'movementType', label: 'What happened', kind: 'text' },
      { key: 'quantityLitres', label: 'Litres (+ in, − out)', kind: 'number' },
      { key: 'reason', label: 'Reason', kind: 'text' },
    ],
  },
  {
    slug: 'delivery-variance',
    title: 'Delivery Variance',
    description: 'Litres on the delivery note against litres actually received.',
    category: 'inventory',
    scope: 'station',
    emptyMessage: 'No confirmed deliveries were received for these dates and stations.',
    filters: ['product', 'supplier'],
    columns: [
      { key: 'businessDate', label: 'Date', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'product', label: 'Fuel', kind: 'text' },
      { key: 'deliveryNote', label: 'Delivery note', kind: 'text' },
      { key: 'supplier', label: 'Supplier', kind: 'text' },
      { key: 'noteLitres', label: 'On the note (L)', kind: 'number' },
      { key: 'actualLitres', label: 'Received (L)', kind: 'number' },
      { key: 'shortageExcessLitres', label: 'Short (−) / over (+) (L)', kind: 'number' },
      { key: 'shortCompartments', label: 'Compartments short', kind: 'number' },
      { key: 'brokenSeals', label: 'Broken seals', kind: 'number' },
    ],
  },
  {
    slug: 'expenses-detail',
    title: 'Expenses by Category',
    description: 'Every expense recognised in the period, with its category and who was paid.',
    category: 'statements',
    scope: 'station',
    emptyMessage: 'No expenses were recognised for these dates and stations.',
    columns: [
      { key: 'businessDate', label: 'Date', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'category', label: 'Category', kind: 'text' },
      { key: 'kind', label: 'Type of cost', kind: 'text' },
      { key: 'description', label: 'What it was for', kind: 'text' },
      { key: 'payee', label: 'Paid to', kind: 'text' },
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'amount', label: 'Amount (USD)', kind: 'number' },
    ],
  },
  {
    slug: 'supplier-statement',
    title: 'Supplier Statement',
    description: 'Invoices, credit notes and payments for each supplier, with what is still owed.',
    category: 'credit',
    scope: 'station',
    emptyMessage: 'No supplier invoices or payments were recorded for these dates.',
    filters: ['supplier'],
    columns: [
      { key: 'date', label: 'Date', kind: 'text' },
      { key: 'supplier', label: 'Supplier', kind: 'text' },
      { key: 'what', label: 'What happened', kind: 'text' },
      { key: 'amount', label: 'Owed (+) / paid (−) (USD)', kind: 'number' },
      { key: 'balance', label: 'Still owed after this (USD)', kind: 'number' },
    ],
  },
  {
    slug: 'customer-statement',
    title: 'Customer Statement',
    description:
      'Fuel on account, payments and prepaid top-ups for each customer, with the balance.',
    category: 'credit',
    scope: 'organisation',
    emptyMessage: 'No customer account activity was recorded for these dates.',
    filters: ['customer'],
    columns: [
      { key: 'date', label: 'Date', kind: 'text' },
      { key: 'customer', label: 'Customer', kind: 'text' },
      { key: 'account', label: 'Account', kind: 'text' },
      { key: 'what', label: 'What happened', kind: 'text' },
      { key: 'amount', label: 'Up (+) / down (−) (USD)', kind: 'number' },
      { key: 'balance', label: 'Balance after this (USD)', kind: 'number' },
    ],
  },
  {
    slug: 'cash-custody',
    title: 'Cash Custody & Handovers',
    description: 'Who passed cash to whom, how much was expected, counted and what did not add up.',
    category: 'cash',
    scope: 'station',
    emptyMessage: 'No cash handovers were recorded for these dates and stations.',
    filters: ['employee'],
    columns: [
      { key: 'date', label: 'Date', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'from', label: 'From', kind: 'text' },
      { key: 'to', label: 'To', kind: 'text' },
      { key: 'handedBy', label: 'Handed over by', kind: 'text' },
      { key: 'receivedBy', label: 'Received by', kind: 'text' },
      { key: 'expected', label: 'Expected (USD)', kind: 'number' },
      { key: 'counted', label: 'Counted (USD)', kind: 'number' },
      { key: 'difference', label: 'Short (−) / over (+) (USD)', kind: 'number' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'note', label: 'Note', kind: 'text' },
      { key: 'cashStatus', label: 'Where the cash is now', kind: 'text' },
      { key: 'reasonCheck', label: 'Shortage reason', kind: 'text' },
    ],
  },
  {
    slug: 'bank-deposits',
    title: 'Bank Deposits',
    description: 'Cash taken to the bank, the deposit reference and whether the bank confirmed it.',
    category: 'cash',
    scope: 'station',
    emptyMessage: 'No bank deposits were recorded for these dates and stations.',
    columns: [
      { key: 'date', label: 'Date', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'bankAccount', label: 'Bank account', kind: 'text' },
      { key: 'depositReference', label: 'Deposit reference', kind: 'text' },
      { key: 'amount', label: 'Deposited (USD)', kind: 'number' },
      { key: 'confirmed', label: 'Bank confirmed (USD)', kind: 'number' },
      { key: 'difference', label: 'Difference (USD)', kind: 'number' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'bankReference', label: 'Bank reference', kind: 'text' },
      { key: 'bankingStatus', label: 'Banking status', kind: 'text' },
      { key: 'missingProof', label: 'Missing proof', kind: 'text' },
    ],
  },
  {
    slug: 'daily-reconciliation',
    title: 'Daily Reconciliation',
    description:
      'For each day and shift: who worked, expected sales against what was accounted for.',
    category: 'sales',
    scope: 'station',
    emptyMessage: 'No daily reconciliations were started for these dates and stations.',
    filters: ['shift', 'employee', 'paymentMethod'],
    columns: [
      { key: 'date', label: 'Date', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'shift', label: 'Shift starts', kind: 'text' },
      { key: 'attendants', label: 'Attendants', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'expected', label: 'Expected sales (USD)', kind: 'number' },
      { key: 'accounted', label: 'Accounted for (USD)', kind: 'number' },
      { key: 'difference', label: 'Short (−) / over (+) (USD)', kind: 'number' },
      { key: 'explanation', label: 'Explanation', kind: 'text' },
      { key: 'approvedOn', label: 'Approved on', kind: 'text' },
    ],
  },
  CUSTOMER_AGEING_REPORT,
  {
    slug: 'purchases',
    title: 'Purchases',
    description: 'Supplier invoices and credit notes, what has been paid and what is still owed.',
    category: 'credit',
    scope: 'station',
    emptyMessage: 'No supplier invoices were recorded for these dates.',
    filters: ['supplier', 'product'],
    columns: [
      { key: 'date', label: 'Invoice date', kind: 'text' },
      { key: 'supplier', label: 'Supplier', kind: 'text' },
      { key: 'type', label: 'Type', kind: 'text' },
      { key: 'reference', label: 'Reference', kind: 'text' },
      { key: 'dueDate', label: 'Due date', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'amount', label: 'Amount (USD)', kind: 'number' },
      { key: 'paid', label: 'Paid so far (USD)', kind: 'number' },
      { key: 'owed', label: 'Still owed (USD)', kind: 'number' },
    ],
  },
  {
    slug: 'supplier-payments',
    title: 'Supplier Payments',
    description: 'Every payment made to suppliers and how much of it has been matched to invoices.',
    category: 'credit',
    scope: 'station',
    emptyMessage: 'No supplier payments were recorded for these dates.',
    filters: ['supplier'],
    columns: [
      { key: 'date', label: 'Payment date', kind: 'text' },
      { key: 'supplier', label: 'Supplier', kind: 'text' },
      { key: 'reference', label: 'Our reference', kind: 'text' },
      { key: 'method', label: 'How it was paid', kind: 'text' },
      { key: 'proof', label: 'Bank or proof reference', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'amount', label: 'Amount (USD)', kind: 'number' },
      { key: 'matched', label: 'Matched to invoices (USD)', kind: 'number' },
      { key: 'unmatched', label: 'Not yet matched (USD)', kind: 'number' },
    ],
  },
  {
    slug: 'sales-by-attendant',
    title: 'Sales by Attendant',
    description:
      'Approved sales for each attendant. Where sealed meter segments support it, shared shifts are split by the litres each attendant handled; otherwise the shift remains shared.',
    category: 'sales',
    scope: 'station',
    emptyMessage: 'No approved shift reports were found for these dates and stations.',
    filters: ['shift', 'employee'],
    columns: [
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'attendant', label: 'Attendant', kind: 'text' },
      { key: 'shifts', label: 'Shifts', kind: 'number' },
      { key: 'litres', label: 'Litres sold', kind: 'number' },
      { key: 'sales', label: 'Sales (USD)', kind: 'number' },
      { key: 'accounted', label: 'Accounted for (USD)', kind: 'number' },
    ],
  },
  {
    slug: 'payment-method-breakdown',
    title: 'Payment Method Breakdown',
    description:
      'How approved sales were paid: cash, card, EcoCash, bank transfer, customer credit, prepaid and fuel given to staff, for each station.',
    category: 'sales',
    scope: 'station',
    emptyMessage: 'No approved shift reports were found for these dates and stations.',
    filters: ['shift', 'employee', 'paymentMethod'],
    columns: [
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'method', label: 'Paid by', kind: 'text' },
      { key: 'entries', label: 'Entries', kind: 'number' },
      { key: 'amount', label: 'Amount (USD)', kind: 'number' },
    ],
  },
];

export function findTableReport(slug: string): TableReportDefinition | undefined {
  return TABLE_REPORTS.find((report) => report.slug === slug);
}

/** Most rows one report returns; the page says so when the cap is reached. */
export const TABLE_REPORT_ROW_LIMIT = 5000;
