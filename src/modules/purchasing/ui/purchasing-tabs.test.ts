import { describe, expect, it } from 'vitest';
import { availableTabs, resolveTab } from './purchasing-tabs';

const none = {
  viewOrders: false,
  createOrders: false,
  approveOrders: false,
  cancelOrders: false,
  reviewInvoices: false,
  viewSettings: false,
  manageSettings: false,
};

describe('purchasing sections', () => {
  it('shows only what the person may use', () => {
    expect(availableTabs(none)).toEqual([]);
    expect(availableTabs({ ...none, viewOrders: true }).map((t) => t.value)).toEqual(['orders']);
    expect(
      availableTabs({ ...none, viewOrders: true, reviewInvoices: true, viewSettings: true }).map(
        (t) => t.value,
      ),
    ).toEqual(['orders', 'not-invoiced', 'checks', 'settings']);
  });
  it('falls back to the first allowed section', () => {
    const tabs = availableTabs({ ...none, reviewInvoices: true });
    expect(resolveTab('settings', tabs)).toBe('not-invoiced');
    expect(resolveTab('checks', tabs)).toBe('checks');
    expect(resolveTab(null, [])).toBeNull();
  });
});
