import type { PurchasingCapabilities } from '../capabilities-types';

export type PurchasingTab = 'orders' | 'not-invoiced' | 'checks' | 'settings';

/** The sections this person can use, in the order they appear. */
export function availableTabs(
  capabilities: PurchasingCapabilities,
): Array<{ value: PurchasingTab; label: string }> {
  const tabs: Array<{ value: PurchasingTab; label: string }> = [];
  if (capabilities.viewOrders) tabs.push({ value: 'orders', label: 'Purchase orders' });
  if (capabilities.reviewInvoices) {
    tabs.push({ value: 'not-invoiced', label: 'Not invoiced yet' });
    tabs.push({ value: 'checks', label: 'Invoice checks' });
  }
  if (capabilities.viewSettings) tabs.push({ value: 'settings', label: 'Settings' });
  return tabs;
}

/** The requested tab when allowed, otherwise the first one available. */
export function resolveTab(
  requested: string | null,
  tabs: ReadonlyArray<{ value: PurchasingTab }>,
): PurchasingTab | null {
  return tabs.find((tab) => tab.value === requested)?.value ?? tabs[0]?.value ?? null;
}
