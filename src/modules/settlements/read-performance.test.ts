import { expect, it, vi } from 'vitest';
import {
  getSettlementOverviewInTransaction,
  listProviderSettlementSummariesInTransaction,
  listUnmatchedProviderPaymentsInTransaction,
} from './persistence';
import type { SettlementCommandContext } from './application';
import type { ForecourtTransaction } from '../forecourt/application';
const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  stationId: '22222222-2222-4222-8222-222222222222',
} as SettlementCommandContext;
it('returns the same exact-money results as the separate reads in one exchange', async () => {
  const settlement = {
    grossAmount: '100.25',
    allocatedAmount: '40.10',
    providerFeeAmount: '2.00',
    providerDeductionAmount: '1.00',
    reportedNetAmount: '97.25',
    state: 'RECORDED',
  };
  const payment = { amount: '90.20', allocatedAmount: '40.10' };
  const execute = vi.fn().mockResolvedValueOnce([settlement]).mockResolvedValueOnce([payment]);
  const tx = { execute } as unknown as ForecourtTransaction;
  const settlements = await listProviderSettlementSummariesInTransaction(tx, context);
  const unmatched = await listUnmatchedProviderPaymentsInTransaction(tx, context);
  execute.mockClear().mockResolvedValue([{ settlements: [settlement], unmatched: [payment] }]);
  expect(await getSettlementOverviewInTransaction(tx, context)).toEqual({ settlements, unmatched });
  expect(execute).toHaveBeenCalledTimes(1);
});
it('fails explicitly when the batched snapshot is absent', async () => {
  const execute = vi.fn().mockResolvedValue([]);
  await expect(
    getSettlementOverviewInTransaction({ execute } as unknown as ForecourtTransaction, context),
  ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
});
