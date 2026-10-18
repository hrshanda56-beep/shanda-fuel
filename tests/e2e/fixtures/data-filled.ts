import type { Page } from '@playwright/test';

/**
 * SYNTHETIC responses for data-filled screens, shaped exactly like the
 * existing contracts: /api/context, /api/forecourt/operations/overview,
 * /api/settlements/overview. No backend field
 * is invented here. Used by data-filled-screens.spec.ts and the screenshot
 * matrix.
 */

export const TENANT = 'tenant-1';
export const ENTITY = 'entity-1';
export const STATION = 'station-1';

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

export async function mockContext(page: Page, pathname: string) {
  await page.route('**/api/context*', (route) =>
    route.fulfill(
      json({
        data: {
          available: {
            organisations: [
              {
                id: TENANT,
                name: 'Sample organisation',
                legalEntities: [
                  {
                    id: ENTITY,
                    name: 'Sample legal entity',
                    stations: [
                      {
                        id: STATION,
                        code: 'SMP-01',
                        name: 'Sample station',
                        timezone: 'Africa/Harare',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          current: {
            organisationId: TENANT,
            legalEntityId: ENTITY,
            stationId: STATION,
            allStations: false,
          },
          route: {
            pathname,
            policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: false },
          },
          persistedContextInvalid: false,
        },
      }),
    ),
  );
}

const action = { canExecute: false, permissionGranted: true, requiresStepUp: false };

/** Day 11 Oct is still open while the station is on 12 Oct; two shifts; four reconciliations. */
const overview = {
  station: { code: 'SMP-01', name: 'Sample station', timezone: 'Africa/Harare' },
  organisation: { name: 'Sample organisation' },
  currentBusinessDate: '2026-10-12',
  currentBusinessDayId: 'day-2',
  visibility: { reconciliations: true },
  actions: {
    OpenBusinessDay: action,
    CloseBusinessDay: action,
    LockBusinessDay: action,
    StartShift: action,
    CloseMeters: action,
    CompleteShift: action,
  },
  businessDays: [
    {
      id: 'day-1',
      date: '2026-10-11',
      state: 'OPEN',
      version: 3,
      openedAt: '2026-10-11T04:00:00.000Z',
      closedAt: null,
      updatedAt: '2026-10-11T16:00:00.000Z',
    },
  ],
  selectedBusinessDay: {
    id: 'day-1',
    date: '2026-10-11',
    state: 'OPEN',
    version: 3,
    openedAt: '2026-10-11T04:00:00.000Z',
    closedAt: null,
  },
  shifts: [
    {
      id: 'shift-1',
      state: 'OPEN',
      businessDate: '2026-10-11',
      plannedStartAt: '2026-10-11T04:00:00.000Z',
      plannedEndAt: '2026-10-11T12:00:00.000Z',
      version: 2,
      openedAt: '2026-10-11T04:05:00.000Z',
      meterClosedAt: null,
      completedAt: null,
      notOperatedReason: null,
      attendantCount: 2,
    },
    {
      id: 'shift-2',
      state: 'COMPLETED',
      businessDate: '2026-10-11',
      plannedStartAt: '2026-10-11T12:00:00.000Z',
      plannedEndAt: '2026-10-11T20:00:00.000Z',
      version: 5,
      openedAt: '2026-10-11T12:02:00.000Z',
      meterClosedAt: '2026-10-11T19:55:00.000Z',
      completedAt: '2026-10-11T20:01:00.000Z',
      notOperatedReason: null,
      attendantCount: 1,
    },
  ],
  reconciliations: [
    {
      id: 'rec-approved',
      shiftId: 'shift-2',
      state: 'APPROVED',
      version: 4,
      revision: 1,
      revisionState: 'APPROVED',
      updatedAt: '2026-10-11T21:00:00.000Z',
      submittedAt: '2026-10-11T20:30:00.000Z',
      returnedAt: null,
      approvedAt: '2026-10-11T21:00:00.000Z',
      returnReason: null,
    },
    {
      id: 'rec-draft',
      shiftId: 'shift-1',
      state: 'DRAFT',
      version: 1,
      revision: 1,
      revisionState: 'DRAFT',
      updatedAt: '2026-10-11T10:00:00.000Z',
      submittedAt: null,
      returnedAt: null,
      approvedAt: null,
      returnReason: null,
    },
    {
      id: 'rec-review',
      shiftId: 'shift-1',
      state: 'PENDING_APPROVAL',
      version: 2,
      revision: 1,
      revisionState: 'PENDING_APPROVAL',
      updatedAt: '2026-10-11T12:30:00.000Z',
      submittedAt: '2026-10-11T12:30:00.000Z',
      returnedAt: null,
      approvedAt: null,
      returnReason: null,
    },
    {
      id: 'rec-returned',
      shiftId: 'shift-2',
      state: 'RETURNED',
      version: 3,
      revision: 2,
      revisionState: 'RETURNED',
      updatedAt: '2026-10-11T20:45:00.000Z',
      submittedAt: '2026-10-11T20:20:00.000Z',
      returnedAt: '2026-10-11T20:45:00.000Z',
      approvedAt: null,
      returnReason: 'Counted cash does not match the declaration',
    },
  ],
};

export async function mockOverview(page: Page) {
  await page.route('**/api/forecourt/operations/overview**', (route) =>
    route.fulfill(json(overview)),
  );
}

export async function mockSettlements(page: Page) {
  const settlement = (input: {
    id: string;
    providerName: string;
    grossAmount: string;
    state: string;
  }) => ({
    settlementId: input.id,
    providerId: `provider-${input.id}`,
    providerCode: input.id.toUpperCase(),
    providerName: input.providerName,
    providerAccountId: `account-${input.id}`,
    accountReference: `MERCHANT-${input.id}`,
    stationId: STATION,
    settlementReference: `REF-${input.id}`,
    batchReference: null,
    transactionDate: '2026-10-10',
    settlementDate: '2026-10-11',
    currency: 'USD',
    grossAmount: input.grossAmount,
    allocatedAmount: '0.0000',
    unallocatedProviderAmount: input.grossAmount,
    expectedEvidenceAmount: '0.0000',
    unmatchedEvidenceAmount: '0.0000',
    providerFeeAmount: null,
    providerDeductionAmount: null,
    reportedNetAmount: null,
    varianceAmount: '0.0000',
    state: input.state,
    version: 1,
  });
  const payment = (id: string, method: 'POS' | 'ECOCASH', amount: string) => ({
    paymentId: id,
    stationId: STATION,
    reconciliationId: 'rec-approved',
    reconciliationState: 'APPROVED',
    businessDate: '2026-10-10',
    method,
    amount,
    reference: `REF-${id}`,
    allocatedAmount: '0.0000',
    unallocatedAmount: amount,
  });
  await page.route('**/api/settlements/overview**', (route) => {
    const summaryFixture = json([
      settlement({
        id: 'eco',
        providerName: 'EcoCash merchant',
        grossAmount: '75.0000',
        state: 'RECORDED',
      }),
      settlement({
        id: 'pos',
        providerName: 'Zimswitch POS',
        grossAmount: '25.0000',
        state: 'EXCEPTION',
      }),
    ]);
    const unmatchedFixture = json([
      payment('p1', 'ECOCASH', '25.5000'),
      payment('p2', 'POS', '40.0000'),
      payment('p3', 'POS', '10.0000'),
    ]);
    if (summaryFixture.status >= 400) return route.fulfill(summaryFixture);
    if (unmatchedFixture.status >= 400) return route.fulfill(unmatchedFixture);
    return route.fulfill(
      json({
        settlements: JSON.parse(summaryFixture.body),
        unmatched: JSON.parse(unmatchedFixture.body),
      }),
    );
  });
}
