import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { clerkHeaders } from './auth-session-fixtures';
import { GET as priceChangeGet } from '../../src/app/api/forecourt/price-change/route';
import { POST as setupPost } from '../../src/app/api/setup/commands/route';
import { createQa1ScenarioContext } from './qa1/fixture';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for price history tests.');
let client: Sql;

describe('price history and planned start (PostgreSQL)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-price-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-price-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  it('keeps the prices that were in use and shows the planned start of a change under way', async () => {
    const ctx = await createQa1ScenarioContext(client, 'price-history');
    const headers = { ...clerkHeaders(ctx.actors.admin.token) };
    const read = async () => {
      const response = await priceChangeGet(
        new Request(
          `http://127.0.0.1:3000/api/forecourt/price-change?tenantId=${ctx.tenantId}&stationId=${ctx.stationId}`,
          { headers },
        ),
      );
      expect(response.status).toBe(200);
      return (await response.json()) as Record<string, any>;
    };

    const before = await read();
    expect(before.station.timezone).toBe('Africa/Harare');
    const product = before.products.find(
      (row: Record<string, any>) => row.productId === ctx.productId,
    );
    // The price in use is part of the history, and nothing is pending yet.
    expect(product.history.map((entry: Record<string, any>) => entry.state)).toEqual(['ACTIVE']);
    expect(product.change).toBeNull();

    // A new price planned for 27 October 2026 at 06:00 in Harare (04:00 UTC).
    const planned = '2026-10-27T04:00:00.000Z';
    const drafted = await setupPost(
      new Request('http://127.0.0.1:3000/api/setup/commands', {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'idempotency-key': 'price-history-draft',
        },
        body: JSON.stringify({
          commandType: 'DraftPriceChange',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          productId: ctx.productId,
          unitPrice: '1.99',
          currency: 'USD',
          effectiveFrom: planned,
        }),
      }),
    );
    expect(drafted.status, await drafted.clone().text()).toBeLessThan(300);

    const after = await read();
    const changing = after.products.find(
      (row: Record<string, any>) => row.productId === ctx.productId,
    );
    expect(changing.change).toMatchObject({
      unitPrice: '1.990000',
      state: 'DRAFT',
      plannedFrom: planned,
    });
    // The draft is not history: only prices that were in use are.
    expect(changing.history.map((entry: Record<string, any>) => entry.unitPrice)).toHaveLength(1);
  });
});
