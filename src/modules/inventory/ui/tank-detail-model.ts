/** Pure helpers for the tank page: plain-language wording and the placeholder tank count. */
import type { StockSignal } from '../../approvals/operations-alerts';

export type TankTab = 'dips' | 'movements' | 'settings';

export const TANK_TABS: ReadonlyArray<{ value: TankTab; label: string }> = [
  { value: 'dips', label: 'Dips' },
  { value: 'movements', label: 'Stock movements' },
  { value: 'settings', label: 'Settings' },
];

/** The tab named in the address, or the first one; "settings" is only offered to people who can change it. */
export function tankTabFrom(value: string | null | undefined, canManage: boolean): TankTab {
  const found = TANK_TABS.find((tab) => tab.value === value);
  if (!found || (found.value === 'settings' && !canManage)) return 'dips';
  return found.value;
}

function litres(value: number): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(value)} L`;
}

/** One sentence a supervisor can act on: how far a dip was from the books, and what to do about it. */
export function dipSentence(varianceLitres: string, signal: StockSignal): string {
  const variance = Number(varianceLitres);
  if (!Number.isFinite(variance)) return 'This dip could not be compared with the books.';
  if (variance === 0) return 'Exactly what the books expected.';
  const amount = litres(Math.abs(variance));
  const direction = variance < 0 ? 'under' : 'over';
  switch (signal) {
    case 'ok':
      return `${amount} ${direction} the books, within the limit.`;
    case 'watch':
      return `${amount} ${direction} the books. Please explain the difference.`;
    case 'alert':
      return `${amount} ${direction} the books. Check this tank now.`;
    default:
      return `${amount} ${direction} the books. No limit is set yet, so it was not judged.`;
  }
}

/** How full a tank is, 0 to 100, or null when the capacity is not a usable number. */
export function fillPercent(bookLitres: string, capacityLitres: string): number | null {
  const capacity = Number(capacityLitres);
  const book = Number(bookLitres);
  if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(book)) return null;
  return Math.max(0, Math.min(100, Math.round((book / capacity) * 100)));
}

/** Running stock after each movement, newest first as the page lists them. */
export function runningBalances(
  movements: readonly { quantityLitres: string }[],
  currentLitres: string,
): string[] {
  let balance = Number(currentLitres);
  return movements.map((movement) => {
    const after = balance;
    balance -= Number(movement.quantityLitres);
    return String(after);
  });
}

/**
 * One "Add a tank" slot after the real tanks, so the row has a way in to adding another and is
 * not left blank. Never several identical cards; none when the row is exactly full.
 */
export function placeholderTankCount(tankCount: number, rowSize = 4): number {
  if (tankCount <= 0) return 1;
  return tankCount % rowSize === 0 ? 0 : 1;
}
