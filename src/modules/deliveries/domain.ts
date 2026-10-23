import { AppError } from '../../platform/errors';
import { ExactDecimal, litres } from '../../platform/domain/primitives';

/**
 * Pure delivery-detail rules. Litres are exact decimal strings (3 dp), never floats.
 * Nothing here touches the database.
 */

export type DeliveryReceiptKind = 'FULL' | 'PARTIAL' | 'EXCESS';
export type CompartmentVarianceKind = 'OK' | 'SHORT' | 'OVER';

export type CompartmentSealInput = Readonly<{ sealNumber: string; intact: boolean }>;

export type CompartmentInput = Readonly<{
  compartmentNumber: number;
  productId: string;
  noteLitres: string;
  receivedLitres: string;
  seals: readonly CompartmentSealInput[];
}>;

export type CheckedCompartment = Readonly<{
  compartmentNumber: number;
  productId: string;
  noteLitres: string;
  receivedLitres: string;
  /** received minus note: negative is a shortage, positive an excess. */
  varianceLitres: string;
  variance: CompartmentVarianceKind;
  seals: readonly CompartmentSealInput[];
  allSealsIntact: boolean;
}>;

export type CompartmentCheck = Readonly<{
  compartments: readonly CheckedCompartment[];
  totalNoteLitres: string;
  totalReceivedLitres: string;
  shortCompartments: number;
  overCompartments: number;
  brokenSeals: number;
}>;

/**
 * Whole-delivery receipt kind. Fewer litres than the note is a partial receipt, more is an
 * excess; both are allowed and flagged, never silently corrected.
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

export function classifyCompartmentVariance(
  noteLitres: string,
  receivedLitres: string,
): CompartmentVarianceKind {
  const kind = classifyDeliveryReceipt(noteLitres, receivedLitres);
  return kind === 'PARTIAL' ? 'SHORT' : kind === 'EXCESS' ? 'OVER' : 'OK';
}

export const MAX_COMPARTMENTS = 30;
export const MAX_SEALS_PER_COMPARTMENT = 10;

function requireLitres(value: string, label: string): void {
  let parsed;
  try {
    parsed = litres(value);
  } catch {
    throw new AppError('VALIDATION_FAILED', `${label} must be a number of litres`);
  }
  if (parsed.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', `${label} cannot be negative`);
  }
}

/**
 * Checks the compartment-by-compartment record against the delivery it belongs to.
 *
 * - at least one compartment, numbered 1..30 without repeats;
 * - every compartment carries the delivery's fuel product;
 * - every seal must have a number (a seal that is listed but blank is rejected) and a seal
 *   number is not repeated inside one compartment;
 * - the compartment litres add up exactly to the delivery's litres on the note and litres
 *   received, so the delivery total and its compartments can never disagree.
 */
export function checkCompartments(input: {
  deliveryProductId: string;
  deliveryNoteLitres: string;
  deliveryReceivedLitres: string;
  compartments: readonly CompartmentInput[];
}): CompartmentCheck {
  const { compartments } = input;
  if (compartments.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Add at least one truck compartment');
  }
  if (compartments.length > MAX_COMPARTMENTS) {
    throw new AppError(
      'VALIDATION_FAILED',
      `A truck cannot have more than ${MAX_COMPARTMENTS} compartments`,
    );
  }
  const seenNumbers = new Set<number>();
  let totalNote = new ExactDecimal('0');
  let totalReceived = new ExactDecimal('0');
  let shortCompartments = 0;
  let overCompartments = 0;
  let brokenSeals = 0;
  const checked: CheckedCompartment[] = [];
  for (const compartment of [...compartments].sort(
    (a, b) => a.compartmentNumber - b.compartmentNumber,
  )) {
    const label = `Compartment ${compartment.compartmentNumber}`;
    if (
      !Number.isInteger(compartment.compartmentNumber) ||
      compartment.compartmentNumber < 1 ||
      compartment.compartmentNumber > MAX_COMPARTMENTS
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Compartment numbers must be whole numbers from 1 to ${MAX_COMPARTMENTS}`,
      );
    }
    if (seenNumbers.has(compartment.compartmentNumber)) {
      throw new AppError('VALIDATION_FAILED', `${label} is listed more than once`);
    }
    seenNumbers.add(compartment.compartmentNumber);
    if (compartment.productId !== input.deliveryProductId) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${label} must carry the same fuel as the delivery. Record a different fuel as its own delivery.`,
      );
    }
    requireLitres(compartment.noteLitres, `${label}: litres on the note`);
    requireLitres(compartment.receivedLitres, `${label}: litres received`);
    if (compartment.seals.length > MAX_SEALS_PER_COMPARTMENT) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${label} cannot have more than ${MAX_SEALS_PER_COMPARTMENT} seals`,
      );
    }
    const seenSeals = new Set<string>();
    const seals: CompartmentSealInput[] = [];
    for (const seal of compartment.seals) {
      const sealNumber = seal.sealNumber.trim();
      if (sealNumber.length === 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          `${label}: write the seal number, or remove the seal if there was none`,
        );
      }
      if (sealNumber.length > 80) {
        throw new AppError('VALIDATION_FAILED', `${label}: a seal number is too long`);
      }
      const key = sealNumber.toLowerCase();
      if (seenSeals.has(key)) {
        throw new AppError('VALIDATION_FAILED', `${label}: seal ${sealNumber} is listed twice`);
      }
      seenSeals.add(key);
      if (!seal.intact) brokenSeals += 1;
      seals.push({ sealNumber, intact: seal.intact });
    }
    const note = litres(compartment.noteLitres);
    const received = litres(compartment.receivedLitres);
    totalNote = totalNote.add(note);
    totalReceived = totalReceived.add(received);
    const variance = classifyCompartmentVariance(note.toString(), received.toString());
    if (variance === 'SHORT') shortCompartments += 1;
    if (variance === 'OVER') overCompartments += 1;
    checked.push({
      compartmentNumber: compartment.compartmentNumber,
      productId: compartment.productId,
      noteLitres: note.toString(),
      receivedLitres: received.toString(),
      varianceLitres: received.subtract(note).toString(),
      variance,
      seals,
      allSealsIntact: seals.every((seal) => seal.intact),
    });
  }
  if (!totalNote.value.eq(litres(input.deliveryNoteLitres).value)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `The compartments add up to ${totalNote.toString()} litres on the note, but the delivery note says ${litres(input.deliveryNoteLitres).toString()} litres. Check each compartment.`,
    );
  }
  if (!totalReceived.value.eq(litres(input.deliveryReceivedLitres).value)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `The compartments add up to ${totalReceived.toString()} litres received, but the delivery says ${litres(input.deliveryReceivedLitres).toString()} litres received. Check each compartment.`,
    );
  }
  return {
    compartments: checked,
    totalNoteLitres: totalNote.toString(),
    totalReceivedLitres: totalReceived.toString(),
    shortCompartments,
    overCompartments,
    brokenSeals,
  };
}

export type WaterTestResult = 'PASS' | 'FAIL';

export function checkWaterTest(input: {
  result: WaterTestResult;
  waterReadingMm?: string | null;
}): { result: WaterTestResult; waterReadingMm: string | null } {
  if (input.result !== 'PASS' && input.result !== 'FAIL') {
    throw new AppError('VALIDATION_FAILED', 'The water test must be recorded as pass or fail');
  }
  if (input.waterReadingMm === undefined || input.waterReadingMm === null) {
    return { result: input.result, waterReadingMm: null };
  }
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(input.waterReadingMm)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The water reading must be a number of millimetres, for example 0 or 2.5',
    );
  }
  return { result: input.result, waterReadingMm: input.waterReadingMm };
}

/**
 * The owner switch. When it is on, a delivery cannot be received until a water test is on
 * record. When it is off (the default) the test is recorded but never blocks anything.
 * A failed test is recorded and shown; whether to reject the fuel stays a human decision.
 */
export function assertWaterTestOnRecord(input: { required: boolean; hasWaterTest: boolean }): void {
  if (input.required && !input.hasWaterTest) {
    throw new AppError(
      'CONFLICT',
      'Record the water test for this delivery before confirming it. Your owner has asked for a water test on every delivery.',
    );
  }
}

export function checkDriverConfirmation(input: {
  driverName: string;
  confirmed: boolean;
  confirmedAt?: string | null;
  now: Date;
}): { driverName: string; confirmed: boolean; confirmedAt: Date | null } {
  const driverName = input.driverName.trim();
  if (driverName.length === 0) {
    throw new AppError('VALIDATION_FAILED', "Write the driver's name");
  }
  if (driverName.length > 120) {
    throw new AppError('VALIDATION_FAILED', "The driver's name is too long");
  }
  if (!input.confirmed) {
    return { driverName, confirmed: false, confirmedAt: null };
  }
  const confirmedAt = input.confirmedAt ? new Date(input.confirmedAt) : input.now;
  if (Number.isNaN(confirmedAt.getTime())) {
    throw new AppError('VALIDATION_FAILED', 'The time the driver confirmed is not valid');
  }
  if (confirmedAt.getTime() > input.now.getTime() + 5 * 60 * 1000) {
    throw new AppError('VALIDATION_FAILED', 'The driver confirmation time cannot be in the future');
  }
  return { driverName, confirmed: true, confirmedAt };
}
