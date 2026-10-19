import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/customers',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/modules/context/client-context', () => ({ useContextFetch: () => fetch }));

import { CustomerWorkspace } from './customer-workspace';
import type { CustomerSummary } from './types';

const resolution = {
  current: {
    organisationId: 'tenant',
    legalEntityId: null,
    stationId: null,
    allStations: true,
  },
} as never;

const customers: CustomerSummary[] = [
  {
    customerId: 'c1',
    accountReference: 'CUST-0001',
    displayName: 'Matabeleland Haulage',
    status: 'ACTIVE',
    version: 1,
    legalEntityId: 'le',
    legalEntityName: 'Shanda Fuel (Pvt) Ltd',
    canManageConfiguration: false,
    capabilities: { recordPayment: false, topUp: false, manageCustomer: false, openAccount: false },
    contactMetadata: { phone: '+263 77 100 0001' },
    accounts: [
      {
        accountId: 'a1',
        accountType: 'CREDIT',
        status: 'ACTIVE',
        version: 1,
        legalEntityId: 'le',
        stationScope: 'ALL',
        stationScopeConfigured: true,
        allowedStationIds: [],
        ready: true,
        currency: 'USD',
        creditLimit: '5000.0000',
        balance: '0.0000',
        availableBalance: null,
        availableCredit: '5000.0000',
        reservedAmount: '0.0000',
        productBalances: [],
      },
    ],
    recentTransactions: [],
  },
];

describe('Customers list rows', () => {
  it('start closed, each with a button to show more', () => {
    const html = renderToStaticMarkup(
      createElement(CustomerWorkspace, { initial: { resolution, customers } }),
    );
    expect(html).toContain('Matabeleland Haulage');
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(html).toContain('Show details for Matabeleland Haulage');
    expect(html).not.toContain('Open full account');
    expect(html).not.toContain('Latest activity');
  });
});
