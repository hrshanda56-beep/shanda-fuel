import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecordDelivery, type DeliveryEdit } from './record-delivery';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const tanks = [
  {
    id: 'tk1',
    code: 'T1',
    productId: 'p1',
    productName: 'Diesel',
  },
] as never;

const render = (edit?: DeliveryEdit) =>
  renderToStaticMarkup(
    createElement(RecordDelivery, { tenantId: 't', stationId: 's', tanks, framed: false, edit }),
  );

describe('RecordDelivery purchase order question', () => {
  it('asks the question as a visible required choice in the delivery section, not a folded one', () => {
    const html = render();
    const delivery = html.indexOf('The delivery');
    const question = html.indexOf('Is there a purchase order for this delivery?');
    const litres = html.indexOf('id="rd-h-litres"');
    expect(question).toBeGreaterThan(delivery);
    expect(question).toBeLessThan(litres);
    expect(html).toContain('id="rd-po-choice"');
    expect(html).toMatch(/<select[^>]*id="rd-po-choice"[^>]*required/);
    // It no longer hides inside an optional, collapsed section.
    expect(html).not.toContain('<span class="rd-section-title">Purchase order</span>');
  });

  it('offers every no-order reason in plain words, and starts unanswered', () => {
    const html = render();
    for (const label of [
      'Emergency purchase',
      'Bought for cash',
      'The supplier delivered without an order',
      'The order was not raised in time',
      'Another reason',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('<option value="" selected="">Choose one</option>');
  });

  it('keeps an already linked order as a valid answer when editing', () => {
    const html = render({
      deliveryId: 'd1',
      productId: 'p1',
      start: {
        supplierId: 's1',
        tankId: 'tk1',
        deliveryNote: 'DN-1',
        deliveredAt: '2026-10-20T08:00:00.000Z',
        noteLitres: '1000',
        receivedLitres: '1000',
        transporter: '',
        driver: '',
        truck: '',
        compartments: [],
        water: '',
        waterMm: '',
        driverConfirmed: false,
        noPo: '',
        noPoNote: '',
        linkedOrder: 'PO-0007',
      },
      onSaved: () => undefined,
    });
    expect(html).toContain('Order PO-0007 (already linked)');
  });
});
