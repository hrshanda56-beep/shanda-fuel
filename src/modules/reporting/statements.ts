/**
 * Accounting-statement layouts built from the management report. Every figure is
 * one the report already carries, or an exact sum or difference of such figures.
 * Nothing here is a ledger balance: these are management statements, unaudited.
 * Pure; no UI or database code.
 */
import type { ManagementReport } from './contracts';
import { addExact, exact, ratioPercentage, subtractExact, sumExact } from './domain';
import { operatingProfit } from './operating-profit';

export type StatementUnit = 'money' | 'litres';

export type StatementLine = Readonly<{
  label: string;
  /** Null means the figure is unavailable, never zero. */
  value: string | null;
  unit?: StatementUnit;
  /** A subtotal or total is ruled off from the lines above it. */
  kind?: 'item' | 'subtotal' | 'total';
  note?: string;
}>;

export type StatementGroup = Readonly<{
  heading?: string;
  lines: readonly StatementLine[];
}>;

export type Statement = Readonly<{
  groups: readonly StatementGroup[];
  notes: readonly string[];
}>;

const CATEGORY_LABELS: Record<string, string> = {
  FUEL: 'Fuel',
  WAGES: 'Wages',
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  MAINTENANCE: 'Maintenance',
  TRANSPORT: 'Transport',
  OTHER: 'Other',
};

export const EXPENSE_BASIS_NOTE =
  'Expenses are approved or recognized by expense date; pending and rejected expenses are excluded.';

function categoryLabel(category: string): string {
  const known = CATEGORY_LABELS[category];
  if (known) return known;
  const text = category.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Fuel given to staff and management is counted as fuel sold (its litres leave stock and its cost
 * is in cost of sales), so the value at selling price is shown as a cost of the benefit rather
 * than as income received. DEC-044.
 */
export function approvedFuelBenefit(report: ManagementReport): string {
  return (
    report.sales.payments?.find((row) => row.method === 'STAFF_OR_MANAGEMENT_FUEL')?.amount ?? '0'
  );
}

function hasApprovedFuel(report: ManagementReport): boolean {
  return exact(approvedFuelBenefit(report)).value.gt(0);
}

/** Recognized operating and fixed expenses; direct inventory cost is already in cost of sales. */
export function recognizedOperatingExpenseTotal(report: ManagementReport): string {
  return addExact(report.expenses.operatingTotal, report.expenses.fixedCostTotal);
}

/** The expense basis used by profit statements, including the approved-fuel benefit cost. */
export function recognizedOperatingExpenses(report: ManagementReport): string {
  return addExact(recognizedOperatingExpenseTotal(report), approvedFuelBenefit(report));
}

/** Recorded expenses summed by category, largest first. */
export function expensesByCategory(
  report: ManagementReport,
  classification?: 'OPERATING' | 'FIXED_COST',
): StatementLine[] {
  const totals = new Map<string, string>();
  for (const row of report.expenses.rows.filter(
    (expense) => !classification || expense.classification === classification,
  )) {
    totals.set(row.category, addExact(totals.get(row.category) ?? '0', row.amount));
  }
  return [...totals.entries()]
    .sort(([, left], [, right]) => exact(right).value.comparedTo(exact(left).value))
    .map(([category, amount]) => ({ label: categoryLabel(category), value: amount }));
}

export function buildProfitAndLoss(report: ManagementReport): Statement {
  const revenue = report.revenue.recognizedRevenue;
  const cogs = report.costing.restatedCogs;
  const gross = report.grossMargin;
  const net = operatingProfit(
    gross,
    recognizedOperatingExpenseTotal(report),
    approvedFuelBenefit(report),
  );
  const margin = gross === null ? null : ratioPercentage(gross, revenue);
  const notes = [
    'Revenue is recognised revenue and cost of sales is restated landed cost, both from approved records.',
    'Operating expenses and fixed costs are recognised separately. Depreciation, tax and financing costs are not included.',
    EXPENSE_BASIS_NOTE,
  ];
  if (hasApprovedFuel(report)) {
    notes.push(
      'Fuel approved for staff and management is counted as fuel sold. Its value at the selling price is shown as a benefit cost, not as income received.',
    );
  }
  if (report.costing.unvaluedSaleCount > 0) {
    notes.unshift(
      `${report.costing.unvaluedSaleCount} of ${report.costing.saleCount} sales have no cost yet, so cost of sales, gross profit and the result are not shown.`,
    );
  }
  return {
    groups: [
      {
        heading: 'Revenue',
        lines: [
          { label: 'Fuel sales', value: revenue },
          { label: 'Total revenue', value: revenue, kind: 'subtotal' },
        ],
      },
      {
        heading: 'Cost of sales',
        lines: [{ label: 'Cost of fuel sold', value: cogs, kind: 'subtotal' }],
      },
      {
        lines: [
          {
            label: 'Gross profit',
            value: gross,
            kind: 'total',
            note:
              margin === null
                ? undefined
                : `${exact(margin).value.toDecimalPlaces(1).toFixed(1)}% of revenue`,
          },
        ],
      },
      {
        heading: 'Operating expenses',
        lines: [
          ...expensesByCategory(report, 'OPERATING'),
          ...(hasApprovedFuel(report)
            ? [
                {
                  label: 'Staff and management fuel',
                  value: approvedFuelBenefit(report),
                  note: 'Approved fuel at selling price',
                },
              ]
            : []),
          {
            label: 'Total operating expenses',
            value: addExact(report.expenses.operatingTotal, approvedFuelBenefit(report)),
            kind: 'subtotal',
          },
        ],
      },
      {
        heading: 'Fixed costs',
        lines: [
          ...expensesByCategory(report, 'FIXED_COST'),
          { label: 'Total fixed costs', value: report.expenses.fixedCostTotal, kind: 'subtotal' },
        ],
      },
      { lines: [{ label: 'Net operating result', value: net, kind: 'total' }] },
    ],
    notes,
  };
}

export function buildCashMovement(report: ManagementReport): Statement {
  const { cash, providers, suppliers } = report;
  return {
    groups: [
      {
        heading: 'Cash at the stations',
        lines: [
          { label: 'Cash declared in reconciliations', value: cash.cashEvidence },
          { label: 'Collected from stations', value: cash.collected },
          { label: 'Awaiting collection', value: cash.awaitingCollection },
        ],
      },
      {
        heading: 'Banking',
        lines: [
          { label: 'Banked and confirmed', value: cash.banked },
          { label: 'Collected, not yet banked', value: cash.collectedButNotBanked, kind: 'total' },
        ],
      },
      {
        heading: 'Electronic payments',
        lines: [
          { label: 'Provider payments in reconciliations', value: providers.paymentEvidence },
          { label: 'Settlements received', value: providers.settlementGross },
          { label: 'Fees and deductions', value: providers.feesAndDeductions },
          { label: 'Not yet allocated', value: providers.unallocatedProviderAmount },
          { label: 'Payments not yet matched', value: providers.unmatchedEvidenceAmount },
        ],
      },
      {
        heading: 'Paid out',
        lines: [{ label: 'Supplier payments', value: suppliers.payments }],
      },
    ],
    notes: [
      'This shows where cash and electronic receipts stand. It is not an operating, investing and financing cash flow statement.',
      'Bank account balances are not held in this system, so no opening or closing cash is shown.',
    ],
  };
}

/** Sales by payment method with a total, for the Sales report. */
export function buildSalesByPayment(
  report: ManagementReport,
  labelFor: (method: string) => string,
): Statement {
  const total = sumExact(report.sales.payments.map((payment) => payment.amount));
  return {
    groups: [
      {
        heading: 'Payments received',
        lines: [
          ...report.sales.payments.map((payment) => ({
            label: labelFor(payment.method),
            value: payment.amount,
          })),
          { label: 'Total payments', value: total, kind: 'subtotal' as const },
        ],
      },
      {
        heading: 'Against approved sales',
        lines: [
          { label: 'Sales value', value: report.sales.salesValue },
          { label: 'Variance', value: report.sales.salesVariance, kind: 'total' as const },
        ],
      },
    ],
    notes: [],
  };
}

export function buildStockStatement(report: ManagementReport): Statement {
  const { inventory } = report;
  return {
    groups: [
      {
        heading: 'Stock',
        lines: [
          { label: 'Expected stock', value: inventory.expectedLitres, unit: 'litres' },
          { label: 'Measured stock', value: inventory.physicalLitres, unit: 'litres' },
          {
            label: 'Variance',
            value: inventory.varianceLitres,
            unit: 'litres',
            kind: 'total',
          },
        ],
      },
      {
        heading: 'Deliveries received',
        lines: [
          { label: 'Litres delivered', value: inventory.deliveryLitres, unit: 'litres' },
          { label: 'Landed cost', value: inventory.deliveryValue },
        ],
      },
    ],
    notes: [],
  };
}

export function buildProviderStatement(report: ManagementReport): Statement {
  const { providers } = report;
  return {
    groups: [
      {
        heading: 'Evidence and settlements',
        lines: [
          { label: 'Provider payments in reconciliations', value: providers.paymentEvidence },
          { label: 'Settlements received', value: providers.settlementGross },
          { label: 'Fees and deductions', value: providers.feesAndDeductions },
        ],
      },
      {
        heading: 'Matching',
        lines: [
          { label: 'Allocated', value: providers.allocatedAmount },
          { label: 'Not yet allocated', value: providers.unallocatedProviderAmount },
          { label: 'Payments not yet matched', value: providers.unmatchedEvidenceAmount },
        ],
      },
    ],
    notes: [],
  };
}

export function buildCommercialStatement(report: ManagementReport): Statement {
  const { suppliers, customers } = report;
  return {
    groups: [
      {
        heading: 'Suppliers',
        lines: [
          { label: 'Invoices', value: suppliers.invoiceValue },
          { label: 'Credit notes', value: suppliers.creditNoteValue },
          { label: 'Payments', value: suppliers.payments },
          { label: 'Balance owed', value: suppliers.outstandingBalance, kind: 'total' },
        ],
      },
      {
        heading: 'Customers',
        lines: [
          { label: 'Receivables', value: customers.receivableBalance },
          { label: 'Prepaid balances', value: customers.prepaidValueBalance },
          { label: 'Reserved amount', value: customers.reservedAmount },
        ],
      },
    ],
    notes: [
      'Balances are as of the end date. Prepaid litres are shown as litres, not converted to money.',
      ...(customers.availability === 'AVAILABLE'
        ? []
        : [
            'Customer balances are kept for the whole organisation, so they are not shown for a single station.',
          ]),
    ],
  };
}

/**
 * Net current position: what the business holds or is owed, less what it owes, as of the end
 * date. It is a management view of the short-term position, not a balance sheet: stock at cost,
 * bank balances and unpaid expenses are not in it.
 */
export function buildNetPosition(report: ManagementReport): Statement {
  const { cash, providers, suppliers, customers } = report;
  const customersKnown =
    customers.availability === 'AVAILABLE' &&
    customers.receivableBalance !== null &&
    customers.prepaidValueBalance !== null;
  const holds = customersKnown
    ? sumExact([
        cash.collectedButNotBanked,
        providers.unmatchedEvidenceAmount,
        customers.receivableBalance!,
      ])
    : null;
  const owes = customersKnown
    ? sumExact([suppliers.outstandingBalance, customers.prepaidValueBalance!])
    : null;
  return {
    groups: [
      {
        heading: 'What the business holds or is owed',
        lines: [
          { label: 'Cash collected, not yet banked', value: cash.collectedButNotBanked },
          {
            label: 'Card and mobile payments not yet received',
            value: providers.unmatchedEvidenceAmount,
          },
          { label: 'Owed by credit customers', value: customers.receivableBalance },
          { label: 'Total held or owed to us', value: holds, kind: 'subtotal' },
        ],
      },
      {
        heading: 'What the business owes',
        lines: [
          { label: 'Owed to suppliers', value: suppliers.outstandingBalance },
          { label: 'Prepaid customer balances', value: customers.prepaidValueBalance },
          { label: 'Total owed by us', value: owes, kind: 'subtotal' },
        ],
      },
      {
        lines: [
          {
            label: 'Net current position',
            value: holds === null || owes === null ? null : subtractExact(holds, owes),
            kind: 'total',
          },
        ],
      },
    ],
    notes: [
      'Stock at cost, bank account balances and unpaid expenses are not included.',
      ...(customersKnown
        ? []
        : [
            'Customer balances are kept for the whole organisation, so the net position is only shown when all stations are included.',
          ]),
    ],
  };
}

export type PositionFlag = 'POSITIVE' | 'NEGATIVE' | 'EVEN' | 'UNAVAILABLE';

export type FinancialPosition = Readonly<{
  statement: Statement;
  /** Total of what we hold or are owed; null when any included figure is unknown. */
  totalHeld: string | null;
  /** Total of what we owe; null when any included figure is unknown. */
  totalOwed: string | null;
  net: string | null;
  flag: PositionFlag;
  /** Names of the figures that are not known, so a screen can say why there is no net. */
  missing: readonly string[];
}>;

/**
 * The owner's financial position: what the business holds or is owed (cash at stations, banked
 * cash, card and mobile payments awaiting settlement, debtors, stock at cost) less what it owes
 * (suppliers, unpaid expenses, prepaid customer balances). The net is shown only when every
 * included figure is known, with a clear positive or negative flag. Liabilities the system does
 * not record (transporters and other creditors) are listed as not recorded and left out of the
 * total. Unlike buildNetPosition, which the existing report screens use, this one includes stock
 * value, banked cash and unpaid expenses.
 */
export function buildFinancialPosition(report: ManagementReport): FinancialPosition {
  const { cash, providers, suppliers, customers } = report;
  const extra = report.ownerPosition ?? null;
  const customersKnown =
    customers.availability === 'AVAILABLE' &&
    customers.receivableBalance !== null &&
    customers.prepaidValueBalance !== null;
  // The bank statement balance is used when every account has one; otherwise the deposits recorded
  // in the chosen dates stand in for it. Never both, or the same money would be counted twice.
  const bank = extra?.bankBalance;
  const bankLine: StatementLine =
    bank?.amount != null
      ? {
          label: 'Money in the bank (from the bank statement)',
          value: bank.amount,
          note: bank.asOfDate ? `Balance as at ${bank.asOfDate}.` : undefined,
        }
      : {
          label: 'Cash banked',
          value: cash.custody?.banked ?? cash.banked,
          note:
            bank && bank.accountsTotal > 0
              ? `Type in the bank statement balance in Settings (${bank.accountsWithBalance} of ${bank.accountsTotal} accounts so far) to use it instead of recorded deposits.`
              : undefined,
        };
  // Each collected amount is in exactly one of these places (B4), as at the end date.
  const atStation = cash.custody?.atStation ?? cash.atStation ?? cash.collectedButNotBanked;
  const withCollector = cash.custody?.withCollector ?? '0';
  const heldByManagement = cash.custody?.heldByManagement ?? cash.heldByManagement ?? '0';
  const inTransit = cash.custody?.awaitingBank ?? cash.inTransit ?? '0';
  const held: StatementLine[] = [
    { label: 'Cash at stations, not yet banked', value: atStation },
    { label: 'Cash with a collector', value: withCollector },
    { label: 'Cash held by management', value: heldByManagement },
    { label: 'Cash deposited, awaiting confirmation', value: inTransit },
    bankLine,
    {
      label: 'Card and mobile payments awaiting settlement',
      value: providers.unmatchedEvidenceAmount,
    },
    { label: 'Owed by credit customers', value: customers.receivableBalance },
    {
      label: 'Fuel stock at cost',
      value: extra?.stockValue ?? null,
      note:
        extra && extra.stockValue === null
          ? `${extra.unvaluedStockStreams} tank(s) hold fuel with no cost yet.`
          : extra
            ? undefined
            : 'Not available.',
    },
  ];
  const owed: StatementLine[] = [
    { label: 'Owed to suppliers', value: suppliers.outstandingBalance },
    { label: 'Expenses not yet paid', value: extra?.unpaidExpenses ?? null },
    { label: 'Prepaid customer balances', value: customers.prepaidValueBalance },
    {
      label: 'Fuel received, not yet invoiced',
      value: extra?.receivedNotInvoiced?.value ?? null,
      note: !extra?.receivedNotInvoiced
        ? 'Not available.'
        : extra.receivedNotInvoiced.value === null
          ? `${extra.receivedNotInvoiced.unpricedLitres} litres were received with no cost recorded yet.`
          : undefined,
    },
    {
      label: 'Transporters and other creditors',
      value: null,
      note: 'A transporter set up as a supplier is already counted under suppliers. Other creditors are not recorded, so are not in the total.',
    },
  ];
  const countable = (line: StatementLine) => line.label !== 'Transporters and other creditors';
  const missing = [...held, ...owed.filter(countable)]
    .filter((line) => line.value === null)
    .map((line) => line.label);
  const totalHeld = held.some((l) => l.value === null) ? null : sumExact(held.map((l) => l.value));
  const totalOwed = owed.filter(countable).some((l) => l.value === null)
    ? null
    : sumExact(owed.filter(countable).map((l) => l.value));
  const net = totalHeld === null || totalOwed === null ? null : subtractExact(totalHeld, totalOwed);
  const flag: PositionFlag =
    net === null
      ? 'UNAVAILABLE'
      : exact(net).value.isZero()
        ? 'EVEN'
        : exact(net).value.isNegative()
          ? 'NEGATIVE'
          : 'POSITIVE';
  return {
    statement: {
      groups: [
        {
          heading: 'What the business holds or is owed',
          lines: [
            ...held,
            { label: 'Total held or owed to us', value: totalHeld, kind: 'subtotal' },
          ],
        },
        {
          heading: 'What the business owes',
          lines: [...owed, { label: 'Total owed by us', value: totalOwed, kind: 'subtotal' }],
        },
        { lines: [{ label: 'Net position', value: net, kind: 'total' }] },
      ],
      notes: [
        bank?.amount != null
          ? 'Money in the bank is the balance typed in from the bank statement.'
          : 'Cash banked is the deposits recorded in the chosen dates; it is not a bank statement balance.',
        'Stock, unpaid expenses and fuel received but not yet invoiced are shown as they stand now.',
        ...(customersKnown
          ? []
          : [
              'Customer balances are kept for the whole organisation, so the net position is only shown when all stations are included.',
            ]),
      ],
    },
    totalHeld,
    totalOwed,
    net,
    flag,
    missing,
  };
}

export type QuickFigure = Readonly<{
  id: string;
  label: string;
  value: string | null;
  unit?: StatementUnit;
  /** The report that explains the figure. */
  slug: string;
}>;

/** The handful of figures an owner looks at first, each linked to the report behind it. */
export function buildQuickFigures(report: ManagementReport): QuickFigure[] {
  const gross = report.grossMargin;
  const totalExpenses = recognizedOperatingExpenses(report);
  const net = operatingProfit(
    gross,
    recognizedOperatingExpenseTotal(report),
    approvedFuelBenefit(report),
  );
  return [
    { id: 'sales', label: 'Total Sales', value: report.sales.salesValue, slug: 'sales' },
    { id: 'gross', label: 'Gross Profit', value: gross, slug: 'profit-loss' },
    { id: 'expenses', label: 'Total Expenses', value: totalExpenses, slug: 'profit-loss' },
    { id: 'net', label: 'Net Profit', value: net, slug: 'profit-loss' },
    { id: 'banked', label: 'Banked Cash', value: report.cash.banked, slug: 'cash-movement' },
    {
      id: 'unbanked',
      label: 'Cash',
      value: report.cash.collectedButNotBanked,
      slug: 'cash-movement',
    },
    {
      id: 'stock',
      label: 'Stock on Hand',
      value: report.inventory.expectedLitres,
      unit: 'litres',
      slug: 'inventory',
    },
    {
      id: 'creditors',
      label: 'Creditors',
      value: report.suppliers.outstandingBalance,
      slug: 'commercial',
    },
    {
      id: 'debtors',
      label: 'Debtors',
      value: report.customers.receivableBalance,
      slug: 'commercial',
    },
    {
      id: 'settlements',
      label: 'Settlements to Receive',
      // One definition everywhere: approved POS/EcoCash evidence not yet allocated to a
      // provider settlement. `unallocatedProviderAmount` is the opposite queue (payouts waiting
      // to be matched), so it is not the amount the business is still due to receive.
      value: report.providers.unmatchedEvidenceAmount,
      slug: 'providers',
    },
  ];
}

/** One row of the comparative income statement. */
export type IncomeRow = Readonly<{
  id: string;
  label: string;
  kind: 'section' | 'heading' | 'detail' | 'subtotal' | 'total';
  unit?: StatementUnit;
  /** Detail rows belong to the section above them and fold away with it. */
  parentId?: string;
  current: string | null;
  /** Null when the previous period is unavailable. */
  previous: string | null;
  note?: string;
}>;

export type IncomeStatement = Readonly<{
  rows: readonly IncomeRow[];
  notes: readonly string[];
}>;

/**
 * The income statement for a period beside the period before it. Every figure is
 * what the two management reports already carry, or an exact difference of them.
 */
export function buildIncomeStatement(
  current: ManagementReport,
  previous: ManagementReport | null,
): IncomeStatement {
  const net = (report: ManagementReport | null) =>
    report === null || report.grossMargin === null
      ? null
      : subtractExact(report.grossMargin, recognizedOperatingExpenses(report));
  const margin =
    current.grossMargin === null
      ? null
      : ratioPercentage(current.grossMargin, current.revenue.recognizedRevenue);

  const now = expensesByCategory(current);
  const before = new Map(
    previous ? expensesByCategory(previous).map((line) => [line.label, line.value]) : [],
  );
  const labels = [...now.map((line) => line.label)];
  for (const label of before.keys()) if (!labels.includes(label)) labels.push(label);
  const nowByLabel = new Map(now.map((line) => [line.label, line.value]));

  const rows: IncomeRow[] = [
    {
      id: 'revenue',
      label: 'Revenue',
      kind: 'section',
      current: current.revenue.recognizedRevenue,
      previous: previous?.revenue.recognizedRevenue ?? null,
    },
    {
      id: 'cogs',
      label: 'Cost of sales',
      kind: 'section',
      current: current.costing.restatedCogs,
      previous: previous?.costing.restatedCogs ?? null,
    },
    {
      id: 'gross',
      label: 'Gross profit',
      kind: 'total',
      current: current.grossMargin,
      previous: previous?.grossMargin ?? null,
      note:
        margin === null
          ? undefined
          : `${exact(margin).value.toDecimalPlaces(1).toFixed(1)}% of revenue`,
    },
    {
      id: 'expenses',
      label: 'Operating expenses',
      kind: 'section',
      current: recognizedOperatingExpenses(current),
      previous: previous ? recognizedOperatingExpenses(previous) : null,
    },
    ...labels.map((label): IncomeRow => ({
      id: `expense-${label}`,
      label,
      kind: 'detail',
      parentId: 'expenses',
      current: nowByLabel.get(label) ?? '0',
      previous: previous ? (before.get(label) ?? '0') : null,
    })),
    {
      id: 'net',
      label: 'Net operating result',
      kind: 'total',
      current: net(current),
      previous: net(previous),
    },
  ];

  const notes: string[] = [EXPENSE_BASIS_NOTE];
  if (current.costing.unvaluedSaleCount > 0) {
    notes.push(
      `${current.costing.unvaluedSaleCount} of ${current.costing.saleCount} sales have no cost yet, so gross profit and the result are not shown.`,
    );
  }
  return { rows, notes };
}

/**
 * Any statement beside the same statement for the period before, line by line.
 * Headings fold their lines away; subtotals and totals stay visible.
 */
export function compareStatement(current: Statement, previous: Statement | null): IncomeStatement {
  const before = new Map<string, string | null>();
  if (previous) {
    for (const group of previous.groups) {
      for (const line of group.lines)
        before.set(`${group.heading ?? ''}|${line.label}`, line.value);
    }
  }
  const rows: IncomeRow[] = [];
  current.groups.forEach((group, index) => {
    const parentId = group.heading ? `group-${index}` : undefined;
    if (group.heading && parentId) {
      rows.push({
        id: parentId,
        label: group.heading,
        kind: 'heading',
        current: null,
        previous: null,
      });
    }
    for (const line of group.lines) {
      const key = `${group.heading ?? ''}|${line.label}`;
      const kind = line.kind ?? 'item';
      rows.push({
        id: `${index}-${line.label}`,
        label: line.label,
        kind: kind === 'item' ? 'detail' : kind,
        parentId: kind === 'item' ? parentId : undefined,
        unit: line.unit,
        current: line.value,
        previous: previous ? (before.get(key) ?? null) : null,
        note: line.note,
      });
    }
  });
  return { rows, notes: current.notes };
}
