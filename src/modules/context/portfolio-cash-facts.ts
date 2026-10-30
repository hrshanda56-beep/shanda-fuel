import { formatUsd } from '@/design-system/formatters';
import type { PortfolioFact } from './portfolio-data';

const LABELS: Record<string, string> = {
  availableAtStation: 'Cash at the station',
  heldByManagement: 'Held by management',
  collectedButUnbanked: 'Collected, not yet deposited',
  pendingBankConfirmation: 'Deposited, bank has not confirmed',
};

/** A field name such as "somethingNew" read as words, for a figure that has no wording above. */
function wordsFor(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** The cash figures for one station on the all-stations overview, in plain words with readable money. */
export function cashFacts(
  totals: Readonly<Record<string, unknown>>,
  currency: string,
): PortfolioFact[] {
  return Object.entries(totals).map(([key, value]) => ({
    label: LABELS[key] ?? wordsFor(key),
    value: currency === 'USD' ? formatUsd(String(value)) : `${currency} ${String(value)}`,
  }));
}
