import { describe, expect, it } from 'vitest';
import {
  orderInventoryCostEvents,
  orderInventoryMovements,
  calculateLateCostRevaluation,
  deriveSaleCogsFromPreSaleState,
  projectInventoryCost,
  projectInventoryCostBeforeSale,
  replayFingerprint,
  restateSaleCogs,
  type OriginalSaleCostAttribution,
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

function lateRevaluationScenario(
  options: {
    lateAmount?: string;
    includeUnaffectedSale?: boolean;
    includeSecondSale?: boolean;
    saleQuantityLitres?: string;
  } = {},
) {
  const saleQuantityLitres = options.saleQuantityLitres ?? '25.000';
  const includeSecondSale = options.includeSecondSale ?? true;
  const saleCogs = `${saleQuantityLitres}0`;
  const opening = movement({
    id: '00000000-0000-4000-8000-000000000111',
    quantityLitres: '100.000',
  });
  const unaffectedSale = movement({
    id: '00000000-0000-4000-8000-000000000112',
    movementType: 'SALE',
    quantityLitres: '-10.000',
    effectiveAt: '2026-09-25T06:30:00.000Z',
    sourceType: 'METER_SEGMENT_SALE',
    sourceId: '00000000-0000-4000-8000-000000000212',
  });
  const lateReceipt = movement({
    id: '00000000-0000-4000-8000-000000000113',
    movementType: 'DELIVERY',
    quantityLitres: '100.000',
    effectiveAt: '2026-09-25T07:00:00.000Z',
    sourceType: 'FUEL_DELIVERY_ALLOCATION',
    sourceId: '00000000-0000-4000-8000-000000000213',
  });
  const firstSale = movement({
    id: '00000000-0000-4000-8000-000000000114',
    movementType: 'SALE',
    quantityLitres: `-${saleQuantityLitres}`,
    effectiveAt: '2026-09-25T08:00:00.000Z',
    sourceType: 'METER_SEGMENT_SALE',
    sourceId: '00000000-0000-4000-8000-000000000214',
  });
  const secondSale = movement({
    id: '00000000-0000-4000-8000-000000000115',
    movementType: 'SALE',
    quantityLitres: `-${saleQuantityLitres}`,
    effectiveAt: '2026-09-25T10:00:00.000Z',
    sourceType: 'METER_SEGMENT_SALE',
    sourceId: '00000000-0000-4000-8000-000000000215',
  });
  const openingCost = event({
    id: '00000000-0000-4000-8000-000000000311',
    amount: '100.0000',
  });
  const unaffectedSaleCost = event({
    id: '00000000-0000-4000-8000-000000000312',
    eventType: 'SALE_COGS',
    sourceType: 'METER_SEGMENT_SALE',
    sourceId: unaffectedSale.sourceId,
    effectiveAt: unaffectedSale.effectiveAt,
    amount: '-10.0000',
  });
  const firstSaleCost = event({
    id: '00000000-0000-4000-8000-000000000313',
    eventType: 'SALE_COGS',
    sourceType: 'METER_SEGMENT_SALE',
    sourceId: firstSale.sourceId,
    effectiveAt: firstSale.effectiveAt,
    amount: `-${saleCogs}`,
  });
  const secondSaleCost = event({
    id: '00000000-0000-4000-8000-000000000314',
    eventType: 'SALE_COGS',
    sourceType: 'METER_SEGMENT_SALE',
    sourceId: secondSale.sourceId,
    effectiveAt: secondSale.effectiveAt,
    amount: `-${saleCogs}`,
  });
  const lateCost = event({
    id: '00000000-0000-4000-8000-000000000315',
    eventType: 'RECEIPT_COST',
    sourceType: lateReceipt.sourceType,
    sourceId: lateReceipt.sourceId,
    effectiveAt: lateReceipt.effectiveAt,
    amount: options.lateAmount ?? '300.0000',
  });
  const originalMovements = [
    opening,
    ...(options.includeUnaffectedSale ? [unaffectedSale] : []),
    firstSale,
    ...(includeSecondSale ? [secondSale] : []),
  ];
  const originalCostEvents = [
    openingCost,
    ...(options.includeUnaffectedSale ? [unaffectedSaleCost] : []),
    firstSaleCost,
    ...(includeSecondSale ? [secondSaleCost] : []),
  ];
  const originalAttributions: OriginalSaleCostAttribution[] = [
    ...(options.includeUnaffectedSale
      ? [
          {
            id: '00000000-0000-4000-8000-000000000411',
            movementId: unaffectedSale.id,
            meterSegmentId: unaffectedSale.sourceId,
            saleQuantityLitres: '10.000',
            preSaleWac: '1.00000000',
            originalCogs: '10.0000',
            saleCostEventId: unaffectedSaleCost.id,
            valuationStatus: 'VALUED',
            valuationBasis: 'PRE_SALE_WAC',
            replayFingerprint: 'original-unaffected',
            effectiveAt: unaffectedSale.effectiveAt,
          } satisfies OriginalSaleCostAttribution,
        ]
      : []),
    {
      id: '00000000-0000-4000-8000-000000000412',
      movementId: firstSale.id,
      meterSegmentId: firstSale.sourceId,
      saleQuantityLitres,
      preSaleWac: '1.00000000',
      originalCogs: saleCogs,
      saleCostEventId: firstSaleCost.id,
      valuationStatus: 'VALUED',
      valuationBasis: 'PRE_SALE_WAC',
      replayFingerprint: 'original-first',
      effectiveAt: firstSale.effectiveAt,
    },
    ...(includeSecondSale
      ? [
          {
            id: '00000000-0000-4000-8000-000000000413',
            movementId: secondSale.id,
            meterSegmentId: secondSale.sourceId,
            saleQuantityLitres,
            preSaleWac: '1.00000000',
            originalCogs: saleCogs,
            saleCostEventId: secondSaleCost.id,
            valuationStatus: 'VALUED',
            valuationBasis: 'PRE_SALE_WAC',
            replayFingerprint: 'original-second',
            effectiveAt: secondSale.effectiveAt,
          } satisfies OriginalSaleCostAttribution,
        ]
      : []),
  ];
  return {
    key,
    originalMovements,
    originalCostEvents,
    lateCostMovement: lateReceipt,
    lateCostEvent: lateCost,
    originalAttributions,
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

  it('calculates one-sale late receipt revaluation and conserves the cost', () => {
    const input = lateRevaluationScenario({
      includeSecondSale: false,
      saleQuantityLitres: '25.000',
    });
    const result = calculateLateCostRevaluation(input);

    expect(result.affectedSales).toHaveLength(1);
    expect(result.affectedSales[0]).toMatchObject({
      originalPreSaleWac: '1.00000000',
      recomputedPreSaleWac: '2.00000000',
      originalCogs: '25.0000',
      recomputedCogs: '50.0000',
      cogsDelta: '25.0000',
      currency: 'USD',
    });
    expect(result.conservation).toEqual({
      lateCostAmount: '300.0000',
      cogsDeltaTotal: '25.0000',
      endingInventoryValueIncrease: '275.0000',
      reconciledAmount: '300.0000',
      residual: '0.0000',
      isConserved: true,
    });
    expect(result.originalFinalInventoryValue).toBe('75.0000');
    expect(result.recomputedFinalInventoryValue).toBe('350.0000');
  });

  it('revalues multiple affected sales while leaving earlier sales unchanged', () => {
    const result = calculateLateCostRevaluation(
      lateRevaluationScenario({ includeUnaffectedSale: true }),
    );

    expect(result.affectedSales.map((sale) => sale.saleMovementId)).toEqual([
      '00000000-0000-4000-8000-000000000114',
      '00000000-0000-4000-8000-000000000115',
    ]);
    expect(
      result.affectedSales.every(
        (sale) => sale.saleMovementId !== '00000000-0000-4000-8000-000000000112',
      ),
    ).toBe(true);
    expect(result.affectedSales.map((sale) => sale.cogsDelta)).toEqual(['26.3158', '26.3158']);
  });

  it('applies sequential late-cost deltas incrementally to the same historical sale', () => {
    const firstInput = lateRevaluationScenario({
      includeSecondSale: false,
      saleQuantityLitres: '25.000',
    });
    const first = calculateLateCostRevaluation(firstInput);
    const firstLine = first.affectedSales[0];
    expect(firstLine).toBeDefined();

    const firstLineId = '00000000-0000-4000-8000-000000000501';
    const firstRevaluationEvent = event({
      id: '00000000-0000-4000-8000-000000000502',
      eventType: 'COGS_REVALUATION',
      sourceType: 'INVENTORY_COST_REVALUATION_LINE',
      sourceId: firstLineId,
      effectiveAt: firstLine!.saleEffectiveAt,
      amount: firstLine!.cogsDelta,
    });
    const secondLateReceipt = movement({
      id: '00000000-0000-4000-8000-000000000116',
      movementType: 'DELIVERY',
      quantityLitres: '100.000',
      effectiveAt: '2026-09-25T06:30:00.000Z',
      sourceType: 'FUEL_DELIVERY_ALLOCATION',
      sourceId: '00000000-0000-4000-8000-000000000216',
    });
    const secondLateCost = event({
      id: '00000000-0000-4000-8000-000000000503',
      eventType: 'RECEIPT_COST',
      sourceType: secondLateReceipt.sourceType,
      sourceId: secondLateReceipt.sourceId,
      effectiveAt: secondLateReceipt.effectiveAt,
      amount: '100.0000',
    });
    const second = calculateLateCostRevaluation({
      ...firstInput,
      originalMovements: [...firstInput.originalMovements, firstInput.lateCostMovement],
      originalCostEvents: [
        ...firstInput.originalCostEvents,
        firstInput.lateCostEvent,
        firstRevaluationEvent,
      ],
      lateCostMovement: secondLateReceipt,
      lateCostEvent: secondLateCost,
      priorRevaluationDeltas: [
        {
          revaluationLineId: firstLineId,
          saleMovementId: firstLine!.saleMovementId,
          saleCostEventId: firstLine!.saleCostEventId,
          amount: firstLine!.cogsDelta,
          priorRestatedCogs: firstLine!.originalCogs,
          recomputedCogs: firstLine!.recomputedCogs,
          replayFingerprint: firstLine!.replayFingerprint,
          postedAt: '2026-09-26T10:00:00.000Z',
        },
      ],
    });
    const secondLine = second.affectedSales[0];

    expect(firstLine).toMatchObject({
      originalCogs: '25.0000',
      priorRestatedCogs: '25.0000',
      recomputedCogs: '50.0000',
      cogsDelta: '25.0000',
    });
    expect(secondLine).toMatchObject({
      originalCogs: '25.0000',
      priorRestatedCogs: '50.0000',
      recomputedCogs: '41.6667',
      cogsDelta: '-8.3333',
    });
    expect(
      restateSaleCogs({
        originalCogs: firstLine!.originalCogs,
        saleMovementId: secondLine!.saleMovementId,
        saleCostEventId: secondLine!.saleCostEventId,
        cogsRevaluationDeltas: [
          { ...firstLine!, amount: firstLine!.cogsDelta },
          { ...secondLine!, amount: secondLine!.cogsDelta },
        ],
      }),
    ).toBe('41.6667');
    expect(first.conservation.residual).toBe('0.0000');
    expect(second.conservation).toMatchObject({
      lateCostAmount: '100.0000',
      cogsDeltaTotal: '-8.3333',
      endingInventoryValueIncrease: '108.3333',
      reconciledAmount: '100.0000',
      residual: '0.0000',
      isConserved: true,
    });
    expect(second.basis.priorDeltas).toHaveLength(1);
  });

  it('retains a zero-delta affected sale after money quantization', () => {
    const result = calculateLateCostRevaluation(
      lateRevaluationScenario({
        includeSecondSale: false,
        lateAmount: '100.0000',
        saleQuantityLitres: '1.000',
      }),
    );

    expect(result.affectedSales).toHaveLength(1);
    expect(result.affectedSales.every((sale) => sale.cogsDelta === '0.0000')).toBe(true);
    expect(result.conservation.residual).toBe('0.0000');
  });

  it('is deterministic across input order and exposes a stable replay fingerprint', () => {
    const input = lateRevaluationScenario();
    const first = calculateLateCostRevaluation(input);
    const reversed = calculateLateCostRevaluation({
      ...input,
      originalMovements: [...input.originalMovements].reverse(),
      originalCostEvents: [...input.originalCostEvents].reverse(),
      originalAttributions: [...input.originalAttributions].reverse(),
    });

    expect(reversed).toEqual(first);
    expect(first.replayFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.affectedSales.every((sale) => sale.replayFingerprint.length === 64)).toBe(true);
  });

  it('supports append-only COGS delta restatement without changing original COGS', () => {
    const original = '100.0000';
    const deltas = [
      {
        saleMovementId: 'sale-1',
        saleCostEventId: 'sale-cost-1',
        amount: '12.3456',
      },
      {
        saleMovementId: 'sale-1',
        saleCostEventId: 'sale-cost-1',
        amount: '-2.0000',
      },
    ];
    expect(
      restateSaleCogs({
        originalCogs: original,
        saleMovementId: 'sale-1',
        saleCostEventId: 'sale-cost-1',
        cogsRevaluationDeltas: deltas,
      }),
    ).toBe('110.3456');
    expect(original).toBe('100.0000');
  });

  it('rejects late-cost currency mismatch', () => {
    const input = lateRevaluationScenario();
    expect(() =>
      calculateLateCostRevaluation({
        ...input,
        lateCostEvent: { ...input.lateCostEvent, currency: 'ZWL' as CurrencyCode },
      }),
    ).toThrow('currency does not match');
  });

  it('rejects negative-stock original chronology', () => {
    const input = lateRevaluationScenario({ saleQuantityLitres: '125.000' });
    expect(() => calculateLateCostRevaluation(input)).toThrow('negative inventory');
  });

  it('does not mutate original chronology or attribution inputs', () => {
    const input = lateRevaluationScenario();
    const before = structuredClone(input);
    calculateLateCostRevaluation(input);
    expect(input).toEqual(before);
  });
});
