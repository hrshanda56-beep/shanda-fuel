import { expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getCashStationSummaryInTransaction } from './persistence';
import type { CashCommandContext } from './application';
import type { ForecourtTransaction } from '../forecourt/application';
const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  stationId: '22222222-2222-4222-8222-222222222222',
  legalEntityId: '33333333-3333-4333-8333-333333333333',
  actor: { membershipId: '44444444-4444-4444-8444-444444444444' },
} as CashCommandContext;
it('loads all cash sections in one exchange and preserves exact arithmetic', async () => {
  const execute = vi.fn().mockResolvedValue([
    {
      rows: [
        {
          id: 'collection',
          collection_reference: 'C',
          source_location_id: 'L',
          current_location_id: 'L',
          amount: '100.25',
          state: 'RECEIVED',
          version: 1,
          business_date: '2026-10-17',
          recorded_at: '2026-10-18T00:00:00Z',
          received_at: null,
          allocated_amount: '40.10',
          confirmed_amount: '10.05',
        },
      ],
      locations: [],
      reconciliationSources: [],
      depositRows: [],
      depositLinks: [
        {
          collection_id: 'collection',
          collection_reference: 'C',
          deposit_id: 'deposit',
          deposit_reference: 'DEP',
          amount: '40.10',
          state: 'RECORDED',
          deposited_at: '2026-10-18T08:00:00Z',
        },
      ],
      shiftLinks: [
        {
          collection_id: 'collection',
          reconciliation_id: 'recon',
          business_date: '2026-10-17',
          amount: '100.25',
        },
      ],
      bankAccounts: [],
      handovers: [],
    },
  ]);
  const result = await getCashStationSummaryInTransaction(
    { execute } as unknown as ForecourtTransaction,
    context,
  );
  expect(execute).toHaveBeenCalledTimes(1);
  expect(result.totals).toMatchObject({
    availableAtStation: '60.15',
    collectedButUnbanked: '90.2',
    pendingBankConfirmation: '30.05',
  });
  expect(result.collections[0]).toMatchObject({
    businessDate: '2026-10-17',
    deposits: [
      { depositReference: 'DEP', amount: '40.1', depositedAt: '2026-10-18T08:00:00.000Z' },
    ],
    shiftReports: [{ businessDate: '2026-10-17', amount: '100.25' }],
  });
  const query = execute.mock.calls[0]?.[0];
  if (!query) throw new Error('Expected query');
  expect(new PgDialect().sqlToQuery(query).sql).not.toContain('ba.name as bank_account_name');
});
it('fails explicitly when the database returns no summary', async () => {
  const execute = vi.fn().mockResolvedValue([]);
  await expect(
    getCashStationSummaryInTransaction({ execute } as unknown as ForecourtTransaction, context),
  ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
});
