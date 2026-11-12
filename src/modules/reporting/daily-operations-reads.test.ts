import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const TENANT = 'a8852b9f-c490-4a72-a3f3-8662aeb14a8a';

const mocks = vi.hoisted(() => ({
  readAuthority: vi.fn(),
  withTenantTransaction: vi.fn(),
}));
vi.mock('../context/read-authority', () => ({ resolveTenantReadAuthority: mocks.readAuthority }));
vi.mock('../../platform/db/transaction', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}));
vi.mock('../../platform/security/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/security/permissions')>()),
  authorize: vi.fn(),
}));

import { getDailyOperationsFromRequest } from './queries';

/**
 * A database whose answers all arrive together, a moment after the last question is asked.
 * Each question the code waits on before asking the next one shows up as "asked, not yet
 * answered" never exceeding one; independent questions all show up before the first answer.
 */
function fakeDatabase(options: { failOnCall?: number } = {}) {
  const log = { asked: 0, askedWhenFirstAnswered: null as number | null };
  const execute = vi.fn(async () => {
    log.asked += 1;
    const call = log.asked;
    await new Promise((resolve) => setTimeout(resolve, 5));
    log.askedWhenFirstAnswered ??= log.asked;
    if (options.failOnCall === call) throw new Error('read failed');
    return [];
  });
  mocks.withTenantTransaction.mockImplementation(
    async (_context: unknown, work: (transaction: unknown) => unknown) => work({ execute }),
  );
  return log;
}

beforeEach(() => {
  vi.stubEnv('CONSOLIDATED_CONTEXT_READS', '1');
  mocks.readAuthority.mockResolvedValue({
    authority: { authorization: {}, transaction: {} },
    rows: [],
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const request = new Request('http://localhost/');
const input = { tenantId: TENANT, fromDate: '2026-11-01', toDate: '2026-11-12' };

it('asks the database for every daily figure at once instead of one after another', async () => {
  const log = fakeDatabase();
  await getDailyOperationsFromRequest(request, input);
  expect(log.asked).toBeGreaterThan(1);
  // Nothing was answered before every read had been asked.
  expect(log.askedWhenFirstAnswered).toBe(log.asked);
});

it('returns the same daily result shape', async () => {
  fakeDatabase();
  const result = await getDailyOperationsFromRequest(request, input);
  expect(result).toMatchObject({
    report: 'DAILY_OPERATIONS',
    state: 'POSTED',
    rows: [],
    expectedBusinessDays: 0,
    missingReportDays: [],
  });
});

it('fails the whole request when any one of the reads fails', async () => {
  fakeDatabase({ failOnCall: 3 });
  await expect(getDailyOperationsFromRequest(request, input)).rejects.toThrow('read failed');
});
