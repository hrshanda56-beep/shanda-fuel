import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DeliveryDetail, DeliveryList } from '../queries';
import { DeliveriesList } from './deliveries-list';
import { DeliveryDetails } from './delivery-details';

const context = { tenantId: 't', stationId: 's', stationName: 'Arcturus' };

const detail: DeliveryDetail = {
  stationTimezone: 'Africa/Harare',
  waterTestRequired: true,
  delivery: {
    id: 'd1',
    deliveryNoteNumber: 'DN-001',
    deliveredAt: '2026-10-20T08:00:00.000Z',
    businessDate: '2026-10-20',
    productId: 'p1',
    productName: 'Diesel',
    supplierName: 'Puma Energy',
    transporter: null,
    driver: 'T. Moyo',
    truckRegistration: 'ABC 1234',
    status: 'DRAFT',
    noteLitres: '10000',
    receivedLitres: '9990.5',
    shortageExcessLitres: '-9.5',
    receipt: 'PARTIAL',
  },
  compartments: [
    {
      compartmentNumber: 1,
      noteLitres: '10000',
      receivedLitres: '9990.5',
      varianceLitres: '-9.5',
      variance: 'SHORT',
      seals: [{ sealNumber: 'S-1', intact: false }],
    },
  ],
  waterTest: null,
  driverConfirmation: null,
};

describe('delivery detail screens', () => {
  it('shows a partial delivery, the shortage and the water-test rule in plain words', () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryDetails, {
        context,
        listHref: '/inventory/deliveries',
        initialData: detail,
      }),
    );
    expect(html).toContain('Delivery details');
    expect(html).toContain('Partial delivery');
    expect(html).toContain('Short by 9.5 L');
    expect(html).toContain('Your owner needs a water test recorded');
    expect(html).toContain('Truck compartments');
    expect(html).toContain('The driver confirms these details are correct');
  });

  it('is read-only once the delivery is confirmed', () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryDetails, {
        context,
        listHref: '/inventory/deliveries',
        initialData: { ...detail, delivery: { ...detail.delivery, status: 'CONFIRMED' } },
      }),
    );
    expect(html).not.toContain('Save compartments');
    expect(html).not.toContain('Save water test');
    expect(html).toContain('Save driver confirmation');
  });

  it('tells the truth when there are no deliveries', () => {
    const empty: DeliveryList = {
      stationTimezone: 'Africa/Harare',
      waterTestRequired: false,
      tanks: [],
      deliveries: [],
    };
    const html = renderToStaticMarkup(
      createElement(DeliveriesList, { context, contextQuery: '', initialData: empty }),
    );
    expect(html).toContain('No deliveries yet');
  });

  it('makes each delivery row one link to its details', () => {
    const list: DeliveryList = {
      stationTimezone: 'Africa/Harare',
      waterTestRequired: false,
      tanks: [],
      deliveries: [
        {
          id: 'd1',
          deliveryNoteNumber: 'DN-001',
          deliveredAt: '2026-10-20T08:00:00.000Z',
          businessDate: '2026-10-20',
          productName: 'Diesel',
          supplierName: null,
          status: 'DRAFT',
          noteLitres: '10000',
          receivedLitres: '9990.5',
          shortageExcessLitres: '-9.5',
          receipt: 'PARTIAL',
          compartmentCount: 0,
          hasWaterTest: false,
          driverConfirmed: null,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(DeliveriesList, { context, contextQuery: 'station=s', initialData: list }),
    );
    expect(html).toContain('class="row-link"');
    expect(html).toContain('/inventory/deliveries/d1?station=s');
    expect(html).toContain('Partial delivery');
  });
});
