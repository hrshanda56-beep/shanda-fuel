import { exact } from '@/modules/reporting/domain';

type Balance = { overdue: string; total: string };

export function isOverdue(row: Pick<Balance, 'overdue'>): boolean {
  return exact(row.overdue).value.greaterThan(0);
}

/** Share of the balance that is overdue, 0 to 100. Drawing only; amounts stay exact strings. */
export function overduePercent(row: Balance): number {
  const total = exact(row.total).value;
  if (!total.greaterThan(0)) return 0;
  const share = exact(row.overdue).value.div(total).times(100).toNumber();
  return Math.min(100, Math.max(0, Math.round(share)));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/** "INVOICE_POSTED" becomes "Invoice posted". */
export function movementLabel(type: string): string {
  const text = type.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
