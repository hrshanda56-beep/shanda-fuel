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
  left: OrderedMovement | OrderedCostEvent,
  right: OrderedMovement | OrderedCostEvent,
): number {
  const timeOrder = epoch(left.effectiveAt) - epoch(right.effectiveAt);
  if (timeOrder !== 0) return timeOrder;

  if (left.kind === 'COST_EVENT' && right.kind === 'MOVEMENT') {
    if (isMatchingCanonicalSaleCostEvent(right, left)) return -1;
  }
  if (left.kind === 'MOVEMENT' && right.kind === 'COST_EVENT') {
    if (isMatchingCanonicalSaleCostEvent(left, right)) return 1;
  }
  const kindOrder = left.kind === right.kind ? 0 : left.kind === 'MOVEMENT' ? -1 : 1;
  return kindOrder || left.id.localeCompare(right.id);
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
  const replayItems: readonly (OrderedMovement | OrderedCostEvent)[] = [
    ...[...movementById.values()].map((movement) => ({ ...movement, kind: 'MOVEMENT' as const })),
    ...input.orderedCostEvents.map((event) => ({ ...event, kind: 'COST_EVENT' as const })),
  ].sort(compareReplayItems);
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

function assertCostEventType(event: CostingEvent): void {
  if (!COST_EVENT_TYPES.includes(event.eventType)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Unsupported inventory cost event type: ${event.eventType}`,
    );
  }
  if (event.eventType === 'SALE_COGS' && !new ExactDecimal(event.amount).value.isNegative()) {
    throw new AppError('INVARIANT_VIOLATION', 'SALE_COGS cost events must reduce inventory value');
  }
  if (deferredCostEventTypes.has(event.eventType)) {
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
export function projectInventoryCost(input: {
  key: InventoryStreamKey;
  movements: readonly CostingMovement[];
  costEvents: readonly CostingEvent[];
  canonicalStartingPoint?: CanonicalCostingStartingPoint;
}): CostStreamProjection {
  const movements = orderInventoryMovements(input.movements);
  const costEvents = orderInventoryCostEvents(input.costEvents);
  let streamCurrency: CurrencyCode | null = null;
  for (const movement of movements) assertSameStream(input.key, movement);
  for (const event of costEvents) {
    assertSameStream(input.key, event);
    assertCostEventType(event);
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

  const ordered: readonly (OrderedMovement | OrderedCostEvent)[] = [
    ...movements.map((movement) => ({ ...movement, kind: 'MOVEMENT' as const })),
    ...costEvents.map((event) => ({ ...event, kind: 'COST_EVENT' as const })),
  ].sort(compareReplayItems);

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
          !new ExactDecimal(saleCostEvent.amount).equals(new ExactDecimal(`-${originalCogs}`))
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
    currency: streamCurrency,
    valuationStatus: status,
    lastMovement,
    lastCostEvent,
    saleAttributions,
  };
}
