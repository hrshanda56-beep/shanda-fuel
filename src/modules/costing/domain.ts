import { createHash } from 'node:crypto';
import { AppError } from '../../platform/errors';
import {
  DECIMAL_POLICIES,
  ExactDecimal,
  type CurrencyCode,
} from '../../platform/domain/primitives';

export const COST_EVENT_TYPES = [
  'OPENING_COST',
  'RECEIPT_COST',
  'SALE_COGS',
  'COGS_REVALUATION',
  'INVENTORY_REVALUATION',
  'ADJUSTMENT_COST',
] as const;

export type CostEventType = (typeof COST_EVENT_TYPES)[number];
export type ValuationStatus = 'VALUED' | 'UNVALUED';

export type InventoryStreamKey = Readonly<{
  tenantId: string;
  stationId: string;
  tankId: string;
  productId: string;
}>;

export type CostingMovement = InventoryStreamKey &
  Readonly<{
    id: string;
    movementType: string;
    quantityLitres: string;
    effectiveAt: Date | string;
    businessDate?: string;
    sourceType: string;
    sourceId: string;
  }>;

export type CostingEvent = InventoryStreamKey &
  Readonly<{
    id: string;
    eventType: CostEventType;
    sourceType: string;
    sourceId: string;
    effectiveAt: Date | string;
    businessDate?: string;
    amount: string;
    currency: CurrencyCode;
  }>;

/**
 * Trusted state immediately before the A12 chronology supplied to the replay.
 * Pre-A12 movements are intentionally not accepted as part of that chronology.
 */
export type CanonicalCostingStartingPoint = InventoryStreamKey &
  Readonly<{
    id: string;
    effectiveAt: Date | string;
    quantityLitres: string;
    inventoryValue: string;
    currency: CurrencyCode;
  }>;

export type SaleCostAttribution = Readonly<{
  movementId: string;
  meterSegmentId: string;
  saleQuantityLitres: string;
  preSaleWac: string;
  originalCogs: string;
  saleCostEventId: string;
  valuationStatus: 'VALUED';
  valuationBasis: 'PRE_SALE_WAC';
  replayFingerprint: string;
  effectiveAt: Date | string;
  businessDate?: string;
}>;

export type OriginalSaleCostAttribution = SaleCostAttribution &
  Readonly<{
    id: string;
  }>;

export type CogsRevaluationDelta = Readonly<{
  saleMovementId: string;
  saleCostEventId: string;
  amount: string;
  revaluationLineId?: string;
}>;

export type PriorCogsRevaluationEvidence = CogsRevaluationDelta &
  Readonly<{
    revaluationLineId: string;
    priorRestatedCogs: string;
    recomputedCogs: string;
    replayFingerprint: string;
    postedAt: Date | string;
  }>;

export type CogsRevaluationBasis = Readonly<{
  priorDeltas: readonly PriorCogsRevaluationEvidence[];
}>;

export type CostRevaluationSaleLine = Readonly<{
  saleMovementId: string;
  saleAttributionId: string;
  meterSegmentId: string;
  originalPreSaleWac: string;
  recomputedPreSaleWac: string;
  originalCogs: string;
  priorRestatedCogs: string;
  recomputedCogs: string;
  cogsDelta: string;
  currency: CurrencyCode;
  saleEffectiveAt: Date | string;
  saleCostEventId: string;
  replayFingerprint: string;
}>;

export type CostRevaluationCalculation = Readonly<{
  key: InventoryStreamKey;
  source: Readonly<{
    eventType: 'OPENING_COST' | 'RECEIPT_COST';
    sourceType: string;
    sourceId: string;
    effectiveAt: Date | string;
    businessDate?: string;
    amount: string;
    currency: CurrencyCode;
  }>;
  basis: CogsRevaluationBasis;
  affectedSales: readonly CostRevaluationSaleLine[];
  originalFinalInventoryValue: string;
  recomputedFinalInventoryValue: string;
  conservation: Readonly<{
    lateCostAmount: string;
    cogsDeltaTotal: string;
    endingInventoryValueIncrease: string;
    reconciledAmount: string;
    residual: string;
    isConserved: true;
  }>;
  replayFingerprint: string;
}>;

export type CostStreamProjection = Readonly<{
  key: InventoryStreamKey;
  quantityLitres: string;
  inventoryValue: string | null;
  weightedAverageCost: string | null;
  currency: CurrencyCode | null;
  valuationStatus: ValuationStatus;
  lastMovement: Readonly<{ effectiveAt: Date | string; id: string }> | null;
  lastCostEvent: Readonly<{ effectiveAt: Date | string; id: string }> | null;
  saleAttributions: readonly SaleCostAttribution[];
}>;

type OrderedItem = Readonly<{
  effectiveAt: Date | string;
  id: string;
  kind: 'MOVEMENT' | 'COST_EVENT';
}>;
type OrderedMovement = CostingMovement & Readonly<{ kind: 'MOVEMENT' }>;
type OrderedCostEvent = CostingEvent & Readonly<{ kind: 'COST_EVENT' }>;
export type CostingReplayItem = OrderedMovement | OrderedCostEvent;

function epoch(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new AppError('VALIDATION_FAILED', 'A valid effective time is required');
  return parsed;
}

function compareOrderedItems(left: OrderedItem, right: OrderedItem): number {
  return (
    epoch(left.effectiveAt) - epoch(right.effectiveAt) ||
    (left.kind === right.kind ? 0 : left.kind === 'MOVEMENT' ? -1 : 1) ||
    left.id.localeCompare(right.id)
  );
}

export function orderInventoryMovements(
  movements: readonly CostingMovement[],
): readonly CostingMovement[] {
  return [...movements].sort((left, right) =>
    compareOrderedItems({ ...left, kind: 'MOVEMENT' }, { ...right, kind: 'MOVEMENT' }),
  );
}

export function orderInventoryCostEvents(events: readonly CostingEvent[]): readonly CostingEvent[] {
  return [...events].sort((left, right) =>
    compareOrderedItems({ ...left, kind: 'COST_EVENT' }, { ...right, kind: 'COST_EVENT' }),
  );
}

function streamKeyOf(value: InventoryStreamKey): string {
  return [value.tenantId, value.stationId, value.tankId, value.productId].join('|');
}

function assertSameStream(key: InventoryStreamKey, value: InventoryStreamKey): void {
  if (streamKeyOf(key) !== streamKeyOf(value)) {
    throw new AppError('INVARIANT_VIOLATION', 'Costing inputs must belong to one inventory stream');
  }
}

function sourceKey(sourceType: string, sourceId: string): string {
  return `${sourceType}|${sourceId}`;
}

function canonicalEffectiveAt(value: Date | string): string {
  return new Date(epoch(value)).toISOString();
}

function quantizedMoney(value: ExactDecimal): ExactDecimal {
  return value.quantize(DECIMAL_POLICIES.money);
}

function quantizedWac(value: ExactDecimal): ExactDecimal {
  return value.quantize(DECIMAL_POLICIES.weightedAverageCost);
}

function quantizedQuantity(value: ExactDecimal): ExactDecimal {
  return value.quantize(DECIMAL_POLICIES.litres);
}

function fixedQuantity(value: ExactDecimal): string {
  return value.value.toFixed(DECIMAL_POLICIES.litres.scale);
}

function fixedMoney(value: ExactDecimal): string {
  return value.value.toFixed(DECIMAL_POLICIES.money.scale);
}

function fixedWac(value: ExactDecimal): string {
  return value.value.toFixed(DECIMAL_POLICIES.weightedAverageCost.scale);
}

function currentWac(value: ExactDecimal | null, quantity: ExactDecimal): ExactDecimal | null {
  if (!value || quantity.value.isZero()) return null;
  if (quantity.value.isNegative()) {
    throw new AppError('INVARIANT_VIOLATION', 'Inventory quantity cannot be negative');
  }
  return quantizedWac(new ExactDecimal(value.value.div(quantity.value).toFixed()));
}

const positiveMovementCostEventType: Readonly<Partial<Record<string, CostEventType>>> = {
  OPENING_BALANCE: 'OPENING_COST',
  DELIVERY: 'RECEIPT_COST',
};

function expectedPositiveCostEventType(movement: CostingMovement): CostEventType | null {
  return positiveMovementCostEventType[movement.movementType] ?? null;
}

function isCanonicalSale(movement: CostingMovement): boolean {
  return movement.movementType === 'SALE' && movement.sourceType === 'METER_SEGMENT_SALE';
}

function isMatchingCanonicalSaleCostEvent(movement: CostingMovement, event: CostingEvent): boolean {
  return (
    isCanonicalSale(movement) &&
    event.eventType === 'SALE_COGS' &&
    event.sourceType === 'METER_SEGMENT_SALE' &&
    event.sourceId === movement.sourceId
  );
}

const deferredCostEventTypes = new Set<CostEventType>([
  'COGS_REVALUATION',
  'INVENTORY_REVALUATION',
  'ADJUSTMENT_COST',
]);

function compareReplayItems(
  left: CostingReplayItem,
  right: CostingReplayItem,
  canonicalSaleIdsBySource: ReadonlyMap<string, string>,
): number {
  const timeOrder = epoch(left.effectiveAt) - epoch(right.effectiveAt);
  if (timeOrder !== 0) return timeOrder;

  const replayGroup = (item: CostingReplayItem): readonly [number, string, number] => {
    if (item.kind === 'MOVEMENT') {
      return isCanonicalSale(item) ? [1, item.id, 1] : [0, item.id, 0];
    }
    if (item.eventType === 'COGS_REVALUATION') {
      return [3, '', 0];
    }
    const saleId =
      item.eventType === 'SALE_COGS' && item.sourceType === 'METER_SEGMENT_SALE'
        ? canonicalSaleIdsBySource.get(sourceKey(item.sourceType, item.sourceId))
        : undefined;
    return saleId ? [1, saleId, 0] : [2, item.id, 0];
  };
  const leftGroup = replayGroup(left);
  const rightGroup = replayGroup(right);
  return (
    leftGroup[0] - rightGroup[0] ||
    leftGroup[1].localeCompare(rightGroup[1]) ||
    leftGroup[2] - rightGroup[2] ||
    left.id.localeCompare(right.id)
  );
}

export function orderInventoryCostReplay(
  movements: readonly CostingMovement[],
  costEvents: readonly CostingEvent[],
): readonly CostingReplayItem[] {
  const canonicalSaleIdsBySource = new Map<string, string>();
  for (const movement of movements) {
    if (isCanonicalSale(movement)) {
      const source = sourceKey(movement.sourceType, movement.sourceId);
      if (!canonicalSaleIdsBySource.has(source)) {
        canonicalSaleIdsBySource.set(source, movement.id);
      }
    }
  }
  return [
    ...movements.map((movement) => ({ ...movement, kind: 'MOVEMENT' as const })),
    ...costEvents.map((event) => ({ ...event, kind: 'COST_EVENT' as const })),
  ].sort((left, right) => compareReplayItems(left, right, canonicalSaleIdsBySource));
}

function canonicalQuantity(value: string): string {
  return fixedQuantity(quantizedQuantity(new ExactDecimal(value)));
}

function canonicalMoney(value: string): string {
  return fixedMoney(quantizedMoney(new ExactDecimal(value)));
}

function canonicalWac(value: string): string {
  return fixedWac(quantizedWac(new ExactDecimal(value)));
}

function assertCurrency(value: string | undefined, context: string): CurrencyCode {
  if (!value || value.trim() === '') {
    throw new AppError('VALIDATION_FAILED', `${context} currency is required`);
  }
  return value as CurrencyCode;
}

function reconcileCurrency(
  current: CurrencyCode | null,
  next: string | undefined,
  context: string,
): CurrencyCode {
  const currency = assertCurrency(next, context);
  if (current && current !== currency) {
    throw new AppError('CONFLICT', `${context} currency does not match the costing stream`);
  }
  return current ?? currency;
}

function canonicalReplayPayload(input: {
  movement: CostingMovement;
  preSaleWac: string;
  originalCogs: string;
  orderedMovements: readonly CostingMovement[];
  orderedCostEvents: readonly CostingEvent[];
  canonicalStartingPoint?: CanonicalCostingStartingPoint;
}): string {
  const movementById = new Map(
    [...input.orderedMovements, input.movement].map((movement) => [movement.id, movement]),
  );
  const replayItems = orderInventoryCostReplay([...movementById.values()], input.orderedCostEvents);
  const saleIndex = replayItems.findIndex(
    (item) => item.kind === 'MOVEMENT' && item.id === input.movement.id,
  );
  const causalItems = saleIndex < 0 ? [] : replayItems.slice(0, saleIndex + 1);
  const fields = [
    ...(input.canonicalStartingPoint
      ? [
          [
            'starting-point',
            input.canonicalStartingPoint.id,
            input.canonicalStartingPoint.tenantId,
            input.canonicalStartingPoint.stationId,
            input.canonicalStartingPoint.tankId,
            input.canonicalStartingPoint.productId,
            canonicalEffectiveAt(input.canonicalStartingPoint.effectiveAt),
            canonicalQuantity(input.canonicalStartingPoint.quantityLitres),
            canonicalMoney(input.canonicalStartingPoint.inventoryValue),
            assertCurrency(input.canonicalStartingPoint.currency, 'Canonical starting point'),
          ],
        ]
      : []),
    [
      'movement',
      input.movement.id,
      input.movement.sourceType,
      input.movement.sourceId,
      canonicalEffectiveAt(input.movement.effectiveAt),
      input.movement.businessDate ?? null,
      canonicalQuantity(input.movement.quantityLitres),
    ],
    ['basis', canonicalWac(input.preSaleWac), canonicalMoney(input.originalCogs)],
    ...causalItems.map((item) =>
      item.kind === 'MOVEMENT'
        ? [
            'm',
            item.id,
            canonicalEffectiveAt(item.effectiveAt),
            item.businessDate ?? null,
            canonicalQuantity(item.quantityLitres),
            item.movementType,
            item.sourceType,
            item.sourceId,
          ]
        : [
            'c',
            item.id,
            canonicalEffectiveAt(item.effectiveAt),
            item.businessDate ?? null,
            canonicalMoney(item.amount),
            assertCurrency(item.currency, `Cost event ${item.id}`),
            item.eventType,
            item.sourceType,
            item.sourceId,
          ],
    ),
  ];
  return JSON.stringify(fields);
}

export function replayFingerprint(input: {
  movement: CostingMovement;
  preSaleWac: string;
  originalCogs: string;
  orderedMovements: readonly CostingMovement[];
  orderedCostEvents: readonly CostingEvent[];
  canonicalStartingPoint?: CanonicalCostingStartingPoint;
}): string {
  return createHash('sha256').update(canonicalReplayPayload(input), 'utf8').digest('hex');
}

export function deriveSaleCogsFromPreSaleState(input: {
  quantityLitres: string;
  inventoryValue: string;
  saleQuantityLitres: string;
}): { preSaleWac: string; originalCogs: string } {
  const quantity = quantizedQuantity(new ExactDecimal(input.quantityLitres));
  const value = quantizedMoney(new ExactDecimal(input.inventoryValue));
  const soldLitres = quantizedQuantity(new ExactDecimal(input.saleQuantityLitres));
  if (!quantity.value.isPositive()) {
    throw new AppError('CONFLICT', 'A sale requires positive pre-sale inventory');
  }
  if (value.value.isNegative() || !soldLitres.value.isPositive()) {
    throw new AppError('CONFLICT', 'A sale requires a valued positive pre-sale state');
  }
  if (soldLitres.value.gt(quantity.value)) {
    throw new AppError('INVARIANT_VIOLATION', 'A sale cannot exceed pre-sale inventory');
  }
  const preSaleWac = quantizedWac(new ExactDecimal(value.value.div(quantity.value).toFixed()));
  const originalCogs = quantizedMoney(preSaleWac.multiply(soldLitres));
  return { preSaleWac: fixedWac(preSaleWac), originalCogs: fixedMoney(originalCogs) };
}

export function restateSaleCogs(input: {
  originalCogs: string;
  saleMovementId: string;
  saleCostEventId: string;
  cogsRevaluationDeltas: readonly CogsRevaluationDelta[];
}): string {
  const restated = input.cogsRevaluationDeltas
    .filter(
      (delta) =>
        delta.saleMovementId === input.saleMovementId &&
        delta.saleCostEventId === input.saleCostEventId,
    )
    .reduce(
      (total, delta) => total.add(new ExactDecimal(delta.amount)),
      new ExactDecimal(input.originalCogs),
    );
  return fixedMoney(quantizedMoney(restated));
}

type RevaluationChronologySale = Readonly<{
  movement: CostingMovement;
  preSaleWac: string;
  cogs: string;
  saleCostEventId: string;
}>;

function replayRevaluationChronology(input: {
  key: InventoryStreamKey;
  movements: readonly CostingMovement[];
  costEvents: readonly CostingEvent[];
  canonicalStartingPoint?: CanonicalCostingStartingPoint;
}): {
  finalInventoryValue: string;
  currency: CurrencyCode;
  sales: readonly RevaluationChronologySale[];
} {
  const movements = orderInventoryMovements(input.movements);
  const costEvents = orderInventoryCostEvents(input.costEvents);
  let streamCurrency: CurrencyCode | null = null;
  for (const movement of movements) assertSameStream(input.key, movement);
  for (const event of costEvents) {
    assertSameStream(input.key, event);
    if (event.eventType !== 'COGS_REVALUATION') assertCostEventType(event);
    assertCurrency(event.currency, `Cost event ${event.id}`);
  }

  const costEventIds = new Set<string>();
  for (const event of costEvents) {
    if (costEventIds.has(event.id)) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Costing replay cannot contain duplicate cost event ids',
      );
    }
    costEventIds.add(event.id);
  }

  let quantity = new ExactDecimal('0');
  let ledgerValue: ExactDecimal | null = null;
  if (input.canonicalStartingPoint) {
    assertSameStream(input.key, input.canonicalStartingPoint);
    streamCurrency = assertCurrency(
      input.canonicalStartingPoint.currency,
      'Canonical starting point',
    );
    const baselineTime = epoch(input.canonicalStartingPoint.effectiveAt);
    for (const item of [...movements, ...costEvents]) {
      if (epoch(item.effectiveAt) <= baselineTime) {
        throw new AppError(
          'CONFLICT',
          'A12 cutover replay accepts only chronology after its canonical starting point',
        );
      }
    }
    quantity = quantizedQuantity(new ExactDecimal(input.canonicalStartingPoint.quantityLitres));
    ledgerValue = quantizedMoney(new ExactDecimal(input.canonicalStartingPoint.inventoryValue));
    if (quantity.value.isNegative() || ledgerValue.value.isNegative()) {
      throw new AppError('INVARIANT_VIOLATION', 'A12 canonical starting point cannot be negative');
    }
  }

  const pendingUnvaluedSources = new Map<
    string,
    Readonly<{ source: string; expectedEventType: CostEventType | null }>
  >();
  const encounteredPositiveMovementSources = new Map<string, Set<CostEventType | null>>();
  const encounteredCostBases = new Set<string>();
  const encounteredSaleCostEvents = new Set<string>();
  const consumedSaleCostEvents = new Set<string>();
  const sales: RevaluationChronologySale[] = [];

  for (const item of orderInventoryCostReplay(movements, costEvents)) {
    if (item.kind === 'MOVEMENT') {
      const signedQuantity = quantizedQuantity(new ExactDecimal(item.quantityLitres));
      if (signedQuantity.value.isZero()) {
        throw new AppError('VALIDATION_FAILED', 'Inventory movement quantity cannot be zero');
      }
      const nextQuantity = quantity.add(signedQuantity);
      if (nextQuantity.value.isNegative()) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'The costing replay would create negative inventory',
        );
      }

      if (signedQuantity.value.isNegative() && isCanonicalSale(item)) {
        if (pendingUnvaluedSources.size > 0 || !ledgerValue || quantity.value.isZero()) {
          throw new AppError(
            'CONFLICT',
            'A sale cannot be costed while the inventory stream is UNVALUED',
          );
        }
        const soldLitres = quantizedQuantity(
          new ExactDecimal(signedQuantity.value.abs().toFixed()),
        );
        const matchingSaleCosts = costEvents.filter((event) =>
          isMatchingCanonicalSaleCostEvent(item, event),
        );
        if (matchingSaleCosts.length !== 1 || !matchingSaleCosts[0]) {
          throw new AppError(
            'CONFLICT',
            'A canonical segment sale requires exactly one matching SALE_COGS event',
          );
        }
        const saleCostEvent = matchingSaleCosts[0];
        if (
          !encounteredSaleCostEvents.has(saleCostEvent.id) ||
          consumedSaleCostEvents.has(saleCostEvent.id)
        ) {
          throw new AppError(
            'CONFLICT',
            'The matching SALE_COGS event is not causally available at the sale',
          );
        }
        const { preSaleWac, originalCogs } = deriveSaleCogsFromPreSaleState({
          quantityLitres: quantity.value.toFixed(),
          inventoryValue: ledgerValue.value.toFixed(),
          saleQuantityLitres: soldLitres.value.toFixed(),
        });
        consumedSaleCostEvents.add(saleCostEvent.id);
        ledgerValue = quantizedMoney(ledgerValue.subtract(new ExactDecimal(originalCogs)));
        sales.push({
          movement: item,
          preSaleWac,
          cogs: originalCogs,
          saleCostEventId: saleCostEvent.id,
        });
      } else if (signedQuantity.value.isNegative()) {
        throw new AppError(
          'CONFLICT',
          'A12 costing requires a canonical starting point before legacy or noncanonical negative movements',
        );
      } else {
        const expectedEventType = expectedPositiveCostEventType(item);
        const movementSource = sourceKey(item.sourceType, item.sourceId);
        const expectations = encounteredPositiveMovementSources.get(movementSource) ?? new Set();
        expectations.add(expectedEventType);
        encounteredPositiveMovementSources.set(movementSource, expectations);
        const basisKey = expectedEventType ? `${movementSource}|${expectedEventType}` : null;
        if (!basisKey || !encounteredCostBases.has(basisKey)) {
          pendingUnvaluedSources.set(item.id, {
            source: movementSource,
            expectedEventType,
          });
        }
      }
      quantity = nextQuantity;
      continue;
    }

    const amount = quantizedMoney(new ExactDecimal(item.amount));
    streamCurrency = reconcileCurrency(streamCurrency, item.currency, `Cost event ${item.id}`);
    if (item.eventType === 'SALE_COGS') {
      if (item.sourceType === 'METER_SEGMENT_SALE') encounteredSaleCostEvents.add(item.id);
    } else if (item.eventType === 'OPENING_COST' || item.eventType === 'RECEIPT_COST') {
      if (!amount.value.isPositive()) {
        throw new AppError('INVARIANT_VIOLATION', `${item.eventType} must be positive`);
      }
      const eventSource = sourceKey(item.sourceType, item.sourceId);
      const expectations = encounteredPositiveMovementSources.get(eventSource);
      if (!expectations?.has(item.eventType)) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          `${item.eventType} must follow its matching positive A4 movement in replay order`,
        );
      }
      ledgerValue = ledgerValue ? quantizedMoney(ledgerValue.add(amount)) : amount;
      encounteredCostBases.add(`${eventSource}|${item.eventType}`);
      for (const [movementId, pending] of pendingUnvaluedSources) {
        if (pending.source === eventSource && pending.expectedEventType === item.eventType) {
          pendingUnvaluedSources.delete(movementId);
        }
      }
    }
  }

  const unconsumedSaleCostEvent = costEvents.find(
    (event) => event.eventType === 'SALE_COGS' && !consumedSaleCostEvents.has(event.id),
  );
  if (unconsumedSaleCostEvent) {
    throw new AppError(
      'CONFLICT',
      `SALE_COGS event ${unconsumedSaleCostEvent.id} was not consumed by exactly one canonical segment sale`,
    );
  }
  if (pendingUnvaluedSources.size > 0 || ledgerValue === null || streamCurrency === null) {
    throw new AppError('CONFLICT', 'Historical late-cost replay remains UNVALUED');
  }
  return {
    finalInventoryValue: fixedMoney(ledgerValue),
    currency: streamCurrency,
    sales,
  };
}

export function calculateLateCostRevaluation(input: {
  key: InventoryStreamKey;
  originalMovements: readonly CostingMovement[];
  originalCostEvents: readonly CostingEvent[];
  lateCostMovement: CostingMovement;
  lateCostEvent: CostingEvent;
  originalAttributions: readonly OriginalSaleCostAttribution[];
  priorRevaluationDeltas?: readonly PriorCogsRevaluationEvidence[];
  canonicalStartingPoint?: CanonicalCostingStartingPoint;
}): CostRevaluationCalculation {
  const expectedEventType =
    input.lateCostMovement.movementType === 'OPENING_BALANCE'
      ? 'OPENING_COST'
      : input.lateCostMovement.movementType === 'DELIVERY'
        ? 'RECEIPT_COST'
        : null;
  if (!expectedEventType || input.lateCostEvent.eventType !== expectedEventType) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Late cost must match the authoritative positive A4 movement type',
    );
  }
  assertSameStream(input.key, input.lateCostMovement);
  assertSameStream(input.key, input.lateCostEvent);
  if (
    input.lateCostMovement.sourceType !== input.lateCostEvent.sourceType ||
    input.lateCostMovement.sourceId !== input.lateCostEvent.sourceId ||
    canonicalEffectiveAt(input.lateCostMovement.effectiveAt) !==
      canonicalEffectiveAt(input.lateCostEvent.effectiveAt) ||
    (input.lateCostMovement.businessDate ?? null) !== (input.lateCostEvent.businessDate ?? null) ||
    !new ExactDecimal(input.lateCostMovement.quantityLitres).value.isPositive() ||
    !new ExactDecimal(input.lateCostEvent.amount).value.isPositive()
  ) {
    throw new AppError('INVARIANT_VIOLATION', 'Late cost must match its authoritative A4 movement');
  }

  const currentChronology = replayRevaluationChronology({
    key: input.key,
    movements: input.originalMovements,
    costEvents: input.originalCostEvents,
    canonicalStartingPoint: input.canonicalStartingPoint,
  });
  const originalAttributionByMovement = new Map(
    input.originalAttributions.map((attribution) => [attribution.movementId, attribution]),
  );
  if (originalAttributionByMovement.size !== input.originalAttributions.length) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Original sale attributions must be unique by movement',
    );
  }
  const originalSalesByMovement = new Map(
    currentChronology.sales.map((sale) => [sale.movement.id, sale]),
  );
  const priorDeltas = [...(input.priorRevaluationDeltas ?? [])];
  const priorDeltasBySale = new Map<string, PriorCogsRevaluationEvidence[]>();
  const priorLineIds = new Set<string>();
  for (const attribution of input.originalAttributions) {
    if (!attribution.id.trim()) {
      throw new AppError('VALIDATION_FAILED', 'Original sale attribution id is required');
    }
    const currentSale = originalSalesByMovement.get(attribution.movementId);
    if (!currentSale || currentSale.saleCostEventId !== attribution.saleCostEventId) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Original sale attribution does not match the current costing chronology',
      );
    }
  }
  for (const prior of priorDeltas) {
    if (!prior.revaluationLineId.trim() || !prior.replayFingerprint.trim()) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Prior revaluation evidence identifiers are required',
      );
    }
    if (priorLineIds.has(prior.revaluationLineId)) {
      throw new AppError('INVARIANT_VIOLATION', 'Prior revaluation line evidence must be unique');
    }
    priorLineIds.add(prior.revaluationLineId);
    const attribution = originalAttributionByMovement.get(prior.saleMovementId);
    if (!attribution || attribution.saleCostEventId !== prior.saleCostEventId) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Prior revaluation evidence must reference the immutable sale attribution',
      );
    }
    const saleDeltas = priorDeltasBySale.get(prior.saleMovementId) ?? [];
    saleDeltas.push(prior);
    priorDeltasBySale.set(prior.saleMovementId, saleDeltas);
  }
  const currentRestatedCogsBySale = new Map<string, string>();
  for (const attribution of input.originalAttributions) {
    const saleDeltas = [...(priorDeltasBySale.get(attribution.movementId) ?? [])].sort(
      (left, right) =>
        epoch(left.postedAt) - epoch(right.postedAt) ||
        left.revaluationLineId.localeCompare(right.revaluationLineId),
    );
    let currentRestatedCogs = canonicalMoney(attribution.originalCogs);
    for (const prior of saleDeltas) {
      if (canonicalMoney(prior.priorRestatedCogs) !== currentRestatedCogs) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'Prior revaluation evidence has an inconsistent restated-COGS basis',
        );
      }
      const expectedRestatedCogs = restateSaleCogs({
        originalCogs: prior.priorRestatedCogs,
        saleMovementId: prior.saleMovementId,
        saleCostEventId: prior.saleCostEventId,
        cogsRevaluationDeltas: [prior],
      });
      if (expectedRestatedCogs !== canonicalMoney(prior.recomputedCogs)) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'Prior revaluation evidence does not satisfy its incremental delta',
        );
      }
      currentRestatedCogs = expectedRestatedCogs;
    }
    const currentSale = originalSalesByMovement.get(attribution.movementId);
    if (!currentSale || currentSale.cogs !== currentRestatedCogs) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Current chronology does not match cumulative prior COGS revaluation evidence',
      );
    }
    currentRestatedCogsBySale.set(attribution.movementId, currentRestatedCogs);
  }
  const sortedPriorDeltas = [...priorDeltas].sort(
    (left, right) =>
      epoch(left.postedAt) - epoch(right.postedAt) ||
      left.revaluationLineId.localeCompare(right.revaluationLineId),
  );

  const revised = replayRevaluationChronology({
    key: input.key,
    movements: [...input.originalMovements, input.lateCostMovement],
    costEvents: [...input.originalCostEvents, input.lateCostEvent],
    canonicalStartingPoint: input.canonicalStartingPoint,
  });
  const revisedItems = orderInventoryCostReplay(
    [...input.originalMovements, input.lateCostMovement],
    [...input.originalCostEvents, input.lateCostEvent],
  );
  const lateCostIndex = revisedItems.findIndex(
    (item) => item.kind === 'COST_EVENT' && item.id === input.lateCostEvent.id,
  );
  if (lateCostIndex < 0) {
    throw new AppError('INVARIANT_VIOLATION', 'Late cost disappeared from deterministic replay');
  }
  const affectedSaleIds = new Set(
    revisedItems
      .slice(lateCostIndex + 1)
      .filter((item): item is OrderedMovement => item.kind === 'MOVEMENT' && isCanonicalSale(item))
      .map((item) => item.id),
  );
  const revisedSalesByMovement = new Map(revised.sales.map((sale) => [sale.movement.id, sale]));
  const affectedSales = [...affectedSaleIds]
    .map((movementId) => {
      const original = originalAttributionByMovement.get(movementId);
      const recomputed = revisedSalesByMovement.get(movementId);
      if (!original || !recomputed) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'Every affected historical sale must have an original attribution and replay result',
        );
      }
      const priorRestatedCogs = currentRestatedCogsBySale.get(movementId);
      if (!priorRestatedCogs) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'Affected sale has no current restated COGS basis',
        );
      }
      const cogsDelta = fixedMoney(
        quantizedMoney(
          new ExactDecimal(recomputed.cogs).subtract(new ExactDecimal(priorRestatedCogs)),
        ),
      );
      if (
        restateSaleCogs({
          originalCogs: priorRestatedCogs,
          saleMovementId: recomputed.movement.id,
          saleCostEventId: recomputed.saleCostEventId,
          cogsRevaluationDeltas: [
            {
              saleMovementId: recomputed.movement.id,
              saleCostEventId: recomputed.saleCostEventId,
              amount: cogsDelta,
            },
          ],
        }) !== recomputed.cogs
      ) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'Linked COGS_REVALUATION deltas do not restate historical COGS',
        );
      }
      const saleFingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            'a12.4-sale-line',
            original.id,
            recomputed.movement.id,
            original.saleCostEventId,
            canonicalWac(original.preSaleWac),
            recomputed.preSaleWac,
            canonicalMoney(original.originalCogs),
            priorRestatedCogs,
            recomputed.cogs,
            cogsDelta,
            revised.currency,
            canonicalEffectiveAt(recomputed.movement.effectiveAt),
          ]),
          'utf8',
        )
        .digest('hex');
      return {
        saleMovementId: recomputed.movement.id,
        saleAttributionId: original.id,
        meterSegmentId: recomputed.movement.sourceId,
        originalPreSaleWac: canonicalWac(original.preSaleWac),
        recomputedPreSaleWac: recomputed.preSaleWac,
        originalCogs: canonicalMoney(original.originalCogs),
        priorRestatedCogs,
        recomputedCogs: recomputed.cogs,
        cogsDelta,
        currency: revised.currency,
        saleEffectiveAt: recomputed.movement.effectiveAt,
        saleCostEventId: recomputed.saleCostEventId,
        replayFingerprint: saleFingerprint,
      } satisfies CostRevaluationSaleLine;
    })
    .sort(
      (left, right) =>
        epoch(left.saleEffectiveAt) - epoch(right.saleEffectiveAt) ||
        left.saleMovementId.localeCompare(right.saleMovementId),
    );

  const lateCostAmount = canonicalMoney(input.lateCostEvent.amount);
  const cogsDeltaTotal = fixedMoney(
    quantizedMoney(
      affectedSales.reduce(
        (total, sale) => total.add(new ExactDecimal(sale.cogsDelta)),
        new ExactDecimal('0'),
      ),
    ),
  );
  const endingInventoryValueIncrease = fixedMoney(
    quantizedMoney(
      new ExactDecimal(revised.finalInventoryValue).subtract(
        new ExactDecimal(currentChronology.finalInventoryValue),
      ),
    ),
  );
  const reconciledAmount = fixedMoney(
    quantizedMoney(
      new ExactDecimal(cogsDeltaTotal).add(new ExactDecimal(endingInventoryValueIncrease)),
    ),
  );
  const residual = fixedMoney(
    quantizedMoney(new ExactDecimal(lateCostAmount).subtract(new ExactDecimal(reconciledAmount))),
  );
  if (residual !== '0.0000') {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Late-cost revaluation does not conserve the historical cost amount',
    );
  }

  const fingerprintPayload = [
    'a12.4-revaluation',
    input.key.tenantId,
    input.key.stationId,
    input.key.tankId,
    input.key.productId,
    expectedEventType,
    input.lateCostMovement.sourceType,
    input.lateCostMovement.sourceId,
    canonicalEffectiveAt(input.lateCostMovement.effectiveAt),
    input.lateCostMovement.businessDate ?? null,
    lateCostAmount,
    assertCurrency(input.lateCostEvent.currency, 'Late cost'),
    canonicalMoney(currentChronology.finalInventoryValue),
    revised.finalInventoryValue,
    ...sortedPriorDeltas.map((prior) => [
      prior.revaluationLineId,
      prior.saleMovementId,
      prior.saleCostEventId,
      canonicalMoney(prior.priorRestatedCogs),
      canonicalMoney(prior.recomputedCogs),
      canonicalMoney(prior.amount),
      prior.replayFingerprint,
      canonicalEffectiveAt(prior.postedAt),
    ]),
    ...affectedSales.map((sale) => [
      sale.saleMovementId,
      sale.saleAttributionId,
      sale.originalPreSaleWac,
      sale.recomputedPreSaleWac,
      sale.originalCogs,
      sale.recomputedCogs,
      sale.cogsDelta,
      sale.saleCostEventId,
      canonicalEffectiveAt(sale.saleEffectiveAt),
      sale.replayFingerprint,
    ]),
  ];
  const replayFingerprint = createHash('sha256')
    .update(JSON.stringify(fingerprintPayload), 'utf8')
    .digest('hex');

  return {
    key: input.key,
    source: {
      eventType: expectedEventType,
      sourceType: input.lateCostEvent.sourceType,
      sourceId: input.lateCostEvent.sourceId,
      effectiveAt: input.lateCostEvent.effectiveAt,
      businessDate: input.lateCostEvent.businessDate,
      amount: lateCostAmount,
      currency: revised.currency,
    },
    basis: { priorDeltas: sortedPriorDeltas },
    affectedSales,
    originalFinalInventoryValue: canonicalMoney(currentChronology.finalInventoryValue),
    recomputedFinalInventoryValue: revised.finalInventoryValue,
    conservation: {
      lateCostAmount,
      cogsDeltaTotal,
      endingInventoryValueIncrease,
      reconciledAmount,
      residual,
      isConserved: true,
    },
    replayFingerprint,
  };
}

function assertCostEventType(event: CostingEvent, allowRevaluations = false): void {
  if (!COST_EVENT_TYPES.includes(event.eventType)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Unsupported inventory cost event type: ${event.eventType}`,
    );
  }
  if (event.eventType === 'SALE_COGS' && !new ExactDecimal(event.amount).value.isNegative()) {
    throw new AppError('INVARIANT_VIOLATION', 'SALE_COGS cost events must reduce inventory value');
  }
  if (
    deferredCostEventTypes.has(event.eventType) &&
    !(allowRevaluations && event.eventType === 'COGS_REVALUATION')
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      `${event.eventType} replay semantics are deferred beyond A12.2`,
    );
  }
}

/**
 * Replays one tenant/station/tank/product stream without mutating either
 * authoritative input. A4 owns quantity; A12 cost events alone change value.
 * A positive movement without a matching cost event keeps the stream
 * UNVALUED, so missing cost never becomes a numeric zero. Pre-A12 legacy
 * negative movements are excluded from this chronology; callers resume from a
 * trusted canonicalStartingPoint instead of inventing historical COGS.
 */
function projectInventoryCostInternal(
  input: {
    key: InventoryStreamKey;
    movements: readonly CostingMovement[];
    costEvents: readonly CostingEvent[];
    canonicalStartingPoint?: CanonicalCostingStartingPoint;
  },
  allowRevaluations: boolean,
): CostStreamProjection {
  const movements = orderInventoryMovements(input.movements);
  const costEvents = orderInventoryCostEvents(input.costEvents);
  let streamCurrency: CurrencyCode | null = null;
  for (const movement of movements) assertSameStream(input.key, movement);
  for (const event of costEvents) {
    assertSameStream(input.key, event);
    assertCostEventType(event, allowRevaluations);
    assertCurrency(event.currency, `Cost event ${event.id}`);
  }
  const costEventIds = new Set<string>();
  for (const event of costEvents) {
    if (costEventIds.has(event.id)) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Costing replay cannot contain duplicate cost event ids',
      );
    }
    costEventIds.add(event.id);
  }

  if (input.canonicalStartingPoint) {
    assertSameStream(input.key, input.canonicalStartingPoint);
    if (input.canonicalStartingPoint.id.trim() === '') {
      throw new AppError('VALIDATION_FAILED', 'A12 canonical starting point id is required');
    }
    streamCurrency = assertCurrency(
      input.canonicalStartingPoint.currency,
      'Canonical starting point',
    );
    const baselineTime = epoch(input.canonicalStartingPoint.effectiveAt);
    for (const movement of movements) {
      if (epoch(movement.effectiveAt) <= baselineTime) {
        throw new AppError(
          'CONFLICT',
          'A12 cutover replay accepts only movements after its canonical starting point',
        );
      }
    }
    for (const event of costEvents) {
      if (epoch(event.effectiveAt) <= baselineTime) {
        throw new AppError(
          'CONFLICT',
          'A12 cutover replay accepts only cost events after its canonical starting point',
        );
      }
    }
  }

  const pendingUnvaluedSources = new Map<
    string,
    Readonly<{ source: string; expectedEventType: CostEventType | null }>
  >();
  const encounteredPositiveMovementSources = new Map<string, Set<CostEventType | null>>();
  const encounteredCostBases = new Set<string>();
  const encounteredSaleCostEvents = new Set<string>();
  const consumedSaleCostEvents = new Set<string>();
  let quantity = new ExactDecimal('0');
  let ledgerValue: ExactDecimal | null = null;
  if (input.canonicalStartingPoint) {
    quantity = quantizedQuantity(new ExactDecimal(input.canonicalStartingPoint.quantityLitres));
    const baselineValue = quantizedMoney(
      new ExactDecimal(input.canonicalStartingPoint.inventoryValue),
    );
    if (quantity.value.isNegative() || baselineValue.value.isNegative()) {
      throw new AppError('INVARIANT_VIOLATION', 'A12 canonical starting point cannot be negative');
    }
    ledgerValue = baselineValue;
  }
  let lastMovement: CostStreamProjection['lastMovement'] = null;
  let lastCostEvent: CostStreamProjection['lastCostEvent'] = null;
  const saleAttributions: SaleCostAttribution[] = [];

  const ordered = orderInventoryCostReplay(movements, costEvents);

  for (const item of ordered) {
    if (item.kind === 'MOVEMENT') {
      const movement = item;
      const signedQuantity = quantizedQuantity(new ExactDecimal(movement.quantityLitres));
      if (signedQuantity.value.isZero()) {
        throw new AppError('VALIDATION_FAILED', 'Inventory movement quantity cannot be zero');
      }
      const nextQuantity = quantity.add(signedQuantity);
      if (nextQuantity.value.isNegative()) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'The costing replay would create negative inventory',
        );
      }
      if (signedQuantity.value.isNegative() && isCanonicalSale(movement)) {
        if (pendingUnvaluedSources.size > 0 || !ledgerValue || quantity.value.isZero()) {
          throw new AppError(
            'CONFLICT',
            'A sale cannot be costed while the inventory stream is UNVALUED',
          );
        }
        const soldLitres = quantizedQuantity(
          new ExactDecimal(signedQuantity.value.abs().toFixed()),
        );
        const saleCostMatches = costEvents.filter((event) =>
          isMatchingCanonicalSaleCostEvent(movement, event),
        );
        if (saleCostMatches.length !== 1) {
          throw new AppError(
            'CONFLICT',
            'A canonical segment sale requires exactly one matching SALE_COGS event',
          );
        }
        const saleCostEvent = saleCostMatches[0];
        if (!saleCostEvent) {
          throw new AppError(
            'CONFLICT',
            'A canonical segment sale requires exactly one matching SALE_COGS event',
          );
        }
        if (!encounteredSaleCostEvents.has(saleCostEvent.id)) {
          throw new AppError(
            'CONFLICT',
            'The matching SALE_COGS event is not causally available at the sale',
          );
        }
        if (consumedSaleCostEvents.has(saleCostEvent.id)) {
          throw new AppError('CONFLICT', 'A SALE_COGS event cannot be consumed more than once');
        }
        const { preSaleWac, originalCogs } = deriveSaleCogsFromPreSaleState({
          quantityLitres: quantity.value.toFixed(),
          inventoryValue: ledgerValue.value.toFixed(),
          saleQuantityLitres: soldLitres.value.toFixed(),
        });
        if (
          streamKeyOf(saleCostEvent) !== streamKeyOf(movement) ||
          saleCostEvent.currency !== streamCurrency ||
          canonicalEffectiveAt(saleCostEvent.effectiveAt) !==
            canonicalEffectiveAt(movement.effectiveAt) ||
          (saleCostEvent.businessDate ?? null) !== (movement.businessDate ?? null) ||
          (!allowRevaluations &&
            !new ExactDecimal(saleCostEvent.amount).equals(new ExactDecimal(`-${originalCogs}`)))
        ) {
          throw new AppError(
            'INVARIANT_VIOLATION',
            'SALE_COGS authority does not match the canonical segment sale',
          );
        }
        consumedSaleCostEvents.add(saleCostEvent.id);
        ledgerValue = quantizedMoney(ledgerValue.add(new ExactDecimal(saleCostEvent.amount)));
        saleAttributions.push({
          movementId: movement.id,
          meterSegmentId: movement.sourceId,
          saleQuantityLitres: fixedQuantity(soldLitres),
          preSaleWac,
          originalCogs,
          saleCostEventId: saleCostEvent.id,
          valuationStatus: 'VALUED',
          valuationBasis: 'PRE_SALE_WAC',
          replayFingerprint: replayFingerprint({
            movement,
            preSaleWac,
            originalCogs,
            orderedMovements: movements,
            orderedCostEvents: costEvents,
            canonicalStartingPoint: input.canonicalStartingPoint,
          }),
          effectiveAt: movement.effectiveAt,
          businessDate: movement.businessDate,
        });
      } else if (signedQuantity.value.isNegative()) {
        throw new AppError(
          'CONFLICT',
          'A12 costing requires a canonical starting point before legacy or noncanonical negative movements',
        );
      } else if (signedQuantity.value.isPositive()) {
        const expectedEventType = expectedPositiveCostEventType(movement);
        const movementSource = sourceKey(movement.sourceType, movement.sourceId);
        const encounteredExpectations =
          encounteredPositiveMovementSources.get(movementSource) ?? new Set();
        encounteredExpectations.add(expectedEventType);
        encounteredPositiveMovementSources.set(movementSource, encounteredExpectations);
        const basisKey = expectedEventType ? `${movementSource}|${expectedEventType}` : null;
        if (!basisKey || !encounteredCostBases.has(basisKey)) {
          pendingUnvaluedSources.set(movement.id, {
            source: sourceKey(movement.sourceType, movement.sourceId),
            expectedEventType,
          });
        }
      }
      quantity = nextQuantity;
      lastMovement = { effectiveAt: movement.effectiveAt, id: movement.id };
      continue;
    }

    const event = item;
    const amount = quantizedMoney(new ExactDecimal(event.amount));
    streamCurrency = reconcileCurrency(streamCurrency, event.currency, `Cost event ${event.id}`);
    if (event.eventType === 'SALE_COGS') {
      if (event.sourceType === 'METER_SEGMENT_SALE') {
        encounteredSaleCostEvents.add(event.id);
      }
    } else if (event.eventType === 'OPENING_COST' || event.eventType === 'RECEIPT_COST') {
      const eventSource = sourceKey(event.sourceType, event.sourceId);
      const encounteredExpectations = encounteredPositiveMovementSources.get(eventSource);
      if (!encounteredExpectations?.has(event.eventType)) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          `${event.eventType} must follow its matching positive A4 movement in replay order`,
        );
      }
      ledgerValue = ledgerValue ? quantizedMoney(ledgerValue.add(amount)) : amount;
      const basisKey = `${eventSource}|${event.eventType}`;
      encounteredCostBases.add(basisKey);
      for (const [movementId, pending] of pendingUnvaluedSources) {
        if (
          pending.source === sourceKey(event.sourceType, event.sourceId) &&
          pending.expectedEventType === event.eventType
        ) {
          pendingUnvaluedSources.delete(movementId);
        }
      }
    } else if (event.eventType === 'COGS_REVALUATION' && allowRevaluations) {
      if (!ledgerValue) {
        throw new AppError('CONFLICT', 'A COGS revaluation requires a valued inventory stream');
      }
      ledgerValue = quantizedMoney(ledgerValue.subtract(amount));
    } else {
      throw new AppError(
        'INVARIANT_VIOLATION',
        `${event.eventType} replay semantics are deferred beyond A12.2`,
      );
    }
    lastCostEvent = { effectiveAt: event.effectiveAt, id: event.id };
  }

  if (quantity.value.isNegative()) {
    throw new AppError('INVARIANT_VIOLATION', 'The costing replay would create negative inventory');
  }
  const unconsumedSaleCostEvent = costEvents.find(
    (event) => event.eventType === 'SALE_COGS' && !consumedSaleCostEvents.has(event.id),
  );
  if (unconsumedSaleCostEvent) {
    throw new AppError(
      'CONFLICT',
      `SALE_COGS event ${unconsumedSaleCostEvent.id} was not consumed by exactly one canonical segment sale`,
    );
  }
  const status: ValuationStatus =
    pendingUnvaluedSources.size === 0 && ledgerValue !== null ? 'VALUED' : 'UNVALUED';
  const inventoryValue =
    status === 'VALUED' && ledgerValue ? fixedMoney(quantizedMoney(ledgerValue)) : null;
  const weightedAverageValue =
    status === 'VALUED' && ledgerValue ? currentWac(ledgerValue, quantity) : null;
  const weightedAverage = weightedAverageValue ? fixedWac(weightedAverageValue) : null;
  return {
    key: input.key,
    quantityLitres: fixedQuantity(quantizedQuantity(quantity)),
    inventoryValue,
    weightedAverageCost: weightedAverage,
    currency: status === 'VALUED' ? streamCurrency : null,
    valuationStatus: status,
    lastMovement,
    lastCostEvent,
    saleAttributions,
  };
}

export function projectInventoryCost(input: {
  key: InventoryStreamKey;
  movements: readonly CostingMovement[];
  costEvents: readonly CostingEvent[];
  canonicalStartingPoint?: CanonicalCostingStartingPoint;
}): CostStreamProjection {
  return projectInventoryCostInternal(input, false);
}

export function projectInventoryCostWithRevaluations(input: {
  key: InventoryStreamKey;
  movements: readonly CostingMovement[];
  costEvents: readonly CostingEvent[];
  canonicalStartingPoint?: CanonicalCostingStartingPoint;
}): CostStreamProjection {
  return projectInventoryCostInternal(input, true);
}

function projectInventoryCostBeforeSaleInternal(
  input: {
    key: InventoryStreamKey;
    movements: readonly CostingMovement[];
    costEvents: readonly CostingEvent[];
    saleMovementId: string;
  },
  allowRevaluations: boolean,
): CostStreamProjection {
  const ordered = orderInventoryCostReplay(input.movements, input.costEvents);
  const saleIndex = ordered.findIndex(
    (item) => item.kind === 'MOVEMENT' && item.id === input.saleMovementId,
  );
  const sale = ordered[saleIndex];
  if (!sale || sale.kind !== 'MOVEMENT') {
    throw new AppError('INTERNAL_ERROR', 'The canonical sale movement disappeared');
  }
  const beforeSale = ordered
    .slice(0, saleIndex)
    .filter(
      (item) => !(item.kind === 'COST_EVENT' && isMatchingCanonicalSaleCostEvent(sale, item)),
    );
  const projectionInput = {
    key: input.key,
    movements: beforeSale.filter((item) => item.kind === 'MOVEMENT'),
    costEvents: beforeSale.filter((item) => item.kind === 'COST_EVENT'),
  };
  return allowRevaluations
    ? projectInventoryCostWithRevaluations(projectionInput)
    : projectInventoryCost(projectionInput);
}

export function projectInventoryCostBeforeSale(input: {
  key: InventoryStreamKey;
  movements: readonly CostingMovement[];
  costEvents: readonly CostingEvent[];
  saleMovementId: string;
}): CostStreamProjection {
  return projectInventoryCostBeforeSaleInternal(input, false);
}

export function projectInventoryCostBeforeSaleWithRevaluations(input: {
  key: InventoryStreamKey;
  movements: readonly CostingMovement[];
  costEvents: readonly CostingEvent[];
  saleMovementId: string;
}): CostStreamProjection {
  return projectInventoryCostBeforeSaleInternal(input, true);
}

function projectInventoryCostThroughSaleInternal(
  input: {
    key: InventoryStreamKey;
    movements: readonly CostingMovement[];
    costEvents: readonly CostingEvent[];
    saleMovementId: string;
  },
  allowRevaluations: boolean,
): CostStreamProjection {
  const ordered = orderInventoryCostReplay(input.movements, input.costEvents);
  const saleIndex = ordered.findIndex(
    (item) => item.kind === 'MOVEMENT' && item.id === input.saleMovementId,
  );
  const sale = ordered[saleIndex];
  if (!sale || sale.kind !== 'MOVEMENT') {
    throw new AppError('INTERNAL_ERROR', 'The canonical sale movement disappeared');
  }
  const throughSale = ordered.slice(0, saleIndex + 1);
  const projectionInput = {
    key: input.key,
    movements: throughSale.filter((item) => item.kind === 'MOVEMENT'),
    costEvents: throughSale.filter((item) => item.kind === 'COST_EVENT'),
  };
  return allowRevaluations
    ? projectInventoryCostWithRevaluations(projectionInput)
    : projectInventoryCost(projectionInput);
}

export function projectInventoryCostThroughSale(input: {
  key: InventoryStreamKey;
  movements: readonly CostingMovement[];
  costEvents: readonly CostingEvent[];
  saleMovementId: string;
}): CostStreamProjection {
  return projectInventoryCostThroughSaleInternal(input, false);
}

export function projectInventoryCostThroughSaleWithRevaluations(input: {
  key: InventoryStreamKey;
  movements: readonly CostingMovement[];
  costEvents: readonly CostingEvent[];
  saleMovementId: string;
}): CostStreamProjection {
  return projectInventoryCostThroughSaleInternal(input, true);
}
