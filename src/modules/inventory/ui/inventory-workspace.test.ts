import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDeliveryCommand,
  DeliveryForm,
  type DeliveryFormValues,
  type InventoryContext,
} from './inventory-workspace';

const context: InventoryContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  legalEntityId: '22222222-2222-4222-8222-222222222222',
  stationId: '33333333-3333-4333-8333-333333333333',
  organisationName: 'Test organisation',
  legalEntityName: 'Test legal entity',
  stationName: 'Test station',
  stationTimezone: 'Africa/Harare',
};

const values: DeliveryFormValues = {
  supplierId: '44444444-4444-4444-8444-444444444444',
  productId: '55555555-5555-4555-8555-555555555555',
  tankId: '66666666-6666-4666-8666-666666666666',
  deliveryNoteNumber: ' DN-100 ',
  deliveredAt: '2026-10-21T08:30:00.000Z',
  noteQuantityLitres: '1000.000',
  actualQuantityLitres: '999.500',
  allocationQuantityLitres: '999.500',
  supplierReference: ' PO-42 ',
  transporter: 'Harare Hauliers',
  driver: 'T. Moyo',
  truckRegistration: 'ACD 1234',
  sealReference: 'SEAL-99',
  preDeliveryDipId: '77777777-7777-4777-8777-777777777777',
  postDeliveryDipId: '88888888-8888-4888-8888-888888888888',
};

describe('delivery receipt form', () => {
  it('builds the existing CreateDelivery payload with supported transport and dip references', () => {
    expect(buildDeliveryCommand(values)).toEqual({
      commandType: 'CreateDelivery',
      supplierId: values.supplierId,
      productId: values.productId,
      deliveryNoteNumber: 'DN-100',
      deliveredAt: values.deliveredAt,
      noteQuantityLitres: values.noteQuantityLitres,
      actualQuantityLitres: values.actualQuantityLitres,
      allocations: [{ tankId: values.tankId, quantityLitres: values.allocationQuantityLitres }],
      supplierReference: 'PO-42',
      transporter: values.transporter,
      driver: values.driver,
      truckRegistration: values.truckRegistration,
      sealReference: values.sealReference,
      preDeliveryDipId: values.preDeliveryDipId,
      postDeliveryDipId: values.postDeliveryDipId,
    });
  });

  it('does not send empty optional references that the command schema does not accept as IDs', () => {
    const payload = buildDeliveryCommand({
      ...values,
      supplierReference: ' ',
      transporter: '',
      driver: undefined,
      truckRegistration: '   ',
      sealReference: undefined,
      preDeliveryDipId: '',
      postDeliveryDipId: '  ',
    });

    expect(payload).not.toHaveProperty('supplierReference');
    expect(payload).not.toHaveProperty('transporter');
    expect(payload).not.toHaveProperty('driver');
    expect(payload).not.toHaveProperty('truckRegistration');
    expect(payload).not.toHaveProperty('sealReference');
    expect(payload).not.toHaveProperty('preDeliveryDipId');
    expect(payload).not.toHaveProperty('postDeliveryDipId');
  });

  it('renders every supported delivery evidence control', () => {
    const markup = renderToStaticMarkup(
      createElement(DeliveryForm, {
        context,
        tankId: values.tankId,
        productId: values.productId,
        onRefresh: vi.fn(),
      }),
    );

    for (const id of [
      'delivery-supplier-reference',
      'delivery-transporter',
      'delivery-driver',
      'delivery-truck-registration',
      'delivery-seal-reference',
      'delivery-pre-dip-reference',
      'delivery-post-dip-reference',
    ]) {
      expect(markup).toContain(`id="${id}"`);
    }
    expect(markup).toContain('Pre-delivery dip reference');
    expect(markup).toContain('Post-delivery dip reference');
    expect(markup).toContain('This form does not create or alter the dip.');
  });
});
