import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseOrderChoice } from './purchase-order-choice';
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

const renderChoice = () =>
  renderToStaticMarkup(
    createElement(PurchaseOrderChoice, {
      id: 'rd-po',
      tenantId: 't',
      stationId: 's',
      supplierId: '',
      productId: 'p1',
      value: '',
      note: '',
      onChange: () => undefined,
    }),
  );

const editing: DeliveryEdit = {
  deliveryId: 'd1',
  productId: 'p1',
  start: {
    supplierId: 's1',
    tankId: 'tk1',
    deliveryNote: 'DN-1',
    deliveredAt: '2026-10-20T08:00:00.000Z',
    noteLitres: '1000',
    receivedLitres: '1000',
    carrier: '',
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
};

describe('RecordDelivery guide', () => {
  it('starts a new delivery with one question, who delivered the fuel', () => {
    const html = render();
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemax="11"');
    expect(html).toContain('Who delivered the fuel?');
    // Only one tank, so the tank question is left out, and nothing later is on screen yet.
    expect(html).not.toContain('Which fuel, and which tank?');
    expect(html).not.toContain('What does the delivery note say?');
  });

  it('keeps the whole form for changing a delivery that is already recorded', () => {
    const html = render(editing);
    expect(html).not.toContain('Step 1 of');
    expect(html).toContain('The delivery');
    expect(html).toContain('Truck and driver');
  });
});

describe('RecordDelivery purchase order question', () => {
  it('asks the question as a visible required choice', () => {
    const html = renderChoice();
    expect(html).toContain('Is there a purchase order for this delivery?');
    expect(html).toContain('id="rd-po-choice"');
  });

  it('offers every no-order reason in plain words, and starts unanswered', () => {
    const html = renderChoice();
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
    expect(render(editing)).toContain('Order PO-0007 (already linked)');
  });
});
