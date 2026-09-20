import { AppError } from '../../platform/errors';
import {
  DECIMAL_POLICIES,
  ExactDecimal,
  businessDate,
  litres,
  money,
  unitPrice,
  type BusinessDate,
  type CurrencyCode,
  type Litres,
  type Money,
  type UnitPrice,
} from '../../platform/domain/primitives';

export type StationBusinessDayState =
  'NOT_STARTED' | 'OPEN' | 'OPERATIONS_COMPLETE' | 'CLOSED' | 'EXCEPTIONALLY_CLOSED';
export type ShiftState =
  | 'PLANNED'
  | 'OPEN'
  | 'METER_CLOSED'
  | 'COMPLETED'
  | 'NOT_OPERATED'
  | 'CANCELLED_BEFORE_START'
  | 'EXCEPTIONALLY_CLOSED';
export type BoundaryReason =
  | 'SHIFT_OPEN'
  | 'SHIFT_CLOSE'
  | 'ATTENDANT_HANDOVER'
  | 'PRICE_CHANGE'
  | 'DELIVERY'
  | 'METER_RESET'
  | 'REPLACEMENT'
  | 'CORRECTION';
export type MeterReading =
  { status: 'AVAILABLE'; value: string } | { status: 'UNAVAILABLE'; reason: string };

export type StationBusinessDay = {
  id: string;
  tenantId: string;
  stationId: string;
  date: BusinessDate;
  state: StationBusinessDayState;
  version: number;
};
export type Shift = {
  id: string;
  tenantId: string;
  stationId: string;
  businessDayId: string;
  state: ShiftState;
  plannedStartAt: string;
  plannedEndAt: string;
  businessDate: BusinessDate;
  version: number;
};
export type MeterBoundary = {
  id: string;
  tenantId: string;
  stationId: string;
  nozzleId: string;
  meterInstallationId: string;
  businessDayId: string;
  shiftId: string;
  reason: BoundaryReason;
  reading: MeterReading;
  effectiveAt: string;
  confirmedAt: string;
  confirmedBy: string;
  enteredBy: string;
  onBehalfOf?: string;
  exceptionReason?: string;
};
export type MeterInstallation = {
  id: string;
  tenantId: string;
  stationId: string;
  nozzleId: string;
  meterId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  installedBy: string;
};
export type MeterSegment = {
  id: string;
  tenantId: string;
  stationId: string;
  nozzleId: string;
  meterInstallationId: string;
  businessDayId: string;
  shiftId: string;
  openingBoundaryId: string;
  closingBoundaryId: string;
  productId: string;
  attendantId: string;
  enteredBy: string;
  onBehalfOf?: string;
  openingReading: string;
  closingReading: string;
  litres: Litres;
  unitPrice: UnitPrice;
  currency: CurrencyCode;
  expectedSaleValue: Money;
  boundaryReason: BoundaryReason;
  startAt: string;
  endAt: string;
  sealedAt: string;
  controlledException: boolean;
};
export type SellingPrice = {
  id: string;
  tenantId: string;
  stationId: string;
  productId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  unitPrice: UnitPrice;
  currency: CurrencyCode;
  state:
    | 'DRAFT'
    | 'PENDING_APPROVAL'
    | 'APPROVED'
    | 'SCHEDULED'
    | 'PENDING_STATION_ACTIVATION'
    | 'BOUNDARIES_IN_PROGRESS'
    | 'ACTIVE'
    | 'FAILED_ACTIVATION'
    | 'CANCELLED';
};
export type MeterSegmentInput = {
  id: string;
  tenantId: string;
  stationId: string;
  nozzleId: string;
  meterInstallationId: string;
  businessDayId: string;
  shiftId: string;
  openingBoundary: MeterBoundary;
  closingBoundary: MeterBoundary;
  productId: string;
  attendantId: string;
  enteredBy: string;
  onBehalfOf?: string;
  unitPrice: string;
  currency?: CurrencyCode;
  startAt: string;
  endAt: string;
  sealedAt: string;
  controlledQuantityLitres?: string;
};

export function newBusinessDay(input: {
  id: string;
  tenantId: string;
  stationId: string;
  date: string;
}): StationBusinessDay {
  return { ...input, date: businessDate(input.date), state: 'NOT_STARTED', version: 0 };
}
export function openBusinessDay(day: StationBusinessDay): StationBusinessDay {
  assertState(day.state, 'NOT_STARTED', 'OpenBusinessDay');
  return { ...day, state: 'OPEN', version: day.version + 1 };
}
export function markOperationsComplete(day: StationBusinessDay): StationBusinessDay {
  assertState(day.state, 'OPEN', 'MarkOperationsComplete');
  return { ...day, state: 'OPERATIONS_COMPLETE', version: day.version + 1 };
}
export function finalizeBusinessDay(day: StationBusinessDay): StationBusinessDay {
  assertState(day.state, 'OPERATIONS_COMPLETE', 'FinalizeOperations');
  return { ...day, state: 'CLOSED', version: day.version + 1 };
}
export function exceptionallyCloseBusinessDay(
  day: StationBusinessDay,
  reason: string,
): StationBusinessDay {
  requireReason(reason, 'ExceptionalCloseBusinessDay');
  if (day.state === 'CLOSED' || day.state === 'EXCEPTIONALLY_CLOSED')
    throw invalidTransition('ExceptionalCloseBusinessDay', day.state);
  return { ...day, state: 'EXCEPTIONALLY_CLOSED', version: day.version + 1 };
}

export function startShift(shift: Shift, day: StationBusinessDay): Shift {
  assertState(day.state, 'OPEN', 'StartShift');
  assertState(shift.state, 'PLANNED', 'StartShift');
  if (shift.businessDayId !== day.id || shift.businessDate !== day.date)
    throw new AppError('INVARIANT_VIOLATION', 'A shift must belong to its station business date');
  return { ...shift, state: 'OPEN', version: shift.version + 1 };
}
export function closeMeters(shift: Shift): Shift {
  assertState(shift.state, 'OPEN', 'CloseMeters');
  return { ...shift, state: 'METER_CLOSED', version: shift.version + 1 };
}
export function completeShift(shift: Shift): Shift {
  assertState(shift.state, 'METER_CLOSED', 'CompleteShift');
  return { ...shift, state: 'COMPLETED', version: shift.version + 1 };
}
export function markNotOperated(shift: Shift, reason: string): Shift {
  requireReason(reason, 'MarkNotOperated');
  assertState(shift.state, 'PLANNED', 'MarkNotOperated');
  return { ...shift, state: 'NOT_OPERATED', version: shift.version + 1 };
}
export function cancelBeforeStart(shift: Shift, reason: string): Shift {
  requireReason(reason, 'CancelBeforeStart');
  assertState(shift.state, 'PLANNED', 'CancelBeforeStart');
  return { ...shift, state: 'CANCELLED_BEFORE_START', version: shift.version + 1 };
}
export function exceptionallyCloseShift(shift: Shift, reason: string): Shift {
  requireReason(reason, 'ExceptionalClose');
  if (shift.state !== 'OPEN' && shift.state !== 'METER_CLOSED')
    throw invalidTransition('ExceptionalClose', shift.state);
  return { ...shift, state: 'EXCEPTIONALLY_CLOSED', version: shift.version + 1 };
}

export function resolveOpeningReading(input: {
  submitted?: MeterReading;
  priorSealed?: MeterReading;
  exceptionReason?: string;
}): MeterReading {
  if (input.priorSealed?.status === 'AVAILABLE') {
    if (!input.submitted || input.submitted.status !== 'AVAILABLE') return input.priorSealed;
    if (new ExactDecimal(input.submitted.value).equals(new ExactDecimal(input.priorSealed.value)))
      return input.priorSealed;
    throw new AppError(
      'CONFLICT',
      'Opening meter must inherit the prior sealed reading; use a controlled correction or replacement path',
    );
  }
  if (!input.submitted || input.submitted.status !== 'AVAILABLE')
    throw new AppError(
      'VALIDATION_FAILED',
      'An opening meter is unavailable and requires a controlled exception reading',
    );
  requireReason(input.exceptionReason, 'ConfirmBoundary');
  return input.submitted;
}

export function confirmBoundary(input: {
  id: string;
  tenantId: string;
  stationId: string;
  nozzleId: string;
  meterInstallationId: string;
  businessDayId: string;
  shiftId: string;
  reason: BoundaryReason;
  reading: MeterReading;
  priorSealedReading?: MeterReading;
  effectiveAt: string;
  confirmedAt: string;
  confirmedBy: string;
  enteredBy: string;
  onBehalfOf?: string;
  exceptionReason?: string;
}): MeterBoundary {
  if (input.reading.status === 'AVAILABLE') validateReading(input.reading.value);
  const reading =
    input.reason === 'SHIFT_OPEN'
      ? resolveOpeningReading({
          submitted: input.reading,
          priorSealed: input.priorSealedReading,
          exceptionReason: input.exceptionReason,
        })
      : input.reading;
  if (reading.status === 'UNAVAILABLE') requireReason(reading.reason, 'ConfirmBoundary');
  if (input.onBehalfOf && input.onBehalfOf === input.confirmedBy)
    throw new AppError(
      'VALIDATION_FAILED',
      'On-behalf-of attendant cannot equal the entering actor',
    );
  return { ...input, reading, exceptionReason: input.exceptionReason };
}

export function confirmAttendantHandover(input: {
  id: string;
  priorBoundary: MeterBoundary;
  tenantId: string;
  stationId: string;
  nozzleId: string;
  meterInstallationId: string;
  businessDayId: string;
  shiftId: string;
  newAttendantId: string;
  enteredBy: string;
  effectiveAt: string;
  confirmedAt: string;
  onBehalfOf?: string;
}): MeterBoundary {
  if (input.priorBoundary.reading.status !== 'AVAILABLE')
    throw new AppError(
      'VALIDATION_FAILED',
      'Attendant handover requires a confirmed available meter reading',
    );
  return confirmBoundary({
    id: input.id,
    tenantId: input.tenantId,
    stationId: input.stationId,
    nozzleId: input.nozzleId,
    meterInstallationId: input.meterInstallationId,
    businessDayId: input.businessDayId,
    shiftId: input.shiftId,
    reason: 'ATTENDANT_HANDOVER',
    reading: input.priorBoundary.reading,
    priorSealedReading: input.priorBoundary.reading,
    effectiveAt: input.effectiveAt,
    confirmedAt: input.confirmedAt,
    confirmedBy: input.enteredBy,
    enteredBy: input.enteredBy,
    onBehalfOf: input.onBehalfOf,
  });
}

export function replaceMeterInstallation(
  input: MeterInstallation,
  effectiveTo: string,
  reason: string,
): MeterInstallation {
  requireReason(reason, 'ReplaceMeter');
  if (Date.parse(effectiveTo) <= Date.parse(input.effectiveFrom))
    throw new AppError(
      'VALIDATION_FAILED',
      'Meter replacement must end the prior installation after it starts',
    );
  return { ...input, effectiveTo };
}

export function sealMeterSegment(input: MeterSegmentInput): MeterSegment {
  const { openingBoundary, closingBoundary } = input;
  if (
    openingBoundary.tenantId !== closingBoundary.tenantId ||
    openingBoundary.tenantId !== input.tenantId
  )
    throw new AppError('FORBIDDEN', 'Meter boundaries must belong to the same tenant');
  if (
    openingBoundary.nozzleId !== input.nozzleId ||
    closingBoundary.nozzleId !== input.nozzleId ||
    openingBoundary.meterInstallationId !== input.meterInstallationId ||
    closingBoundary.meterInstallationId !== input.meterInstallationId
  )
    throw new AppError('INVARIANT_VIOLATION', 'Meter boundaries must use one nozzle installation');
  if (openingBoundary.reason === 'SHIFT_CLOSE')
    throw new AppError(
      'VALIDATION_FAILED',
      'A shift-close boundary cannot be the opening of a segment',
    );
  if (
    closingBoundary.reading.status !== 'AVAILABLE' ||
    openingBoundary.reading.status !== 'AVAILABLE'
  )
    throw new AppError(
      'VALIDATION_FAILED',
      'Unavailable meter readings require an approved exception path',
    );
  const opening = new ExactDecimal(openingBoundary.reading.value);
  const closing = new ExactDecimal(closingBoundary.reading.value);
  const lowerReading = closing.value.lt(opening.value);
  const controlledException = lowerReading || Boolean(input.controlledQuantityLitres);
  let quantity: Litres;
  if (lowerReading) {
    if (!['METER_RESET', 'REPLACEMENT', 'CORRECTION'].includes(closingBoundary.reason))
      throw new AppError(
        'INVARIANT_VIOLATION',
        'A lower closing reading requires reset, replacement, or correction',
      );
    if (!input.controlledQuantityLitres)
      throw new AppError(
        'VALIDATION_FAILED',
        'A controlled lower reading requires an explicit quantity',
      );
    quantity = litres(input.controlledQuantityLitres);
  } else quantity = litres(closing.subtract(opening).value.toFixed(3));
  if (quantity.value.isNegative())
    throw new AppError('VALIDATION_FAILED', 'Meter-derived litres cannot be negative');
  const price = unitPrice(input.unitPrice);
  const expectedAmount = quantity.multiply(price).quantize(DECIMAL_POLICIES.money).toString();
  return {
    id: input.id,
    tenantId: input.tenantId,
    stationId: input.stationId,
    nozzleId: input.nozzleId,
    meterInstallationId: input.meterInstallationId,
    businessDayId: input.businessDayId,
    shiftId: input.shiftId,
    openingBoundaryId: openingBoundary.id,
    closingBoundaryId: closingBoundary.id,
    productId: input.productId,
    attendantId: input.attendantId,
    enteredBy: input.enteredBy,
    onBehalfOf: input.onBehalfOf,
    openingReading: openingBoundary.reading.value,
    closingReading: closingBoundary.reading.value,
    litres: quantity,
    unitPrice: price,
    currency: input.currency ?? 'USD',
    expectedSaleValue: money(expectedAmount, input.currency ?? 'USD'),
    boundaryReason: closingBoundary.reason,
    startAt: input.startAt,
    endAt: input.endAt,
    sealedAt: input.sealedAt,
    controlledException,
  };
}

export function assertNoOverlappingOperationalSegments(
  existing: readonly MeterSegment[],
  candidate: MeterSegment,
): void {
  const start = Date.parse(candidate.startAt);
  const end = Date.parse(candidate.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new AppError(
      'VALIDATION_FAILED',
      'A meter segment must have a valid positive time range',
    );
  const conflict = existing
    .filter((segment) => segment.id !== candidate.id && segment.nozzleId === candidate.nozzleId)
    .filter((segment) => Date.parse(segment.startAt) < end && start < Date.parse(segment.endAt))
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (conflict)
    throw new AppError(
      'CONFLICT',
      'The nozzle already has an overlapping active operational segment',
      { conflictingSegmentId: conflict.id, nozzleId: candidate.nozzleId },
    );
}

export function activatePriceChange(price: SellingPrice, boundaryComplete: boolean): SellingPrice {
  if (price.state !== 'PENDING_STATION_ACTIVATION' && price.state !== 'BOUNDARIES_IN_PROGRESS')
    throw invalidTransition('ActivatePriceChange', price.state);
  if (!boundaryComplete)
    throw new AppError(
      'CONFLICT',
      'All affected nozzle boundaries must be sealed before price activation',
    );
  return { ...price, state: 'ACTIVE' };
}
export function requestPriceChange(price: SellingPrice): SellingPrice {
  if (price.state !== 'DRAFT') throw invalidTransition('RequestPriceChange', price.state);
  return { ...price, state: 'PENDING_APPROVAL' };
}
export function approvePriceChange(
  price: SellingPrice,
  approverId: string,
  requestedBy: string,
): SellingPrice {
  if (price.state !== 'PENDING_APPROVAL')
    throw invalidTransition('ApprovePriceChange', price.state);
  if (approverId === requestedBy)
    throw new AppError('FORBIDDEN', 'A price change cannot be approved by its requester');
  return { ...price, state: 'APPROVED' };
}
function assertState(actual: string, expected: string, command: string): void {
  if (actual !== expected) throw invalidTransition(command, actual, expected);
}
function invalidTransition(command: string, actual: string, expected?: string): AppError {
  return new AppError(
    'CONFLICT',
    `${command} is not allowed from ${actual}${expected ? `; expected ${expected}` : ''}`,
  );
}
function requireReason(reason: string | undefined, command: string): void {
  if (!reason?.trim()) throw new AppError('VALIDATION_FAILED', `${command} requires a reason`);
}
function validateReading(value: string): void {
  const reading = new ExactDecimal(value);
  if (reading.value.isNegative())
    throw new AppError('VALIDATION_FAILED', 'Meter readings cannot be negative');
}

export type ReconciliationPaymentCategory =
  'CASH' | 'ELECTRONIC' | 'CUSTOMER_ACCOUNT' | 'PREPAID' | 'BENEFIT_INTERNAL' | 'OTHER';
export type PaymentDeclaration = {
  id: string;
  category: ReconciliationPaymentCategory;
  amount: Money;
  declaredBy: string;
  reason?: string;
};
export type ReconciliationState =
  | 'DRAFT'
  | 'READY'
  | 'SUBMITTED'
  | 'PENDING_APPROVAL'
  | 'RETURNED'
  | 'REJECTED'
  | 'APPROVED'
  | 'POSTED'
  | 'LOCKED';
export type VarianceClassification = 'INFORMATIONAL' | 'REQUIRES_EXPLANATION' | 'BLOCKING';
export type ReconciliationPolicy = {
  warningThreshold: string;
  blockingThreshold: string;
  currency?: CurrencyCode;
};
export type ReconciliationRevision = {
  id: string;
  reconciliationId: string;
  revision: number;
  tenantId: string;
  stationId: string;
  businessDayId: string;
  state: ReconciliationState;
  expectedSales: Money;
  declarations: readonly PaymentDeclaration[];
  accountedSales: Money;
  variance: Money;
  varianceClassification: VarianceClassification;
  varianceExplanation?: string;
  submittedBy?: string;
  approvedBy?: string;
  postedAt?: string;
  lockedAt?: string;
};

export function calculateExpectedSales(
  segments: readonly MeterSegment[],
  currency: CurrencyCode = 'USD',
): Money {
  let total = new ExactDecimal('0');
  for (const segment of segments) {
    if (segment.currency !== currency)
      throw new AppError('VALIDATION_FAILED', 'All segments must use one currency');
    total = total.add(segment.expectedSaleValue.amount);
  }
  return money(total.quantize(DECIMAL_POLICIES.money).toString(), currency);
}
export function calculateReconciliation(input: {
  id: string;
  reconciliationId: string;
  revision: number;
  tenantId: string;
  stationId: string;
  businessDayId: string;
  segments: readonly MeterSegment[];
  declarations: readonly PaymentDeclaration[];
  policy: ReconciliationPolicy;
}): ReconciliationRevision {
  const currency = input.policy.currency ?? input.segments[0]?.currency ?? 'USD';
  const expectedSales = calculateExpectedSales(input.segments, currency);
  let accounted = new ExactDecimal('0');
  for (const declaration of input.declarations) {
    if (declaration.amount.currency !== currency)
      throw new AppError(
        'VALIDATION_FAILED',
        'Declaration currency must match the station currency',
      );
    accounted = accounted.add(declaration.amount.amount);
  }
  const accountedSales = money(accounted.quantize(DECIMAL_POLICIES.money).toString(), currency);
  const variance = money(
    accountedSales.amount
      .subtract(expectedSales.amount)
      .quantize(DECIMAL_POLICIES.money)
      .toString(),
    currency,
  );
  const absoluteVariance = variance.amount.value.abs();
  const warning = new ExactDecimal(input.policy.warningThreshold);
  const blocking = new ExactDecimal(input.policy.blockingThreshold);
  const varianceClassification: VarianceClassification = absoluteVariance.gte(blocking.value)
    ? 'BLOCKING'
    : absoluteVariance.gte(warning.value)
      ? 'REQUIRES_EXPLANATION'
      : 'INFORMATIONAL';
  return {
    id: input.id,
    reconciliationId: input.reconciliationId,
    revision: input.revision,
    tenantId: input.tenantId,
    stationId: input.stationId,
    businessDayId: input.businessDayId,
    state: 'READY',
    expectedSales,
    declarations: input.declarations.map((declaration) => ({ ...declaration })),
    accountedSales,
    variance,
    varianceClassification,
  };
}
export function submitReconciliation(
  revision: ReconciliationRevision,
  submittedBy: string,
  explanation?: string,
): ReconciliationRevision {
  if (revision.state !== 'READY' && revision.state !== 'RETURNED')
    throw invalidTransition('SubmitReconciliation', revision.state);
  if (revision.varianceClassification !== 'INFORMATIONAL' && !explanation?.trim())
    throw new AppError('VALIDATION_FAILED', 'A variance explanation is required before submission');
  return {
    ...revision,
    state: 'SUBMITTED',
    submittedBy,
    varianceExplanation: explanation?.trim(),
  };
}
export function requestReconciliationApproval(
  revision: ReconciliationRevision,
): ReconciliationRevision {
  assertState(revision.state, 'SUBMITTED', 'CreateApprovalRequest');
  return { ...revision, state: 'PENDING_APPROVAL' };
}
export function returnReconciliation(
  revision: ReconciliationRevision,
  reason: string,
): ReconciliationRevision {
  requireReason(reason, 'ReturnReconciliation');
  assertState(revision.state, 'PENDING_APPROVAL', 'ReturnReconciliation');
  return { ...revision, state: 'RETURNED', varianceExplanation: reason.trim() };
}
export function rejectReconciliation(
  revision: ReconciliationRevision,
  reason: string,
): ReconciliationRevision {
  requireReason(reason, 'RejectReconciliation');
  assertState(revision.state, 'PENDING_APPROVAL', 'RejectReconciliation');
  return { ...revision, state: 'REJECTED', varianceExplanation: reason.trim() };
}
export function approveReconciliation(
  revision: ReconciliationRevision,
  approverId: string,
): ReconciliationRevision {
  assertState(revision.state, 'PENDING_APPROVAL', 'ApproveReconciliation');
  if (revision.submittedBy === approverId)
    throw new AppError('FORBIDDEN', 'A reconciliation cannot be approved by its submitting actor');
  return { ...revision, state: 'APPROVED', approvedBy: approverId };
}
export function postReconciliation(
  revision: ReconciliationRevision,
  postedAt: string,
): ReconciliationRevision {
  assertState(revision.state, 'APPROVED', 'PostReconciliation');
  return { ...revision, state: 'POSTED', postedAt };
}
export function lockReconciliation(
  revision: ReconciliationRevision,
  lockedAt: string,
): ReconciliationRevision {
  assertState(revision.state, 'POSTED', 'LockReconciliation');
  return { ...revision, state: 'LOCKED', lockedAt };
}
