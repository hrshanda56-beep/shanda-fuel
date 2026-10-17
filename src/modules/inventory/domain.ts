import { AppError } from '../../platform/errors';
import { DECIMAL_POLICIES, ExactDecimal, litres } from '../../platform/domain/primitives';

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

export const DELIVERY_RECEIPT_KINDS = ['FULL', 'PARTIAL', 'EXCESS'] as const;
export type DeliveryReceiptKind = (typeof DELIVERY_RECEIPT_KINDS)[number];

/**
 * A calibration point is an observation from an approved tank chart. It is
 * deliberately separate from a dip and never changes book inventory by
 * itself.
 */
export type TankCalibrationPoint = Readonly<{
  measurementValue: string;
  litres: string;
  measurementUnit?: string;
}>;

export const DELIVERY_RECEIPT_STATES = [
  'DRAFT',
  'ARRIVED',
  'VERIFICATION',
  'OFFLOADING',
  'OFFLOADING_INTERRUPTED',
  'RECEIVED_PENDING_CONFIRMATION',
  'CONFIRMED',
  'POSTED',
  'REJECTED',
  'CANCELLED',
] as const;

export type DeliveryReceiptState = (typeof DELIVERY_RECEIPT_STATES)[number];

export type DeliveryReceiptCommand =
  | 'RecordArrival'
  | 'StartVerification'
  | 'BeginOffloading'
  | 'InterruptOffloading'
  | 'ResumeOffloading'
  | 'FinishPartialReceipt'
  | 'ConfirmReceipt'
  | 'PostDelivery'
  | 'RejectDelivery'
  | 'CancelDelivery';

type CalibrationPointValue = Readonly<{
  measurementValue: ExactDecimal;
  litres: ExactDecimal;
  measurementUnit?: string;
}>;

const calibrationMeasurementPolicy = {
  name: 'Calibration measurement',
  precision: 18,
  scale: 3,
} as const;

const nonNegativeDecimalText = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function calibrationDecimal(value: string, label: string): ExactDecimal {
  if (!nonNegativeDecimalText.test(value)) {
    throw new AppError('VALIDATION_FAILED', `${label} must be a non-negative decimal string`);
  }
  try {
    return new ExactDecimal(value, calibrationMeasurementPolicy);
  } catch {
    throw new AppError(
      'VALIDATION_FAILED',
      `${label} is outside the supported calibration precision`,
    );
  }
}

function calibrationPointValues(point: TankCalibrationPoint): CalibrationPointValue {
  const measurementValue = calibrationDecimal(point.measurementValue, 'Calibration measurement');
  const litresValue = calibrationDecimal(point.litres, 'Calibration litres');
  const measurementUnit = point.measurementUnit?.trim();
  if (point.measurementUnit !== undefined && !measurementUnit) {
    throw new AppError('VALIDATION_FAILED', 'Calibration measurement unit cannot be empty');
  }
  return {
    measurementValue,
    litres: litresValue,
    ...(measurementUnit ? { measurementUnit } : {}),
  };
}

function normalizedCalibrationPoint(point: CalibrationPointValue): TankCalibrationPoint {
  return {
    measurementValue: point.measurementValue.toString(),
    litres: point.litres.toString(),
    ...(point.measurementUnit ? { measurementUnit: point.measurementUnit } : {}),
  };
}

/**
 * Validates and returns a deterministic measurement-ascending calibration
 * chart. A chart must be monotonic and use one measurement unit; interpolation
 * never extrapolates beyond its first and last approved points.
 */
export function validateCalibrationPoints(
  points: readonly TankCalibrationPoint[],
): readonly TankCalibrationPoint[] {
  if (points.length < 2) {
    throw new AppError('VALIDATION_FAILED', 'At least two calibration points are required');
  }

  const values = points.map(calibrationPointValues);
  const units = new Set(values.map((point) => point.measurementUnit));
  if (units.size > 1) {
    throw new AppError('VALIDATION_FAILED', 'Calibration points must use one measurement unit');
  }

  const sorted = [...values].sort((left, right) =>
    left.measurementValue.value.cmp(right.measurementValue.value),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (current.measurementValue.equals(previous.measurementValue)) {
      throw new AppError('INVARIANT_VIOLATION', 'Calibration measurement values must be unique');
    }
    if (current.litres.value.lt(previous.litres.value)) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Calibration litres must be monotonic with measurement value',
      );
    }
  }

  return sorted.map(normalizedCalibrationPoint);
}

function interpolateValidatedCalibration(
  measurementValue: ExactDecimal,
  points: readonly TankCalibrationPoint[],
): string {
  const parsed = points.map(calibrationPointValues);
  const first = parsed[0]!;
  const last = parsed[parsed.length - 1]!;
  if (
    measurementValue.value.lt(first.measurementValue.value) ||
    measurementValue.value.gt(last.measurementValue.value)
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The calibration measurement is outside the approved chart range',
    );
  }

  for (const point of parsed) {
    if (measurementValue.equals(point.measurementValue)) return point.litres.toString();
  }

  const upperIndex = parsed.findIndex((point) =>
    measurementValue.value.lt(point.measurementValue.value),
  );
  if (upperIndex <= 0) {
    throw new AppError('INVARIANT_VIOLATION', 'Calibration interpolation neighbours are invalid');
  }
  const lower = parsed[upperIndex - 1]!;
  const upper = parsed[upperIndex]!;
  const fraction = measurementValue.value
    .sub(lower.measurementValue.value)
    .div(upper.measurementValue.value.sub(lower.measurementValue.value));
  const interpolated = lower.litres.value.add(
    upper.litres.value.sub(lower.litres.value).mul(fraction),
  );

  // The interpolation is calculated at Decimal precision, then explicitly
  // quantized to the NUMERIC(18,3) authoritative litre boundary.
  return new ExactDecimal(interpolated.toFixed()).quantize(DECIMAL_POLICIES.litres).toString();
}

/** Converts a raw tank-chart measurement to litres using exact decimal math. */
export function interpolateCalibrationLitres(
  measurementValue: string,
  points: readonly TankCalibrationPoint[],
): string {
  const measurement = calibrationDecimal(measurementValue, 'Calibration measurement');
  const validated = validateCalibrationPoints(points);
  return interpolateValidatedCalibration(measurement, validated);
}

/**
 * Converts a raw measurement only when the chart unit is explicitly the same
 * as the captured unit. This prevents a chart in millimetres being applied to
 * a dip recorded in a different unit by accident.
 */
export function convertCalibratedMeasurementToLitres(
  measurementValue: string,
  measurementUnit: string,
  points: readonly TankCalibrationPoint[],
): string {
  const unit = measurementUnit.trim();
  if (!unit) throw new AppError('VALIDATION_FAILED', 'Calibration measurement unit is required');
  const validated = validateCalibrationPoints(points);
  const chartUnit = validated[0]?.measurementUnit;
  if (!chartUnit || chartUnit !== unit) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The captured measurement unit does not match the approved calibration chart',
    );
  }
  return interpolateValidatedCalibration(
    calibrationDecimal(measurementValue, 'Calibration measurement'),
    validated,
  );
}

const deliveryReceiptTransitions: Readonly<
  Record<DeliveryReceiptState, Partial<Record<DeliveryReceiptCommand, DeliveryReceiptState>>>
> = {
  DRAFT: { RecordArrival: 'ARRIVED', CancelDelivery: 'CANCELLED' },
  ARRIVED: {
    StartVerification: 'VERIFICATION',
    RejectDelivery: 'REJECTED',
    CancelDelivery: 'CANCELLED',
  },
  VERIFICATION: {
    BeginOffloading: 'OFFLOADING',
    RejectDelivery: 'REJECTED',
    CancelDelivery: 'CANCELLED',
  },
  OFFLOADING: {
    InterruptOffloading: 'OFFLOADING_INTERRUPTED',
    FinishPartialReceipt: 'RECEIVED_PENDING_CONFIRMATION',
  },
  OFFLOADING_INTERRUPTED: {
    ResumeOffloading: 'OFFLOADING',
    FinishPartialReceipt: 'RECEIVED_PENDING_CONFIRMATION',
  },
  RECEIVED_PENDING_CONFIRMATION: { ConfirmReceipt: 'CONFIRMED' },
  CONFIRMED: { PostDelivery: 'POSTED' },
  POSTED: {},
  REJECTED: {},
  CANCELLED: {},
};

/** Enforces named delivery transitions, including interrupted offloading. */
export function transitionDeliveryReceiptState(
  state: DeliveryReceiptState,
  command: DeliveryReceiptCommand,
): DeliveryReceiptState {
  const next = deliveryReceiptTransitions[state][command];
  if (!next) {
    throw new AppError('CONFLICT', `Delivery command ${command} is not valid from state ${state}`);
  }
  return next;
}

export type PartialDeliveryReceiptProgress = Readonly<{
  previouslyAcceptedLitres: string;
  newlyAcceptedLitres: string;
  acceptedLitres: string;
  remainingToNoteLitres: string;
  shortageExcessLitres: string;
  isPartial: boolean;
}>;

/**
 * Adds an interrupted receipt to its prior accepted quantity. The delivery
 * note is a commercial comparison only: accepted physical litres may be below
 * or above it, and are never capped by the supplier's note quantity.
 */
export function calculatePartialDeliveryReceipt(input: {
  deliveryNoteQuantityLitres: string;
  previouslyAcceptedLitres: string;
  newlyAcceptedLitres: string;
  isFinal: boolean;
}): PartialDeliveryReceiptProgress {
  const note = litres(input.deliveryNoteQuantityLitres);
  const previous = litres(input.previouslyAcceptedLitres);
  const newlyAccepted = litres(input.newlyAcceptedLitres);
  if (note.value.isNegative() || previous.value.isNegative() || newlyAccepted.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', 'Delivery receipt quantities cannot be negative');
  }
  if (newlyAccepted.value.isZero()) {
    throw new AppError('VALIDATION_FAILED', 'A receipt step must accept at least one litre');
  }

  const accepted = previous.add(newlyAccepted);
  const remaining = note.subtract(accepted);
  const remainingToNote = remaining.value.isPositive() ? remaining : litres('0');
  return {
    previouslyAcceptedLitres: previous.toString(),
    newlyAcceptedLitres: newlyAccepted.toString(),
    acceptedLitres: accepted.toString(),
    remainingToNoteLitres: remainingToNote.toString(),
    shortageExcessLitres: accepted.subtract(note).toString(),
    isPartial: !input.isFinal,
  };
}

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
  if (positiveMovementTypes.has(movementType) && !quantity.value.isPositive()) {
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

/**
 * Classifies the accepted physical receipt against the supplier note without
 * changing either quantity. The note is a commercial comparison; accepted
 * litres remain the physical inventory authority.
 */
export function classifyDeliveryReceipt(
  noteQuantityLitres: string,
  actualQuantityLitres: string,
): DeliveryReceiptKind {
  const note = litres(noteQuantityLitres);
  const actual = litres(actualQuantityLitres);
  if (note.value.isNegative() || actual.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', 'Delivery quantities cannot be negative');
  }
  if (actual.value.lt(note.value)) return 'PARTIAL';
  if (actual.value.gt(note.value)) return 'EXCESS';
  return 'FULL';
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
    if (!quantity.value.isPositive()) {
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
