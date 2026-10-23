import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement('a', { href }, children as never),
}));

import { AccountControlsWorkspace } from './account-controls-workspace';
import type { CustomerSummary } from './types';

const customer: CustomerSummary = {
  customerId: 'c1',
  accountReference: 'C-1',
  displayName: 'Acme Transport',
  status: 'ACTIVE',
  version: 1,
  legalEntityId: 'le1',
  legalEntityName: 'TEI Oils',
  canManageConfiguration: false,
  capabilities: { recordPayment: true, topUp: false, manageCustomer: false, openAccount: false },
  contactMetadata: {},
  recentTransactions: [],
  accounts: [
    {
      accountId: 'a1',
      accountType: 'CREDIT',
      status: 'ACTIVE',
      version: 2,
      legalEntityId: 'le1',
      stationScope: 'ALL',
      stationScopeConfigured: true,
      allowedStationIds: [],
      ready: true,
      currency: 'USD',
      creditLimit: '1000.0000',
      balance: '250.5000',
      availableBalance: null,
      availableCredit: '749.5000',
      reservedAmount: '0',
      productBalances: [],
    },
  ],
};

const base = {
  tenantId: 't1',
  currentStationId: null,
  stations: [],
  approvers: [{ membershipId: 'm1', name: 'Rudo Moyo' }],
};

describe('account controls workspace', () => {
  it('shows each credit customer with the exact figures and a whole-row action', () => {
    const html = renderToStaticMarkup(
      createElement(AccountControlsWorkspace, {
        ...base,
        customers: [customer],
        canOverrideLimit: true,
        canRecordDetails: true,
      }),
    );
    expect(html).toContain('Acme Transport');
    expect(html).toContain('250.50');
    expect(html).toContain('1,000.00');
    expect(html).toContain('role="button"');
    expect(html).toContain('Change credit limit for Acme Transport');
  });

  it('is read-only without the override permission', () => {
    const html = renderToStaticMarkup(
      createElement(AccountControlsWorkspace, {
        ...base,
        customers: [customer],
        canOverrideLimit: false,
        canRecordDetails: false,
      }),
    );
    expect(html).not.toContain('Change credit limit for');
    expect(html).toContain('needs permission from management');
  });

  it('says plainly when there are no credit customers', () => {
    const html = renderToStaticMarkup(
      createElement(AccountControlsWorkspace, {
        ...base,
        customers: [],
        canOverrideLimit: true,
        canRecordDetails: true,
      }),
    );
    expect(html).toContain('No credit customers yet');
  });
});
