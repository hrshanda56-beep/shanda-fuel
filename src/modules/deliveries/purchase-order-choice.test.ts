import { describe, expect, it } from 'vitest';
import {
  LINKED_CHOICE,
  NO_PO_REASONS,
  buildPurchaseOrderStep,
  linkChoiceValue,
  linkableOrderOptions,
  noPoReasonLabel,
  parsePurchaseOrderChoice,
  purchaseOrderChoiceProblem,
  setNoPurchaseOrderReasonSchema,
  type LinkableOrder,
} from './purchase-order-choice';

const ids = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  stationId: '22222222-2222-4222-8222-222222222222',
  deliveryId: '33333333-3333-4333-8333-333333333333',
};
const orderId = '44444444-4444-4444-8444-444444444444';
const lineId = '55555555-5555-4555-8555-555555555555';

const line = (overrides: Partial<LinkableOrder['lines'][number]> = {}) => ({
  lineId,
  lineNumber: 1,
  productId: 'diesel',
  productName: 'Diesel',
  status: 'ACTIVE',
  openLitres: '5000',
  ...overrides,
});

const order = (overrides: Partial<LinkableOrder> = {}): LinkableOrder => ({
  purchaseOrderId: orderId,
  orderNumber: 'PO-0007',
  state: 'APPROVED',
  supplierId: 's1',
  lines: [line()],
  ...overrides,
});

describe('NO_PO_REASONS', () => {
  it('lists the five recorded reasons with plain labels and no blank entry', () => {
    expect(NO_PO_REASONS.map((item) => item.value)).toEqual([
      'EMERGENCY_PURCHASE',
      'CASH_PURCHASE',
      'SUPPLIER_DIRECT',
      'PO_NOT_RAISED',
      'OTHER',
    ]);
    expect(noPoReasonLabel('CASH_PURCHASE')).toBe('Bought for cash');
    expect(noPoReasonLabel('SOMETHING_ELSE')).toBe('Recorded without an order');
  });
});

describe('parsePurchaseOrderChoice', () => {
  it('tells an unanswered, linked, link and reason choice apart', () => {
    expect(parsePurchaseOrderChoice('')).toEqual({ kind: 'NONE' });
    expect(parsePurchaseOrderChoice(LINKED_CHOICE)).toEqual({ kind: 'LINKED' });
    expect(parsePurchaseOrderChoice(linkChoiceValue(orderId, lineId))).toEqual({
      kind: 'LINK',
      purchaseOrderId: orderId,
      purchaseOrderLineId: lineId,
    });
    expect(parsePurchaseOrderChoice('CASH_PURCHASE')).toEqual({
      kind: 'REASON',
      reason: 'CASH_PURCHASE',
    });
  });

  it('treats anything unrecognised as unanswered', () => {
    expect(parsePurchaseOrderChoice('PO:broken')).toEqual({ kind: 'NONE' });
    expect(parsePurchaseOrderChoice('NOT_A_REASON')).toEqual({ kind: 'NONE' });
  });
});

describe('purchaseOrderChoiceProblem', () => {
  it('fails when nothing was chosen', () => {
    expect(purchaseOrderChoiceProblem('', '')).toMatch(/purchase order/i);
  });

  it('fails when Other has no note, including a blank one', () => {
    expect(purchaseOrderChoiceProblem('OTHER', '   ')).toMatch(/few words/i);
  });

  it('fails when the note is longer than 300 characters', () => {
    expect(purchaseOrderChoiceProblem('OTHER', 'x'.repeat(301))).toMatch(/300/);
  });

  it('accepts a link, an already linked order, a reason and Other with a note', () => {
    expect(purchaseOrderChoiceProblem(linkChoiceValue(orderId, lineId), '')).toBeNull();
    expect(purchaseOrderChoiceProblem(LINKED_CHOICE, '')).toBeNull();
    expect(purchaseOrderChoiceProblem('EMERGENCY_PURCHASE', '')).toBeNull();
    expect(purchaseOrderChoiceProblem('OTHER', 'Bought at another depot')).toBeNull();
  });
});

describe('linkableOrderOptions', () => {
  it('offers approved orders of this supplier that have an active line for this fuel', () => {
    const options = linkableOrderOptions(
      [
        order(),
        order({ purchaseOrderId: 'other', orderNumber: 'PO-0008', supplierId: 's2' }),
        order({ purchaseOrderId: 'draft', orderNumber: 'PO-0009', state: 'DRAFT' }),
        order({
          purchaseOrderId: 'petrol',
          orderNumber: 'PO-0010',
          lines: [line({ lineId: 'x', productId: 'petrol', productName: 'Petrol' })],
        }),
        order({
          purchaseOrderId: 'cancelled-line',
          orderNumber: 'PO-0011',
          lines: [line({ lineId: 'y', status: 'CANCELLED' })],
        }),
      ],
      { supplierId: 's1', productId: 'diesel' },
    );
    expect(options).toEqual([
      {
        value: linkChoiceValue(orderId, lineId),
        label: 'Order PO-0007 · Diesel · 5,000 L still open',
      },
    ]);
  });

  it('offers nothing until a supplier and a fuel are known', () => {
    expect(linkableOrderOptions([order()], { supplierId: '', productId: 'diesel' })).toEqual([]);
    expect(linkableOrderOptions([order()], { supplierId: 's1', productId: '' })).toEqual([]);
  });
});

describe('buildPurchaseOrderStep', () => {
  it('records a reason through the delivery command', () => {
    expect(buildPurchaseOrderStep('OTHER', ' Bought at another depot ', ids)).toEqual({
      url: '/api/deliveries/commands',
      body: {
        commandType: 'SetDeliveryNoPurchaseOrderReason',
        ...ids,
        noPoReason: 'OTHER',
        noPoNote: 'Bought at another depot',
      },
    });
  });

  it('sends no note for a reason that does not need one', () => {
    const step = buildPurchaseOrderStep('CASH_PURCHASE', 'ignored', ids);
    expect(step?.body.noPoNote).toBeNull();
  });

  it('links through the purchasing command', () => {
    expect(buildPurchaseOrderStep(linkChoiceValue(orderId, lineId), '', ids)).toEqual({
      url: '/api/purchasing/commands',
      body: {
        commandType: 'LinkDeliveryToPurchaseOrder',
        ...ids,
        purchaseOrderId: orderId,
        purchaseOrderLineId: lineId,
      },
    });
  });

  it('has nothing to send when the delivery is already linked or nothing is chosen', () => {
    expect(buildPurchaseOrderStep(LINKED_CHOICE, '', ids)).toBeNull();
    expect(buildPurchaseOrderStep('', '', ids)).toBeNull();
  });
});

describe('setNoPurchaseOrderReasonSchema', () => {
  const base = { ...ids, noPoReason: 'CASH_PURCHASE' };

  it('accepts a reason on its own', () => {
    expect(setNoPurchaseOrderReasonSchema.safeParse(base).success).toBe(true);
  });

  it('accepts Other with a note', () => {
    expect(
      setNoPurchaseOrderReasonSchema.safeParse({
        ...base,
        noPoReason: 'OTHER',
        noPoNote: 'Depot sale',
      }).success,
    ).toBe(true);
  });

  it('rejects Other without a note', () => {
    expect(setNoPurchaseOrderReasonSchema.safeParse({ ...base, noPoReason: 'OTHER' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown reason, a missing reason and an over-long note', () => {
    expect(setNoPurchaseOrderReasonSchema.safeParse({ ...base, noPoReason: 'NOPE' }).success).toBe(
      false,
    );
    expect(setNoPurchaseOrderReasonSchema.safeParse(ids).success).toBe(false);
    expect(
      setNoPurchaseOrderReasonSchema.safeParse({
        ...base,
        noPoReason: 'OTHER',
        noPoNote: 'x'.repeat(301),
      }).success,
    ).toBe(false);
  });
});
