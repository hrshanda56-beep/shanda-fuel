import type { StatusTone } from './primitives';

/**
 * One status vocabulary for the whole product. Every chip, card and header calls
 * `getDisplayStatus`, so "Open" looks and reads the same on every page.
 *
 * Neutral (grey): not started, draft, closed. In progress (blue-grey): open, in progress.
 * Waiting (amber): submitted, pending approval, awaiting bank confirmation.
 * Done (deep green): approved, banked, matched. Problem (red): returned, exception, low stock.
 */
export type DisplayStatus = Readonly<{ label: string; tone: StatusTone }>;

const STATUSES: Record<string, DisplayStatus> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  PLANNED: { label: 'Not started', tone: 'neutral' },
  DRAFT: { label: 'Draft', tone: 'neutral' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  NOT_OPERATED: { label: 'Not operated', tone: 'neutral' },
  LOCKED: { label: 'Closed', tone: 'neutral' },
  OPEN: { label: 'Open', tone: 'progress' },
  IN_PROGRESS: { label: 'In progress', tone: 'progress' },
  METER_CLOSED: { label: 'Meters closed', tone: 'progress' },
  SUBMITTED: { label: 'Submitted', tone: 'warning' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'warning' },
  AWAITING_BANK_CONFIRMATION: { label: 'Awaiting bank confirmation', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'positive' },
  COMPLETED: { label: 'Completed', tone: 'positive' },
  BANKED: { label: 'Banked', tone: 'positive' },
  MATCHED: { label: 'Matched', tone: 'positive' },
  POSTED: { label: 'Approved', tone: 'positive' },
  RETURNED: { label: 'Returned', tone: 'critical' },
  EXCEPTION: { label: 'Exception', tone: 'critical' },
  LOW_STOCK: { label: 'Low stock', tone: 'critical' },
};

function sentenceCase(raw: string): string {
  const text = raw.toLowerCase().replaceAll('_', ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '—';
}

/** The label and colour for a raw state string from the server. */
export function getDisplayStatus(state: string | null | undefined): DisplayStatus {
  const key = (state ?? 'NOT_STARTED').toUpperCase().replaceAll(' ', '_');
  return STATUSES[key] ?? { label: sentenceCase(key), tone: 'neutral' };
}
