import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildDueSchedule } from '../due-schedule';
import { SupplierDueView } from './supplier-due-view';

const selection = {
  organisationId: 'tenant',
  legalEntityId: 'le',
  stationId: null,
  allStations: false,
} as never;

function render(invoices: Parameters<typeof buildDueSchedule>[0]) {
  return renderToStaticMarkup(
    createElement(SupplierDueView, {
      data: buildDueSchedule(invoices, '2026-10-23'),
      selection,
      search: '',
    }),
  );
}

describe('SupplierDueView', () => {
  it('says plainly that nothing is waiting, and shows no invented figures', () => {
    const html = render([]);
    expect(html).toContain('Nothing is waiting to be paid');
    expect(html).not.toContain('list-rows');
  });

  it('lists unpaid invoices by when they fall due, each row a link to the supplier', () => {
    const html = render([
      {
        documentId: 'd1',
        supplierId: 's1',
        supplierName: 'Puma Energy',
        referenceNumber: 'INV-77',
        documentDate: '2026-10-01',
        dueDate: '2026-10-08',
        paymentTerms: 'CREDIT',
        creditPeriodDays: 7,
        balance: '1250.5000',
      },
      {
        documentId: 'd2',
        supplierId: 's2',
        supplierName: 'Zuva Petroleum',
        referenceNumber: 'INV-78',
        documentDate: '2026-10-20',
        dueDate: '2026-10-25',
        paymentTerms: 'CREDIT',
        creditPeriodDays: null,
        balance: '300.0000',
      },
    ]);
    expect(html).toContain('Overdue');
    expect(html).toContain('15 days late');
    expect(html).toContain('Credit, 7 days');
    expect(html).toContain('In 2 days');
    expect(html).toContain('USD 1,250.50');
    expect(html).toContain('href="/suppliers/s1');
    expect(html).toContain('href="/suppliers/s2');
  });
});
