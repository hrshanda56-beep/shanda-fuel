/**
 * Accounting-statement layouts built from the management report. Every figure is
 * one the report already carries, or an exact sum or difference of such figures.
 * Nothing here is a ledger balance: these are management statements, unaudited.
 * Pure; no UI or database code.
 */
import type { ManagementReport } from './contracts';
import { addExact, exact, ratioPercentage, subtractExact, sumExact } from './domain';

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

function recognizedOperatingExpenses(report: ManagementReport): string {
  return addExact(
    addExact(report.expenses.operatingTotal, report.expenses.fixedCostTotal),
    approvedFuelBenefit(report),
  );
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
  const operatingExpenses = recognizedOperatingExpenses(report);
  const net = gross === null ? null : subtractExact(gross, operatingExpenses);
  const margin = gross === null ? null : ratioPercentage(gross, revenue);
  const notes = [
    'Revenue is recognised revenue and cost of sales is restated landed cost, both from approved records.',
    'Operating expenses and fixed costs are recognised separately. Depreciation, tax and financing costs are not included.',
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
  const totalExpenses = addExact(report.expenses.total, approvedFuelBenefit(report));
  const net = gross === null ? null : subtractExact(gross, totalExpenses);
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
      value: report.providers.unallocatedProviderAmount,
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

  const notes: string[] = [];
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
