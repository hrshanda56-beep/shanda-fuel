import { describe, expect, it } from 'vitest';
import {
  orderInventoryCostEvents,
  orderInventoryMovements,
  deriveSaleCogsFromPreSaleState,
  projectInventoryCost,
  projectInventoryCostBeforeSale,
  replayFingerprint,
  type CostingEvent,
  type CostingMovement,
} from './domain';
import type { CurrencyCode } from '../../platform/domain/primitives';

const key = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  stationId: '00000000-0000-4000-8000-000000000002',
  tankId: '00000000-0000-4000-8000-000000000003',
  productId: '00000000-0000-4000-8000-000000000004',
} as const;

function movement(overrides: Partial<CostingMovement> = {}): CostingMovement {
  return {
    ...key,
    id: '00000000-0000-4000-8000-000000000101',
    movementType: 'OPENING_BALANCE',
    quantityLitres: '100.000',
    effectiveAt: '2026-09-25T06:00:00.000Z',
    sourceType: 'OPENING_BALANCE',
    sourceId: '00000000-0000-4000-8000-000000000201',
    ...overrides,
  };
}

function event(overrides: Partial<CostingEvent> = {}): CostingEvent {
  return {
    ...key,
    id: '00000000-0000-4000-8000-000000000301',
    eventType: 'OPENING_COST',
    sourceType: 'OPENING_BALANCE',
    sourceId: '00000000-0000-4000-8000-000000000201',
    effectiveAt: '2026-09-25T06:00:00.000Z',
    amount: '123.4567',
    currency: 'USD',
    ...overrides,
  };
}

describe('inventory costing domain', () => {
  it('projects valued opening and receipt WAC with exact persistence scales', () => {
    const receipt = movement({
      id: '00000000-0000-4000-8000-000000000102',
      movementType: 'DELIVERY',
      quantityLitres: '50.125',
      effectiveAt: '2026-09-25T07:00:00.000Z',
      sourceType: 'DELIVERY',
      sourceId: '00000000-0000-4000-8000-000000000202',
    });
    const receiptCost = event({
      id: '00000000-0000-4000-8000-000000000302',
      eventType: 'RECEIPT_COST',
      sourceType: 'DELIVERY',
      sourceId: '00000000-0000-4000-8000-000000000202',
      effectiveAt: '2026-09-25T07:00:00.000Z',
      amount: '100.5000',
    });
    const result = projectInventoryCost({
      key,
      movements: [receipt, movement()],
      costEvents: [receiptCost, event()],
    });
    expect(result.quantityLitres).toBe('150.125');
    expect(result.inventoryValue).toBe('223.9567');
    expect(result.weightedAverageCost).toBe('1.49180150');
    expect(result.valuationStatus).toBe('VALUED');
    expect(result.currency).toBe('USD');
  });

  it('values the canonical A4 delivery-allocation source as a receipt cost', () => {
    const receipt = movement({
      id: '00000000-0000-4000-8000-000000000105',
      movementType: 'DELIVERY',
      quantityLitres: '25.000',
      effectiveAt: '2026-09-25T07:00:00.000Z',
      sourceType: 'FUEL_DELIVERY_ALLOCATION',
      sourceId: '00000000-0000-4000-8000-000000000205',
    });
    const receiptCost = event({
      id: '00000000-0000-4000-8000-000000000305',
      eventType: 'RECEIPT_COST',
      sourceType: 'FUEL_DELIVERY_ALLOCATION',
      sourceId: receipt.sourceId,
      effectiveAt: receipt.effectiveAt,
      amount: '50.0000',
    });
    expect(
      projectInventoryCost({
        key,
        movements: [movement(), receipt],
        costEvents: [event(), receiptCost],
      }),
    ).toMatchObject({
      quantityLitres: '125.000',
      inventoryValue: '173.4567',
      valuationStatus: 'VALUED',
    });
  });

  it('rejects mixed opening and receipt currencies', () => {
    const receipt = movement({
      id: '00000000-0000-4000-8000-000000000102',
      movementType: 'DELIVERY',
      effectiveAt: '2026-09-25T07:00:00.000Z',
      sourceType: 'DELIVERY',
      sourceId: '00000000-0000-4000-8000-000000000202',
    });
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement(), receipt],
        costEvents: [
          event(),
          event({
            id: '00000000-0000-4000-8000-000000000302',
            eventType: 'RECEIPT_COST',
            sourceType: 'DELIVERY',
            sourceId: receipt.sourceId,
            effectiveAt: receipt.effectiveAt,
            amount: '100.0000',
            currency: 'ZWL' as CurrencyCode,
          }),
        ],
      }),
    ).toThrow('currency does not match');
  });

  it('uses the pre-sale WAC and applies the signed sale COGS event', () => {
    const sale = movement({
      id: '00000000-0000-4000-8000-000000000103',
      movementType: 'SALE',
      quantityLitres: '-10.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
    });
    const saleCost = event({
      id: '00000000-0000-4000-8000-000000000303',
      eventType: 'SALE_COGS',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      amount: '-12.3457',
    });
    const result = projectInventoryCost({
      key,
      movements: [movement(), sale],
      costEvents: [event(), saleCost],
    });
    expect(result.saleAttributions[0]).toMatchObject({
      saleQuantityLitres: '10.000',
      preSaleWac: '1.23456700',
      originalCogs: '12.3457',
      saleCostEventId: saleCost.id,
    });
    expect(result.quantityLitres).toBe('90.000');
    expect(result.inventoryValue).toBe('111.1110');
  });

  it('rejects a receipt cost encountered before its positive receipt movement', () => {
    const receipt = movement({
      id: '00000000-0000-4000-8000-000000000102',
      movementType: 'DELIVERY',
      effectiveAt: '2026-09-25T07:00:00.000Z',
      sourceType: 'DELIVERY',
      sourceId: '00000000-0000-4000-8000-000000000202',
    });
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement(), receipt],
        costEvents: [
          event(),
          event({
            id: '00000000-0000-4000-8000-000000000302',
            eventType: 'RECEIPT_COST',
            sourceType: 'DELIVERY',
            sourceId: receipt.sourceId,
            effectiveAt: '2026-09-25T06:00:00.000Z',
            amount: '10.0000',
          }),
        ],
      }),
    ).toThrow('must follow its matching positive A4 movement');
  });

  it('rejects an orphan receipt cost event', () => {
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement()],
        costEvents: [
          event(),
          event({
            id: '00000000-0000-4000-8000-000000000302',
            eventType: 'RECEIPT_COST',
            sourceType: 'DELIVERY',
            sourceId: '00000000-0000-4000-8000-000000000202',
            effectiveAt: '2026-09-25T07:00:00.000Z',
            amount: '10.0000',
          }),
        ],
      }),
    ).toThrow('must follow its matching positive A4 movement');
  });

  it('combines multiple receipts at their encountered authoritative costs', () => {
    const firstReceipt = movement({
      id: '00000000-0000-4000-8000-000000000102',
      movementType: 'DELIVERY',
      quantityLitres: '50.000',
      effectiveAt: '2026-09-25T07:00:00.000Z',
      sourceType: 'DELIVERY',
      sourceId: '00000000-0000-4000-8000-000000000202',
    });
    const secondReceipt = movement({
      id: '00000000-0000-4000-8000-000000000104',
      movementType: 'DELIVERY',
      quantityLitres: '50.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'DELIVERY',
      sourceId: '00000000-0000-4000-8000-000000000204',
    });
    const firstReceiptCost = event({
      id: '00000000-0000-4000-8000-000000000302',
      eventType: 'RECEIPT_COST',
      sourceType: 'DELIVERY',
      sourceId: firstReceipt.sourceId,
      effectiveAt: firstReceipt.effectiveAt,
      amount: '100.0000',
    });
    const secondReceiptCost = event({
      id: '00000000-0000-4000-8000-000000000304',
      eventType: 'RECEIPT_COST',
      sourceType: 'DELIVERY',
      sourceId: secondReceipt.sourceId,
      effectiveAt: secondReceipt.effectiveAt,
      amount: '200.0000',
    });
    const result = projectInventoryCost({
      key,
      movements: [movement(), firstReceipt, secondReceipt],
      costEvents: [event(), firstReceiptCost, secondReceiptCost],
    });
    expect(result).toMatchObject({
      quantityLitres: '200.000',
      inventoryValue: '423.4567',
      weightedAverageCost: '2.11728350',
      valuationStatus: 'VALUED',
    });
  });

  it('does not use a later receipt cost to value an earlier sale', () => {
    const receipt = movement({
      id: '00000000-0000-4000-8000-000000000102',
      movementType: 'DELIVERY',
      quantityLitres: '10.000',
      effectiveAt: '2026-09-25T07:00:00.000Z',
      sourceType: 'DELIVERY',
      sourceId: '00000000-0000-4000-8000-000000000202',
    });
    const sale = movement({
      id: '00000000-0000-4000-8000-000000000103',
      movementType: 'SALE',
      quantityLitres: '-1.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
    });
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement(), receipt, sale],
        costEvents: [
          event(),
          event({
            id: '00000000-0000-4000-8000-000000000302',
            eventType: 'RECEIPT_COST',
            sourceType: 'DELIVERY',
            sourceId: receipt.sourceId,
            effectiveAt: '2026-09-25T09:00:00.000Z',
            amount: '10.0000',
          }),
          event({
            id: '00000000-0000-4000-8000-000000000303',
            eventType: 'SALE_COGS',
            sourceType: 'METER_SEGMENT_SALE',
            sourceId: sale.sourceId,
            effectiveAt: sale.effectiveAt,
            amount: '-1.0000',
          }),
        ],
      }),
    ).toThrow('UNVALUED');
  });

  it('does not use a same-timestamp receipt cost as pre-sale WAC', () => {
    const receipt = movement({
      id: '00000000-0000-4000-8000-000000000102',
      movementType: 'DELIVERY',
      quantityLitres: '50.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'DELIVERY',
      sourceId: '00000000-0000-4000-8000-000000000202',
    });
    const sale = movement({
      id: '00000000-0000-4000-8000-000000000103',
      movementType: 'SALE',
      quantityLitres: '-10.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
    });
    const beforeSale = projectInventoryCostBeforeSale({
      key,
      movements: [movement(), receipt, sale],
      costEvents: [
        event(),
        event({
          id: '00000000-0000-4000-8000-000000000302',
          eventType: 'RECEIPT_COST',
          sourceType: 'DELIVERY',
          sourceId: receipt.sourceId,
          effectiveAt: receipt.effectiveAt,
          amount: '50.0000',
        }),
        event({
          id: '00000000-0000-4000-8000-000000000303',
          eventType: 'SALE_COGS',
          sourceType: 'METER_SEGMENT_SALE',
          sourceId: sale.sourceId,
          effectiveAt: sale.effectiveAt,
          amount: '-12.3457',
        }),
      ],
      saleMovementId: sale.id,
    });
    expect(beforeSale).toMatchObject({
      quantityLitres: '150.000',
      inventoryValue: null,
      weightedAverageCost: null,
      currency: null,
      valuationStatus: 'UNVALUED',
    });
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement(), receipt, sale],
        costEvents: [
          event(),
          event({
            id: '00000000-0000-4000-8000-000000000302',
            eventType: 'RECEIPT_COST',
            sourceType: 'DELIVERY',
            sourceId: receipt.sourceId,
            effectiveAt: receipt.effectiveAt,
            amount: '50.0000',
          }),
          event({
            id: '00000000-0000-4000-8000-000000000303',
            eventType: 'SALE_COGS',
            sourceType: 'METER_SEGMENT_SALE',
            sourceId: sale.sourceId,
            effectiveAt: sale.effectiveAt,
            amount: '-12.3457',
          }),
        ],
      }),
    ).toThrow('UNVALUED');
  });

  it('orders same-timestamp canonical sales as deterministic sale-cost pairs', () => {
    const firstSale = movement({
      id: '00000000-0000-4000-8000-000000000103',
      movementType: 'SALE',
      quantityLitres: '-10.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
    });
    const secondSale = movement({
      id: '00000000-0000-4000-8000-000000000104',
      movementType: 'SALE',
      quantityLitres: '-20.000',
      effectiveAt: firstSale.effectiveAt,
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000204',
    });
    const firstSaleCost = event({
      id: '00000000-0000-4000-8000-000000000303',
      eventType: 'SALE_COGS',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: firstSale.sourceId,
      effectiveAt: firstSale.effectiveAt,
      amount: '-12.3457',
    });
    const secondSaleCost = event({
      id: '00000000-0000-4000-8000-000000000304',
      eventType: 'SALE_COGS',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: secondSale.sourceId,
      effectiveAt: secondSale.effectiveAt,
      amount: '-24.6913',
    });
    const input = {
      key,
      movements: [secondSale, firstSale, movement()],
      costEvents: [secondSaleCost, event(), firstSaleCost],
    };
    const result = projectInventoryCost(input);
    const replay = projectInventoryCost({
      ...input,
      movements: [...input.movements].reverse(),
      costEvents: [...input.costEvents].reverse(),
    });
    expect(result).toMatchObject({
      quantityLitres: '70.000',
      inventoryValue: '86.4197',
      weightedAverageCost: '1.23456714',
      currency: 'USD',
      valuationStatus: 'VALUED',
    });
    expect(result.saleAttributions).toHaveLength(2);
    expect(result.saleAttributions.map((item) => item.saleCostEventId)).toEqual([
      firstSaleCost.id,
      secondSaleCost.id,
    ]);
    expect(replay).toEqual(result);
  });

  it('keeps reverse-input canonical sales on the correct side of a valued receipt transition', () => {
    const earlySale = movement({
      id: '00000000-0000-4000-8000-000000000103',
      movementType: 'SALE',
      quantityLitres: '-10.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
    });
    const receipt = movement({
      id: '00000000-0000-4000-8000-000000000104',
      movementType: 'DELIVERY',
      quantityLitres: '100.000',
      effectiveAt: '2026-09-25T09:00:00.000Z',
      sourceType: 'DELIVERY',
      sourceId: '00000000-0000-4000-8000-000000000204',
    });
    const lateSale = movement({
      id: '00000000-0000-4000-8000-000000000105',
      movementType: 'SALE',
      quantityLitres: '-10.000',
      effectiveAt: '2026-09-25T10:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000205',
    });
    const input = {
      key,
      movements: [lateSale, receipt, earlySale, movement()],
      costEvents: [
        event({ amount: '100.0000' }),
        event({
          id: '00000000-0000-4000-8000-000000000302',
          eventType: 'RECEIPT_COST',
          sourceType: 'DELIVERY',
          sourceId: receipt.sourceId,
          effectiveAt: receipt.effectiveAt,
          amount: '300.0000',
        }),
        event({
          id: '00000000-0000-4000-8000-000000000303',
          eventType: 'SALE_COGS',
          sourceType: 'METER_SEGMENT_SALE',
          sourceId: earlySale.sourceId,
          effectiveAt: earlySale.effectiveAt,
          amount: '-10.0000',
        }),
        event({
          id: '00000000-0000-4000-8000-000000000304',
          eventType: 'SALE_COGS',
          sourceType: 'METER_SEGMENT_SALE',
          sourceId: lateSale.sourceId,
          effectiveAt: lateSale.effectiveAt,
          amount: '-20.5263',
        }),
      ],
    };
    const result = projectInventoryCost(input);
    const replay = projectInventoryCost({
      ...input,
      movements: [...input.movements].reverse(),
      costEvents: [...input.costEvents].reverse(),
    });
    expect(result.saleAttributions.map((item) => item.originalCogs)).toEqual([
      '10.0000',
      '20.5263',
    ]);
    expect(result.saleAttributions.map((item) => item.preSaleWac)).toEqual([
      '1.00000000',
      '2.05263158',
    ]);
    expect(replay).toEqual(result);
  });

  it('requires exactly one causally available and correct SALE_COGS authority', () => {
    const sale = movement({
      id: '00000000-0000-4000-8000-000000000103',
      movementType: 'SALE',
      quantityLitres: '-10.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
    });
    expect(() =>
      projectInventoryCost({ key, movements: [movement(), sale], costEvents: [event()] }),
    ).toThrow('exactly one matching SALE_COGS');
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement(), sale],
        costEvents: [
          event(),
          event({
            id: '00000000-0000-4000-8000-000000000303',
            eventType: 'SALE_COGS',
            sourceType: 'METER_SEGMENT_SALE',
            sourceId: sale.sourceId,
            effectiveAt: sale.effectiveAt,
            amount: '-12.3456',
          }),
        ],
      }),
    ).toThrow('does not match');
  });

  it('rejects a SALE_COGS event in a different currency from the valued stream', () => {
    const sale = movement({
      id: '00000000-0000-4000-8000-000000000103',
      movementType: 'SALE',
      quantityLitres: '-10.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
    });
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement(), sale],
        costEvents: [
          event(),
          event({
            id: '00000000-0000-4000-8000-000000000303',
            eventType: 'SALE_COGS',
            sourceType: 'METER_SEGMENT_SALE',
            sourceId: sale.sourceId,
            effectiveAt: sale.effectiveAt,
            amount: '-12.3457',
            currency: 'ZWL' as CurrencyCode,
          }),
        ],
      }),
    ).toThrow('currency does not match');
  });

  it('requires an explicit canonical cutover before legacy A4 sales', () => {
    for (const [index, sourceType] of ['RECONCILIATION_SALE', 'FORECOURT_SALE'].entries()) {
      expect(() =>
        projectInventoryCost({
          key,
          movements: [
            movement(),
            movement({
              id: `00000000-0000-4000-8000-00000000010${3 + index}`,
              movementType: 'SALE',
              quantityLitres: '-1.000',
              effectiveAt: '2026-09-25T08:00:00.000Z',
              sourceType,
              sourceId: `00000000-0000-4000-8000-00000000020${3 + index}`,
            }),
          ],
          costEvents: [event()],
        }),
      ).toThrow('canonical starting point');
    }
  });

  it('replays A12 chronology from a canonical starting point without inventing legacy COGS', () => {
    const sale = movement({
      id: '00000000-0000-4000-8000-000000000103',
      movementType: 'SALE',
      quantityLitres: '-10.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
    });
    const saleCost = event({
      id: '00000000-0000-4000-8000-000000000303',
      eventType: 'SALE_COGS',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: sale.sourceId,
      effectiveAt: sale.effectiveAt,
      amount: '-12.3457',
    });
    const result = projectInventoryCost({
      key,
      canonicalStartingPoint: {
        id: 'a12-cutover-opening-1',
        ...key,
        effectiveAt: '2026-09-25T05:00:00.000Z',
        quantityLitres: '100.000',
        inventoryValue: '123.4567',
        currency: 'USD',
      },
      movements: [sale],
      costEvents: [saleCost],
    });
    expect(result).toMatchObject({
      quantityLitres: '90.000',
      inventoryValue: '111.1110',
      currency: 'USD',
      valuationStatus: 'VALUED',
    });
    expect(result.saleAttributions).toHaveLength(1);
  });

  it('rejects a canonical starting point from another stream', () => {
    expect(() =>
      projectInventoryCost({
        key,
        canonicalStartingPoint: {
          id: 'a12-cutover-opening-wrong-stream',
          ...key,
          stationId: '00000000-0000-4000-8000-000000000099',
          effectiveAt: '2026-09-25T05:00:00.000Z',
          quantityLitres: '100.000',
          inventoryValue: '123.4567',
          currency: 'USD',
        },
        movements: [],
        costEvents: [],
      }),
    ).toThrow('one inventory stream');
  });

  it('rejects chronology at or before a canonical cutover boundary', () => {
    const startingPoint = {
      id: 'a12-cutover-opening-chronology',
      ...key,
      effectiveAt: '2026-09-25T05:00:00.000Z',
      quantityLitres: '100.000',
      inventoryValue: '123.4567',
      currency: 'USD' as const,
    };
    expect(() =>
      projectInventoryCost({
        key,
        canonicalStartingPoint: startingPoint,
        movements: [movement({ effectiveAt: startingPoint.effectiveAt })],
        costEvents: [],
      }),
    ).toThrow('only movements after');
  });

  it('rejects orphan and noncanonical SALE_COGS events', () => {
    const orphan = event({
      id: '00000000-0000-4000-8000-000000000303',
      eventType: 'SALE_COGS',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      amount: '-1.0000',
    });
    expect(() =>
      projectInventoryCost({ key, movements: [movement()], costEvents: [event(), orphan] }),
    ).toThrow('was not consumed');
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement()],
        costEvents: [
          event(),
          { ...orphan, id: '00000000-0000-4000-8000-000000000304', sourceType: 'FORECOURT_SALE' },
        ],
      }),
    ).toThrow('was not consumed');
  });

  it('rejects SALE_COGS reuse and deferred A12.4 cost event types', () => {
    const sale = movement({
      id: '00000000-0000-4000-8000-000000000103',
      movementType: 'SALE',
      quantityLitres: '-1.000',
      effectiveAt: '2026-09-25T08:00:00.000Z',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: '00000000-0000-4000-8000-000000000203',
    });
    const saleAgain = { ...sale, id: '00000000-0000-4000-8000-000000000104' };
    const saleCost = event({
      id: '00000000-0000-4000-8000-000000000303',
      eventType: 'SALE_COGS',
      sourceType: 'METER_SEGMENT_SALE',
      sourceId: sale.sourceId,
      effectiveAt: sale.effectiveAt,
      amount: '-1.2346',
    });
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement(), sale, saleAgain],
        costEvents: [event(), saleCost],
      }),
    ).toThrow('consumed more than once');
    for (const eventType of [
      'COGS_REVALUATION',
      'INVENTORY_REVALUATION',
      'ADJUSTMENT_COST',
    ] as const) {
      expect(() =>
        projectInventoryCost({
          key,
          movements: [movement()],
          costEvents: [
            event(),
            event({ id: `deferred-${eventType}`, eventType, amount: '1.0000' }),
          ],
        }),
      ).toThrow('deferred beyond A12.2');
    }
  });

  it('derives sale COGS from a valued pre-sale state with exact scales', () => {
    expect(
      deriveSaleCogsFromPreSaleState({
        quantityLitres: '100.000',
        inventoryValue: '123.4567',
        saleQuantityLitres: '10.000',
      }),
    ).toEqual({ preSaleWac: '1.23456700', originalCogs: '12.3457' });
  });

  it('keeps positive stock UNVALUED when cost basis is absent', () => {
    const result = projectInventoryCost({ key, movements: [movement()], costEvents: [] });
    expect(result).toMatchObject({
      quantityLitres: '100.000',
      inventoryValue: null,
      weightedAverageCost: null,
      currency: null,
      valuationStatus: 'UNVALUED',
    });
    expect(() =>
      projectInventoryCost({
        key,
        movements: [
          movement(),
          movement({
            id: '00000000-0000-4000-8000-000000000103',
            movementType: 'SALE',
            quantityLitres: '-1.000',
            sourceType: 'METER_SEGMENT_SALE',
            sourceId: '00000000-0000-4000-8000-000000000203',
          }),
        ],
        costEvents: [],
      }),
    ).toThrow('UNVALUED');
  });

  it('handles zero quantity without stale WAC and rejects negative stock', () => {
    const result = projectInventoryCost({
      key,
      movements: [
        movement(),
        movement({
          id: '00000000-0000-4000-8000-000000000103',
          movementType: 'SALE',
          quantityLitres: '-100.000',
          effectiveAt: '2026-09-25T08:00:00.000Z',
          sourceType: 'METER_SEGMENT_SALE',
          sourceId: '00000000-0000-4000-8000-000000000203',
        }),
      ],
      costEvents: [
        event(),
        event({
          id: '00000000-0000-4000-8000-000000000302',
          eventType: 'SALE_COGS',
          sourceType: 'METER_SEGMENT_SALE',
          sourceId: '00000000-0000-4000-8000-000000000203',
          effectiveAt: '2026-09-25T08:00:00.000Z',
          amount: '-123.4567',
        }),
      ],
    });
    expect(result.quantityLitres).toBe('0.000');
    expect(result.weightedAverageCost).toBeNull();
    expect(() =>
      projectInventoryCost({
        key,
        movements: [movement({ movementType: 'SALE', quantityLitres: '-100.001' })],
        costEvents: [event()],
      }),
    ).toThrow('negative inventory');
  });

  it('orders each authority by effective time and id, and fingerprints ordered basis deterministically', () => {
    const earlier = movement({
      id: '00000000-0000-4000-8000-000000000100',
      effectiveAt: '2026-09-25T06:00:00.000Z',
    });
    expect(orderInventoryMovements([movement(), earlier]).map((item) => item.id)).toEqual([
      earlier.id,
      movement().id,
    ]);
    const earlierEvent = event({ id: '00000000-0000-4000-8000-000000000300' });
    expect(orderInventoryCostEvents([event(), earlierEvent]).map((item) => item.id)).toEqual([
      earlierEvent.id,
      event().id,
    ]);
    const args = {
      movement: movement({
        movementType: 'SALE',
        quantityLitres: '-1.000',
        effectiveAt: '2026-09-25T08:00:00.000Z',
        sourceType: 'METER_SEGMENT_SALE',
        sourceId: '00000000-0000-4000-8000-000000000203',
      }),
      preSaleWac: '1.23456789',
      originalCogs: '1.2346',
      orderedMovements: [movement()],
      orderedCostEvents: [event()],
    };
    const startingPoint = {
      id: 'a12-fingerprint-cutover-1',
      ...key,
      effectiveAt: '2026-09-25T05:00:00.000Z',
      quantityLitres: '100.000',
      inventoryValue: '123.4567',
      currency: 'USD' as const,
    };
    expect(replayFingerprint(args)).toBe(
      replayFingerprint({ ...args, orderedMovements: [...args.orderedMovements] }),
    );
    expect(replayFingerprint({ ...args, originalCogs: '1.2347' })).not.toBe(
      replayFingerprint(args),
    );
    expect(
      replayFingerprint({ ...args, preSaleWac: '1.234567890', originalCogs: '1.2346000' }),
    ).toBe(replayFingerprint(args));
    expect(
      replayFingerprint({
        ...args,
        orderedMovements: [
          ...args.orderedMovements,
          movement({
            id: '00000000-0000-4000-8000-000000000104',
            movementType: 'DELIVERY',
            effectiveAt: '2026-09-25T09:00:00.000Z',
            sourceType: 'DELIVERY',
            sourceId: '00000000-0000-4000-8000-000000000204',
          }),
        ],
        orderedCostEvents: [
          ...args.orderedCostEvents,
          event({
            id: '00000000-0000-4000-8000-000000000304',
            eventType: 'RECEIPT_COST',
            sourceType: 'DELIVERY',
            sourceId: '00000000-0000-4000-8000-000000000204',
            effectiveAt: '2026-09-25T09:00:00.000Z',
          }),
        ],
      }),
    ).toBe(replayFingerprint(args));
    expect(replayFingerprint({ ...args, canonicalStartingPoint: startingPoint })).not.toBe(
      replayFingerprint(args),
    );
    expect(
      replayFingerprint({
        ...args,
        canonicalStartingPoint: { ...startingPoint, id: 'a12-fingerprint-cutover-2' },
      }),
    ).not.toBe(replayFingerprint({ ...args, canonicalStartingPoint: startingPoint }));
    expect(
      replayFingerprint({
        ...args,
        canonicalStartingPoint: { ...startingPoint, inventoryValue: '123.4568' },
      }),
    ).not.toBe(replayFingerprint({ ...args, canonicalStartingPoint: startingPoint }));
    expect(
      replayFingerprint({
        ...args,
        canonicalStartingPoint: { ...startingPoint, currency: 'ZWL' as CurrencyCode },
      }),
    ).not.toBe(replayFingerprint({ ...args, canonicalStartingPoint: startingPoint }));
    expect(
      replayFingerprint({
        ...args,
        canonicalStartingPoint: {
          ...startingPoint,
          quantityLitres: '100.0000',
          inventoryValue: '123.45670',
        },
      }),
    ).toBe(replayFingerprint({ ...args, canonicalStartingPoint: startingPoint }));
  });
});
