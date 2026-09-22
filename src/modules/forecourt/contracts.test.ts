import { describe, expect, it } from 'vitest';
import { businessDate, money, unitPrice, litres } from '../../platform/domain/primitives';
import {
  meterSegmentSealedEvent,
  reconciliationApprovedEvent,
  reconciliationPostedEvent,
} from './contracts';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { createTrustedActor } from './trusted-actor';
import { approveReconciliation, postReconciliation } from './domain';

const ids = {
  tenant: '21111111-1111-4111-8111-111111111111',
  legal: '22222222-2222-4222-8222-222222222222',
  station: '23333333-3333-4333-8333-333333333333',
  actor: '24444444-4444-4444-8444-444444444444',
  approver: '25555555-5555-4555-8555-555555555555',
};

const approver = createTrustedActor({
  transaction: createTrustedTenantTransactionContext({
    tenantId: ids.tenant,
    actorId: ids.approver,
    membershipId: ids.approver,
    requestId: '26666666-6666-4666-8666-666666666666',
  }),
  actorId: ids.approver,
  membershipId: ids.approver,
  tenantId: ids.tenant,
  stationId: ids.station,
  legalEntityId: ids.legal,
});

const revision = {
  id: '27777777-7777-4777-8777-777777777777',
  reconciliationId: '28888888-8888-4888-8888-888888888888',
  revision: 3,
  tenantId: ids.tenant,
  stationId: ids.station,
  businessDayId: '29999999-9999-4999-8999-999999999999',
  businessDate: businessDate('2026-09-20'),
  state: 'APPROVED' as const,
  expectedSales: money('100.00'),
  declarations: [
    {
      id: '2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      category: 'CASH' as const,
      amount: money('100.00'),
      declaredBy: ids.actor,
    },
  ],
  accountedSales: money('100.00'),
  variance: money('0.00'),
  varianceClassification: 'INFORMATIONAL' as const,
  approvedBy: ids.approver,
  sourceSegmentIds: ['31111111-1111-4111-8111-111111111111'],
  sourceShiftIds: ['32222222-2222-4222-8222-222222222222'],
};

describe('A3 event contracts', () => {
  it('emits approved only for APPROVED and posted only for POSTED', () => {
    const approved = reconciliationApprovedEvent('2bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision, {
      legalEntityId: ids.legal,
      businessDate: businessDate('2026-09-20'),
      occurredAt: '2026-09-20T15:00:00.000Z',
    });
    expect(approved.eventType).toBe('reconciliation.approved.v1');
    expect(approved.eventVersion).toBe(1);
    expect(approved.revision).toBe(3);
    expect(approved.declarationTotals[0]?.amount.amount.toString()).toBe('100');

    const postedRevision = postReconciliation(revision, approver, '2026-09-20T15:01:00.000Z');
    const posted = reconciliationPostedEvent(
      '2ccccccc-cccc-4ccc-8ccc-cccccccccccc',
      postedRevision,
      {
        legalEntityId: ids.legal,
        businessDate: '2026-09-20',
        occurredAt: '2026-09-20T15:01:00.000Z',
      },
    );
    expect(posted.eventType).toBe('reconciliation.posted.v1');
    expect(posted.postedBy).toBe(ids.approver);
  });

  it('does not masquerade a posted or locked revision as approved', () => {
    expect(() =>
      reconciliationApprovedEvent(
        '2ddddddd-dddd-4ddd-8ddd-dddddddddddd',
        { ...revision, state: 'POSTED' },
        {
          legalEntityId: ids.legal,
          businessDate: '2026-09-20',
        },
      ),
    ).toThrow(/approved/);
    expect(() =>
      reconciliationApprovedEvent(
        '2eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        { ...revision, state: 'LOCKED' },
        {
          legalEntityId: ids.legal,
          businessDate: '2026-09-20',
        },
      ),
    ).toThrow(/approved/);
  });

  it('includes authoritative segment and lineage fields', () => {
    const event = meterSegmentSealedEvent(
      '2fffffff-ffff-4fff-8fff-ffffffffffff',
      {
        id: '31111111-1111-4111-8111-111111111111',
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: revision.businessDayId,
        businessDate: businessDate('2026-09-20'),
        shiftId: '32222222-2222-4222-8222-222222222222',
        nozzleId: '33333333-3333-4333-8333-333333333333',
        meterInstallationId: '34444444-4444-4444-8444-444444444444',
        meterId: '34666666-6666-4666-8666-666666666666',
        productId: '35555555-5555-4555-8555-555555555555',
        attendantId: ids.actor,
        enteredBy: ids.actor,
        openingBoundaryId: '36666666-6666-4666-8666-666666666666',
        closingBoundaryId: '37777777-7777-4777-8777-777777777777',
        openingReading: '1000.000',
        closingReading: '1010.000',
        litres: litres('10.000'),
        unitPrice: unitPrice('1.50'),
        currency: 'USD',
        expectedSaleValue: money('15.0000'),
        openingBoundaryReason: 'SHIFT_OPEN',
        boundaryReason: 'SHIFT_CLOSE',
        version: 0,
        startAt: '2026-09-20T06:00:00.000Z',
        endAt: '2026-09-20T14:00:00.000Z',
        sealedAt: '2026-09-20T14:00:01.000Z',
        controlledException: false,
      },
      { legalEntityId: ids.legal, businessDate: '2026-09-20' },
    );
    expect(event.litres).toBe('10');
    expect(event.productId).toBe('35555555-5555-4555-8555-555555555555');
    expect(event.meterInstallationId).toBe('34444444-4444-4444-8444-444444444444');
  });
});
