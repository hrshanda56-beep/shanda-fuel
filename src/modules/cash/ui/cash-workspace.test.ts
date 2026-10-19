import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/stations/station/cash',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

import { CashWorkspace, type CashSummary } from './cash-workspace';

const selection = {
  organisationId: 'tenant',
  legalEntityId: 'entity',
  stationId: 'station',
  allStations: false,
};

const summary: CashSummary = {
  stationId: 'station',
  currency: 'USD',
  totals: {
    availableAtStation: '200.00',
    collectedButUnbanked: '600.00',
    pendingBankConfirmation: '400.00',
  },
  collections: [
    {
      collectionId: 'c1',
      collectionReference: 'COL-001',
      amount: '400.00',
      allocatedAmount: '400.00',
      confirmedAmount: '0',
      availableAtStation: '0',
      collectedButUnbanked: '400.00',
      pendingBankConfirmation: '400.00',
      state: 'RECORDED',
      custodyState: 'IN_TRANSIT',
      sourceLocationId: 'l1',
      currentLocationId: 'l1',
      version: 1,
      recordedAt: '2026-10-17T14:05:00.000Z',
    },
    {
      collectionId: 'c2',
      collectionReference: 'COL-002',
      amount: '200.00',
      allocatedAmount: '0',
      confirmedAmount: '0',
      availableAtStation: '200.00',
      collectedButUnbanked: '200.00',
      pendingBankConfirmation: '0',
      state: 'RECORDED',
      custodyState: 'AT_STATION',
      sourceLocationId: 'l1',
      currentLocationId: 'l1',
      version: 1,
      recordedAt: '2026-10-18T06:30:00.000Z',
    },
  ],
  locations: [
    { locationId: 'l1', code: 'SAFE', name: 'Station safe', locationType: 'STATION_SAFE' },
  ],
  reconciliationSources: [],
  bankAccounts: [
    { bankAccountId: 'b1', name: 'Operating', bankName: 'Bank', accountReferenceMasked: '****1' },
  ],
  deposits: [
    {
      depositId: 'd1',
      depositReference: 'DEP-001',
      amount: '400.00',
      state: 'RECORDED',
      version: 1,
      sourceLocationId: 'l1',
      bankAccountId: 'b1',
      bankAccountName: 'Operating',
      confirmedAmount: null,
      confirmationVariance: null,
      bankReference: null,
      depositedAt: '2026-10-18T08:15:00.000Z',
    },
  ],
  capabilities: {
    viewDeposits: true,
    recordCollection: true,
    receiveCollection: true,
    recordDeposit: true,
    confirmDeposit: true,
  },
};

function render(next: CashSummary) {
  return renderToStaticMarkup(
    createElement(CashWorkspace, { initial: { selection, summary: next } }),
  );
}

describe('Cash and banking, plain-language guidance', () => {
  it('puts a waiting deposit first, and gives each row a way to open its details', () => {
    const html = render(summary);
    expect(html).toContain('1 bank deposit is waiting');
    expect(html).toContain('Confirm deposits');
    // Two collections and one deposit, each expandable.
    expect(html.match(/class="row-action"/g)).toHaveLength(3);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
    // The cash at the station and the deposit waiting on the bank each get their own action.
    expect(html).toContain('>Bank it<');
    expect(html).toContain('>Confirm<');
  });

  it('tells the person to bank cash when nothing is waiting on the bank', () => {
    const html = render({
      ...summary,
      deposits: [],
      capabilities: { ...summary.capabilities, confirmDeposit: false },
    });
    expect(html).toContain('USD 200.00 is at the station and not banked yet.');
    expect(html).toContain('Bank cash');
  });

  it('shows three parts that never overlap instead of a collected-not-banked slice', () => {
    const html = render(summary);
    expect(html).toContain('At the station');
    expect(html).toContain('Waiting for the bank');
    expect(html).toContain('Banked');
    expect(html).not.toContain('Collected, not banked');
  });

  it('uses plain words for where cash is and for deposit status', () => {
    const html = render(summary);
    expect(html).toContain('Sent to bank');
    expect(html).toContain('Waiting for bank');
    expect(html).not.toContain('IN_TRANSIT');
    expect(html).not.toContain('Confirmation variance');
  });

  it('shows when cash was collected and deposited, in station time', () => {
    const html = render(summary);
    expect(html).toContain('17 Oct 2026, 16:05');
    expect(html).toContain('18 Oct 2026, 08:30');
    expect(html).toContain('18 Oct 2026, 10:15');
  });

  it('does not offer actions to a view-only role, but still lets rows open', () => {
    const html = render({
      ...summary,
      capabilities: {
        viewDeposits: true,
        recordCollection: false,
        receiveCollection: false,
        recordDeposit: false,
        confirmDeposit: false,
      },
    });
    expect(html).not.toContain('>Bank it<');
    expect(html).not.toContain('>Confirm<');
    expect(html).not.toContain('is at the station and not banked yet');
    expect(html).toContain('No cash actions available');
  });

  it('says there is nothing to do yet when no cash has been collected', () => {
    const html = render({
      ...summary,
      collections: [],
      deposits: [],
      totals: { availableAtStation: '0', collectedButUnbanked: '0', pendingBankConfirmation: '0' },
    });
    expect(html).toContain('Nothing to do yet.');
  });
});
