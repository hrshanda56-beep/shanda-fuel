import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { createQa1ScenarioContext, type Qa1ScenarioContext } from './qa1/fixture';
import { cash, customer, forecourt, inventory, supplier } from './qa1/commands';
import { snapshotQa1 } from './qa1/snapshots';
import { expectNoAuthoritativeChange } from './qa1/assertions';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for cross-tenant command tests.');

let client: Sql;

describe('A person from another organisation cannot change this organisation', () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-xtenant-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-xtenant-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  const refused = (status: number) => [401, 403, 404].includes(status);

  async function attempts(ctx: Qa1ScenarioContext) {
    const as = 'otherTenant' as const;
    return {
      'record cash': await cash(
        ctx,
        {
          commandType: 'RecordCashCollection',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          collectionReference: `XT-${ctx.runId.slice(0, 8)}`,
          sourceLocationId: ctx.tillId,
          sources: [{ reconciliationId: randomUUID(), amount: '1.0000' }],
        },
        'xt-cash',
        as,
      ),
      'create customer': await customer(
        ctx,
        {
          commandType: 'CreateCustomer',
          tenantId: ctx.tenantId,
          accountReference: `XT-${ctx.runId.slice(0, 8)}`,
          displayName: 'Cross Tenant Customer',
          legalEntityId: ctx.legalEntityId,
        },
        'xt-customer',
        as,
      ),
      'create supplier': await supplier(
        ctx,
        {
          commandType: 'CreateSupplier',
          tenantId: ctx.tenantId,
          legalEntityId: ctx.legalEntityId,
          code: `XT-${ctx.runId.slice(0, 8)}`,
          legalName: 'Cross Tenant Supplier',
        },
        'xt-supplier',
        as,
      ),
      'record opening stock': await inventory(
        ctx,
        {
          commandType: 'RecordOpeningBalance',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          tankId: ctx.tankId,
          quantityLitres: '1.000',
          effectiveAt: '2026-09-20T00:00:00.000Z',
        },
        'xt-inventory',
        as,
      ),
      'start a reconciliation': await forecourt(
        ctx,
        {
          commandType: 'CreateProductionReconciliation',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          reconciliationId: randomUUID(),
          businessDayId: ctx.businessDayId,
          shiftId: randomUUID(),
          expectedVersion: 0,
        },
        'xt-forecourt',
        as,
      ),
    };
  }

  it('is refused on cash, customers, suppliers, stock and reconciliations, and nothing changes', async () => {
    const ctx = await createQa1ScenarioContext(client, 'xtenant');
    const before = await snapshotQa1(client, ctx);
    const results = await attempts(ctx);
    for (const [name, result] of Object.entries(results)) {
      expect(
        refused(result.response.status),
        `${name} answered ${result.response.status}: ${JSON.stringify(result.body)}`,
      ).toBe(true);
    }
    expectNoAuthoritativeChange(before, await snapshotQa1(client, ctx));
  });
});
