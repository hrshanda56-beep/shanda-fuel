import { AppError } from '../../platform/errors';
import { ExactDecimal, litres } from '../../platform/domain/primitives';

export const INVENTORY_MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'DELIVERY',
  'SALE',
  'APPROVED_ISSUE',
  'POSITIVE_ADJUSTMENT',
  'NEGATIVE_ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

const positiveMovementTypes = new Set<InventoryMovementType>([
  'OPENING_BALANCE',
  'DELIVERY',
  'POSITIVE_ADJUSTMENT',
  'TRANSFER_IN',
]);

const negativeMovementTypes = new Set<InventoryMovementType>([
  'SALE',
  'APPROVED_ISSUE',
  'NEGATIVE_ADJUSTMENT',
  'TRANSFER_OUT',
]);

export type StockMovement = Readonly<{
  movementType: InventoryMovementType;
  quantityLitres: string;
}>;

function decimal(value: string): ExactDecimal {
  return new ExactDecimal(value);
}

export function validateMovementQuantity(
  movementType: InventoryMovementType,
  quantityLitres: string,
): string {
  const quantity = decimal(quantityLitres);
  if (quantity.value.isZero()) {
    throw new AppError('VALIDATION_FAILED', 'Inventory movement quantity cannot be zero');
  }
  if (positiveMovementTypes.has(movementType) && !quantity.value.gt(0)) {
    throw new AppError('VALIDATION_FAILED', `${movementType} movement quantity must be positive`);
  }
  if (negativeMovementTypes.has(movementType) && !quantity.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', `${movementType} movement quantity must be negative`);
  }
  return litres(quantity.toString()).toString();
}

export function calculateDeliveryShortageExcess(
  noteQuantityLitres: string,
  actualQuantityLitres: string,
): string {
  const note = litres(noteQuantityLitres);
  const actual = litres(actualQuantityLitres);
  if (note.value.isNegative() || actual.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', 'Delivery quantities cannot be negative');
  }
  return actual.subtract(note).toString();
}

/** Before/after delivery dips must bracket the delivery they describe. */
export function validateDeliveryDipWindow(
  deliveredAt: string,
  beforeMeasuredAt?: string,
  afterMeasuredAt?: string,
): void {
  const delivered = new Date(deliveredAt).getTime();
  if (beforeMeasuredAt && new Date(beforeMeasuredAt).getTime() > delivered) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The before-delivery dip must be at or before delivery time.',
    );
  }
  if (afterMeasuredAt && new Date(afterMeasuredAt).getTime() < delivered) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The after-delivery dip must be at or after delivery time.',
    );
  }
}

export function validateDeliveryAllocations(
  actualQuantityLitres: string,
  allocations: readonly string[],
): string {
  const actual = litres(actualQuantityLitres);
  if (actual.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', 'Actual delivery quantity cannot be negative');
  }
  let allocated = decimal('0');
  for (const allocation of allocations) {
    const quantity = litres(allocation);
    if (!quantity.value.gt(0)) {
      throw new AppError('VALIDATION_FAILED', 'Delivery allocation quantity must be positive');
    }
    allocated = allocated.add(quantity);
  }
  if (allocated.value.gt(actual.value)) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Delivery allocations cannot exceed the actual quantity received',
    );
  }
  return allocated.toString();
}

export function assertWithinTankCapacity(physicalLitres: string, capacityLitres: string): void {
  const physical = litres(physicalLitres);
  const capacity = litres(capacityLitres);
  if (physical.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', 'Physical tank litres cannot be negative');
  }
  if (physical.value.gt(capacity.value)) {
    throw new AppError('INVARIANT_VIOLATION', 'Physical tank litres exceed tank capacity');
  }
}

export function deriveExpectedTankStock(
  openingBalanceLitres: string | undefined,
  movements: readonly StockMovement[],
): string {
  let expected: ExactDecimal = litres(openingBalanceLitres ?? '0');
  if (expected.value.isNegative()) {
    throw new AppError('INVARIANT_VIOLATION', 'Opening stock cannot be negative');
  }
  for (const movement of movements) {
    const signedQuantity = validateMovementQuantity(movement.movementType, movement.quantityLitres);
    expected = expected.add(litres(signedQuantity));
    if (expected.value.isNegative()) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'The inventory movement would create negative stock',
      );
    }
  }
  return expected.toString();
}

export type TimedStockMovement = StockMovement & Readonly<{ effectiveAt: Date }>;

/**
 * Replays the tank's movements in time order with the new one merged in and refuses it if stock
 * would drop below zero, or (for stock coming in) rise above the tank's capacity, at that point
 * or any later one. The running total alone is not enough: a delivery dated too late, or an issue
 * dated before a delivery, leaves a correct total but an impossible history that blocks every
 * later entry. Points before the new movement are not judged, so older data cannot freeze a tank.
 */
export function assertMovementFitsTank(
  existing: readonly TimedStockMovement[],
  added: TimedStockMovement,
  capacityLitres: string,
): void {
  const addedQuantity = litres(validateMovementQuantity(added.movementType, added.quantityLitres));
  const capacity = litres(capacityLitres);
  let running: ExactDecimal = litres('0');
  const later: ExactDecimal[] = [];
  for (const movement of existing) {
    const quantity = litres(
      validateMovementQuantity(movement.movementType, movement.quantityLitres),
    );
    if (movement.effectiveAt <= added.effectiveAt) running = running.add(quantity);
    else later.push(quantity);
  }
  for (const quantity of [addedQuantity, ...later]) {
    running = running.add(quantity);
    if (running.value.isNegative()) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'That would create negative stock: the tank would hold less than zero litres at the date and time entered. Check the litres and the date and time.',
      );
    }
    if (addedQuantity.value.gt(0) && running.value.gt(capacity.value)) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        `That would put more fuel in the tank than it can hold (${capacity.toString()} L). Check the litres and the date and time.`,
      );
    }
  }
}

export function calculateTankStockVariance(physicalLitres: string, expectedLitres: string): string {
  const physical = litres(physicalLitres);
  const expected = litres(expectedLitres);
  if (physical.value.isNegative() || expected.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', 'Stock values cannot be negative');
  }
  return physical.subtract(expected).toString();
}

export function requireAdjustmentReason(reason: string | undefined): string {
  if (!reason || reason.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 'Inventory adjustments require a reason');
  }
  return reason.trim();
}
