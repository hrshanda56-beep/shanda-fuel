import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ can: vi.fn() }));
vi.mock('../../platform/security/permissions', () => ({ isPermissionGranted: mocks.can }));
import { loadSignOffFacts } from './sign-off';
import type { InventoryCommandContext, InventoryTransaction } from '../inventory/application';
const context = {
  tenantId: 'tenant',
  stationId: 'station',
  scope: {},
  authority: { authorization: { membershipId: 'me' } },
} as unknown as InventoryCommandContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.can.mockReturnValue(true);
});
it('loads both sign-off queues and alternate approvers in one exchange', async () => {
  const execute = vi.fn().mockResolvedValue([
    {
      reconciliations: [
        {
          id: 'r',
          business_day_id: 'day',
          shift_id: 'shift',
          business_date: '2026-10-18',
          submitted_by: 'me',
        },
      ],
      revaluations: [],
      other_reconciler: true,
      other_revaluer: false,
    },
  ]);
  const result = await loadSignOffFacts({ execute } as unknown as InventoryTransaction, context);
  expect(result.reconciliations).toEqual({
    rows: [
      {
        id: 'r',
        businessDayId: 'day',
        shiftId: 'shift',
        businessDate: '2026-10-18',
        submittedByMe: true,
      },
    ],
    soleApprover: false,
  });
  expect(result.revaluations?.soleApprover).toBe(true);
  expect(execute).toHaveBeenCalledTimes(1);
});
it('does not read restricted sign-off data', async () => {
  mocks.can.mockReturnValue(false);
  const execute = vi.fn();
  expect(await loadSignOffFacts({ execute } as unknown as InventoryTransaction, context)).toEqual({
    reconciliations: null,
    revaluations: null,
  });
  expect(execute).not.toHaveBeenCalled();
});
it('reports a missing snapshot rather than displaying an empty success', async () => {
  const execute = vi.fn().mockResolvedValue([]);
  await expect(
    loadSignOffFacts({ execute } as unknown as InventoryTransaction, context),
  ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
});
