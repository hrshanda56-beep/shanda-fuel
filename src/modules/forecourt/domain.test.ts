import { describe, expect, it } from 'vitest';
import {
  approveReconciliation,
  assertNoOverlappingOperationalSegments,
  calculateReconciliation,
  closeMeters,
  confirmBoundary,
  newBusinessDay,
  openBusinessDay,
  resolveOpeningReading,
  sealMeterSegment,
  startShift,
  submitReconciliation,
  requestReconciliationApproval,
  type MeterBoundary,
  type Shift,
} from './domain';
import { money } from '../../platform/domain/primitives';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { createTrustedActor } from './trusted-actor';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  station: '22222222-2222-4222-8222-222222222222',
  day: '33333333-3333-4333-8333-333333333333',
  shift: '44444444-4444-4444-8444-444444444444',
  nozzle: '55555555-5555-4555-8555-555555555555',
  installation: '66666666-6666-4666-8666-666666666666',
  actor: '77777777-7777-4777-8777-777777777777',
  legal: '88888888-8888-4888-8888-888888888888',
};

const trustedActor = createTrustedActor({
  transaction: createTrustedTenantTransactionContext({
    tenantId: ids.tenant,
    actorId: ids.actor,
    membershipId: ids.actor,
    requestId: '99999999-9999-4999-8999-999999999999',
  }),
  actorId: ids.actor,
  membershipId: ids.actor,
  tenantId: ids.tenant,
  stationId: ids.station,
  legalEntityId: ids.legal,
});

function boundary(id: string, reason: MeterBoundary['reason'], value: string): MeterBoundary {
  return confirmBoundary({
    id,
    tenantId: ids.tenant,
    stationId: ids.station,
    nozzleId: ids.nozzle,
    meterInstallationId: ids.installation,
    businessDayId: ids.day,
    shiftId: ids.shift,
    reason,
    reading: { status: 'AVAILABLE', value },
    effectiveAt: '2026-09-20T06:00:00.000Z',
    confirmedAt: '2026-09-20T06:00:01.000Z',
    actor: trustedActor,
    responsibleAttendantId: ids.actor,
    exceptionReason:
      reason === 'SHIFT_OPEN' ? 'Initial controlled opening position for test station' : undefined,
  });
}

function segment(closingValue = '1010.125') {
  return sealMeterSegment({
    id: '88888888-8888-4888-8888-888888888888',
    tenantId: ids.tenant,
    stationId: ids.station,
    nozzleId: ids.nozzle,
    meterInstallationId: ids.installation,
    businessDayId: ids.day,
    shiftId: ids.shift,
    openingBoundary: boundary('99999999-9999-4999-8999-999999999999', 'SHIFT_OPEN', '1000.000'),
    closingBoundary: boundary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SHIFT_CLOSE', closingValue),
    productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    attendantId: ids.actor,
    actor: trustedActor,
    unitPrice: '1.50',
    startAt: '2026-09-20T06:00:00.000Z',
    endAt: '2026-09-20T14:00:00.000Z',
    sealedAt: '2026-09-20T14:00:01.000Z',
  });
}

describe('A3 forecourt domain', () => {
  it('derives exact litres and expected sale value from sealed meter boundaries', () => {
    const result = segment();
    expect(result.litres.toString()).toBe('10.125');
    expect(result.expectedSaleValue.amount.toString()).toBe('15.1875');
  });

  it('rejects a lower meter reading unless a controlled reset path supplies quantity', () => {
    expect(() => segment('990.000')).toThrow(/lower closing reading/);
    const reset = sealMeterSegment({
      ...{
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        tenantId: ids.tenant,
        stationId: ids.station,
        nozzleId: ids.nozzle,
        meterInstallationId: ids.installation,
        businessDayId: ids.day,
        shiftId: ids.shift,
        openingBoundary: boundary('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'SHIFT_OPEN', '1000.000'),
        closingBoundary: boundary('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'METER_RESET', '10.000'),
        productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        attendantId: ids.actor,
        actor: trustedActor,
        unitPrice: '1.50',
        startAt: '2026-09-20T06:00:00.000Z',
        endAt: '2026-09-20T07:00:00.000Z',
        sealedAt: '2026-09-20T07:00:01.000Z',
        controlledQuantityLitres: '2.250',
      },
    });
    expect(reset.litres.toString()).toBe('2.25');
    expect(reset.controlledException).toBe(true);
  });

  it('inherits an opening meter and rejects retyping a conflicting value', () => {
    const prior = { status: 'AVAILABLE' as const, value: '1000.000' };
    const inherited = resolveOpeningReading({ priorSealed: prior });
    expect(inherited).toEqual(prior);
    expect(() =>
      resolveOpeningReading({
        priorSealed: prior,
        submitted: { status: 'AVAILABLE', value: '999.000' },
      }),
    ).toThrow(/inherit/);
  });

  it('enforces named shift state transitions and overnight business-date ownership', () => {
    const day = openBusinessDay(
      newBusinessDay({
        id: ids.day,
        tenantId: ids.tenant,
        stationId: ids.station,
        date: '2026-09-20',
      }),
    );
    const shift: Shift = {
      id: ids.shift,
      tenantId: ids.tenant,
      stationId: ids.station,
      businessDayId: ids.day,
      state: 'PLANNED',
      plannedStartAt: '2026-09-20T22:00:00.000Z',
      plannedEndAt: '2026-09-21T06:00:00.000Z',
      businessDate: day.date,
      version: 0,
    };
    expect(startShift(shift, day).state).toBe('OPEN');
    expect(() => closeMeters(shift)).toThrow(/OPEN/);
  });

  it('prevents overlapping operational ownership of a nozzle', () => {
    const first = segment();
    const second = {
      ...first,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      startAt: '2026-09-20T13:00:00.000Z',
      endAt: '2026-09-20T15:00:00.000Z',
    };
    expect(() => assertNoOverlappingOperationalSegments([first], second)).toThrow(/overlapping/);
  });

  it('calculates signed variance and requires explanation, then blocks self approval', () => {
    const revision = calculateReconciliation({
      id: '12121212-1212-4212-8212-121212121212',
      reconciliationId: '13131313-1313-4313-8313-131313131313',
      revision: 1,
      tenantId: ids.tenant,
      stationId: ids.station,
      businessDayId: ids.day,
      segments: [segment()],
      declarations: [
        {
          id: '14141414-1414-4414-8414-141414141414',
          category: 'CASH',
          amount: money('20.1875'),
          declaredBy: ids.actor,
        },
      ],
      policy: { warningThreshold: '1.00', blockingThreshold: '5.00' },
    });
    expect(revision.variance.amount.toString()).toBe('5');
    expect(() => submitReconciliation(revision, trustedActor)).toThrow(/explanation/);
    const submitted = submitReconciliation(
      revision,
      trustedActor,
      'Till count includes a documented correction',
    );
    expect(submitted.state).toBe('SUBMITTED');
    const pending = requestReconciliationApproval(submitted);
    expect(() => approveReconciliation(pending, trustedActor)).toThrow(/submitting/);
    const otherActor = createTrustedActor({
      transaction: createTrustedTenantTransactionContext({
        tenantId: ids.tenant,
        actorId: '15151515-1515-4515-8515-151515151515',
        membershipId: '15151515-1515-4515-8515-151515151515',
        requestId: '16161616-1616-4616-8616-161616161616',
      }),
      actorId: '15151515-1515-4515-8515-151515151515',
      membershipId: '15151515-1515-4515-8515-151515151515',
      tenantId: ids.tenant,
      stationId: ids.station,
      legalEntityId: ids.legal,
    });
    expect(approveReconciliation(pending, otherActor).state).toBe('APPROVED');
  });
});
