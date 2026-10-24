import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/purchasing',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { PurchasingWorkspace } from './purchasing-workspace';

const resolution = {
  current: { organisationId: 't', legalEntityId: 'e', stationId: null, allStations: true },
  available: {
    organisations: [
      {
        id: 't',
        name: 'Org',
        legalEntities: [
          {
            id: 'e',
            name: 'Co',
            stations: [{ id: 's', code: 'S', name: 'Main', timezone: 'UTC' }],
          },
        ],
      },
    ],
  },
  route: {
    pathname: '/purchasing',
    policy: { legalEntity: 'required', station: 'optional', allStationsAllowed: true },
  },
  persistedContextInvalid: false,
} as never;

const caps = {
  viewOrders: true,
  createOrders: true,
  approveOrders: false,
  cancelOrders: false,
  reviewInvoices: true,
  viewSettings: true,
  manageSettings: false,
};

describe('PurchasingWorkspace', () => {
  it('shows every section in plain words', () => {
    const html = renderToStaticMarkup(
      createElement(PurchasingWorkspace, { resolution, capabilities: caps }),
    );
    for (const text of [
      'Purchase orders',
      'Not invoiced yet',
      'Invoice checks',
      'Settings',
      'New purchase order',
    ]) {
      expect(html).toContain(text);
    }
  });
  it('explains missing access', () => {
    const none = Object.fromEntries(Object.keys(caps).map((k) => [k, false])) as typeof caps;
    const html = renderToStaticMarkup(
      createElement(PurchasingWorkspace, { resolution, capabilities: none }),
    );
    expect(html).toContain('do not have access to purchasing');
  });
});
