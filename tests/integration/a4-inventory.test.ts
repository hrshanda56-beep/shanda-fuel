import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { and, eq } from 'drizzle-orm';
import { createTrustedTenantTransactionContext } from '../../src/platform/db/tenant-context';
import { withTenantTransaction } from '../../src/platform/db/transaction';
import {
  executeInventoryCommand,
  type InventoryCommandContext,
} from '../../src/modules/inventory/application';
import {
  getTankVariance,
  postInventoryMovementInTransaction,
} from '../../src/modules/inventory/persistence';
import { deriveBusinessDate } from '../../src/platform/domain/business-time';
import {
  fuelDeliveries,
  fuelDeliveryAllocations,
  inventoryMovements,
  tanks,
  tankDips,
} from '../../src/platform/db/schema/a4';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for A4 inventory integration tests.');
}

const ids = {
  tenant: 'a4000000-0000-4000-8000-000000000001',
  legal: 'a4000000-0000-4000-8000-000000000011',
  station: 'a4000000-0000-4000-8000-000000000021',
  actor: 'a4000000-0000-4000-8000-000000000031',
  membership: 'a4000000-0000-4000-8000-000000000041',
  diesel: 'a4000000-0000-4000-8000-000000000051',
  petrol: 'a4000000-0000-4000-8000-000000000052',
  dieselTank: 'a4000000-0000-4000-8000-000000000061',
  petrolTank: 'a4000000-0000-4000-8000-000000000062',
  delivery: 'a4000000-0000-4000-8000-000000000071',
  allocation: 'a4000000-0000-4000-8000-000000000072',
  opening: 'a4000000-0000-4000-8000-000000000081',
  deliveryMovement: 'a4000000-0000-4000-8000-000000000082',
  saleMovement: 'a4000000-0000-4000-8000-000000000083',
  dip: 'a4000000-0000-4000-8000-000000000091',
};

let client: Sql;

function context(): InventoryCommandContext {
  const transaction = createTrustedTenantTransactionContext({
    tenantId: ids.tenant,
    actorId: ids.actor,
    membershipId: ids.membership,
    legalEntityId: ids.legal,
    stationId: ids.station,
    requestId: 'a4000000-0000-4000-8000-000000000099',
  });
  const assignment = {
    tenantId: ids.tenant,
    scopeType: 'STATION' as const,
    legalEntityId: ids.legal,
    stationId: ids.station,
    roleCode: 'ADMINISTRATOR' as const,
  };
  const authority = {
    actor: {
      identityId: ids.actor,
      session: {
        sessionId: 'a4000000-0000-4000-8000-000000000098',
        userId: ids.actor,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        strongAuthenticatedAt: new Date('2026-09-23T00:00:00Z'),
        strongAuthenticationExpiresAt: new Date('2030-01-01T00:00:00Z'),
        strongAuthenticationVerified: true,
      },
    },
    membership: {
      tenantId: ids.tenant,
      membershipId: ids.membership,
      identityId: ids.actor,
      actorId: ids.actor,
      status: 'ACTIVE' as const,
      roleAssignments: [assignment],
      temporaryGrants: [],
    },
    authorization: {
      userId: ids.actor,
      membershipId: ids.membership,
      tenantId: ids.tenant,
      membershipActive: true,
      strongAuthenticationAt: new Date('2026-09-23T00:00:00Z'),
      strongAuthenticationExpiresAt: new Date('2030-01-01T00:00:00Z'),
      strongAuthenticationVerified: true,
      roleAssignments: [assignment],
      temporaryGrants: [],
    },
    transaction,
  };
  return {
    authority,
    tenantId: ids.tenant,
    legalEntityId: ids.legal,
    stationId: ids.station,
    stationTimezone: 'Africa/Harare',
    requestId: transaction.requestId!,
    scope: {
      tenantId: ids.tenant,
      scopeType: 'STATION',
      legalEntityId: ids.legal,
      stationId: ids.station,
    },
  };
}

describe('A4 PostgreSQL inventory persistence', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a4-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a4-secret';
    client = postgres(databaseUrl, { max: 1, prepare: false });
    await client.unsafe(`
      select set_config('app.tenant_id', '${ids.tenant}', false);
      select set_config('app.actor_id', '${ids.actor}', false);
      select set_config('app.membership_id', '${ids.membership}', false);
      select set_config('app.station_id', '${ids.station}', false);
      insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'TEI Oils', 'a4-tei-oils') on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values ('${ids.actor}', 'A4 Operator', 'a4-operator@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${ids.legal}', '${ids.tenant}', 'TEI Oils Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'ARCTURUS', 'Arcturus', 'ACTIVE') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}') on conflict do nothing;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.diesel}', '${ids.tenant}', 'DIESEL', 'Diesel'),
        ('${ids.petrol}', '${ids.tenant}', 'PETROL', 'Petrol') on conflict (id) do nothing;
    `);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('persists tanks, opening stock, delivery allocation, sale, and dip variance', async () => {
    const trusted = context();
    await executeInventoryCommand({
      context: trusted,
      commandType: 'CreateTank',
      permissionCode: 'inventory.tank.manage',
      idempotencyKey: 'a4-create-diesel-tank',
      requestHash: 'a4-create-diesel-tank-hash',
      audit: {
        actionCode: 'INVENTORY.TANK_CREATED',
        subjectType: 'Tank',
        subjectId: ids.dieselTank,
      },
      execute: (transaction) =>
        transaction
          .insert(tanks)
          .values({
            id: ids.dieselTank,
            tenantId: ids.tenant,
            stationId: ids.station,
            code: 'D1',
            productId: ids.diesel,
            capacityLitres: '20000',
            createdBy: ids.membership,
            updatedBy: ids.membership,
          })
          .returning({ id: tanks.id }),
    });
    await executeInventoryCommand({
      context: trusted,
      commandType: 'CreateTank',
      permissionCode: 'inventory.tank.manage',
      idempotencyKey: 'a4-create-petrol-tank',
      requestHash: 'a4-create-petrol-tank-hash',
      audit: {
        actionCode: 'INVENTORY.TANK_CREATED',
        subjectType: 'Tank',
        subjectId: ids.petrolTank,
      },
      execute: (transaction) =>
        transaction
          .insert(tanks)
          .values({
            id: ids.petrolTank,
            tenantId: ids.tenant,
            stationId: ids.station,
            code: 'P1',
            productId: ids.petrol,
            capacityLitres: '12000',
            createdBy: ids.membership,
            updatedBy: ids.membership,
          })
          .returning({ id: tanks.id }),
    });
    await withTenantTransaction(trusted.authority.transaction, async (transaction) => {
      await postInventoryMovementInTransaction(transaction, {
        tenantId: ids.tenant,
        stationId: ids.station,
        tankId: ids.dieselTank,
        productId: ids.diesel,
        movementType: 'OPENING_BALANCE',
        quantityLitres: '10000',
        effectiveAt: new Date('2026-09-23T06:00:00Z'),
        businessDate: '2026-09-23',
        sourceType: 'OPENING_BALANCE',
        sourceId: ids.opening,
        actorMembershipId: ids.membership,
      });
      await transaction.insert(fuelDeliveries).values({
        id: ids.delivery,
        tenantId: ids.tenant,
        stationId: ids.station,
        productId: ids.diesel,
        deliveryNoteNumber: 'DN-A4-001',
        deliveredAt: new Date('2026-09-23T09:00:00Z'),
        businessDate: '2026-09-23',
        noteQuantityLitres: '5000',
        actualQuantityLitres: '5000',
        shortageExcessLitres: '0',
        status: 'DRAFT',
        recordedBy: ids.membership,
      });
      await transaction.insert(fuelDeliveryAllocations).values({
        id: ids.allocation,
        tenantId: ids.tenant,
        stationId: ids.station,
        deliveryId: ids.delivery,
        tankId: ids.dieselTank,
        productId: ids.diesel,
        quantityLitres: '5000',
      });
      await postInventoryMovementInTransaction(transaction, {
        tenantId: ids.tenant,
        stationId: ids.station,
        tankId: ids.dieselTank,
        productId: ids.diesel,
        movementType: 'DELIVERY',
        quantityLitres: '5000',
        effectiveAt: new Date('2026-09-23T09:00:00Z'),
        businessDate: '2026-09-23',
        sourceType: 'FUEL_DELIVERY_ALLOCATION',
        sourceId: ids.allocation,
        actorMembershipId: ids.membership,
      });
      await transaction
        .update(fuelDeliveries)
        .set({
          status: 'CONFIRMED',
          confirmedBy: ids.membership,
          confirmedAt: new Date('2026-09-23T09:01:00Z'),
        })
        .where(eq(fuelDeliveries.id, ids.delivery));
      await postInventoryMovementInTransaction(transaction, {
        tenantId: ids.tenant,
        stationId: ids.station,
        tankId: ids.dieselTank,
        productId: ids.diesel,
        movementType: 'SALE',
        quantityLitres: '-500',
        effectiveAt: new Date('2026-09-23T15:00:00Z'),
        businessDate: '2026-09-23',
        sourceType: 'FORECOURT_SALE',
        sourceId: ids.saleMovement,
        actorMembershipId: ids.membership,
      });
      await transaction.insert(tankDips).values({
        id: ids.dip,
        tenantId: ids.tenant,
        stationId: ids.station,
        tankId: ids.dieselTank,
        measuredAt: new Date('2026-09-23T15:05:00Z'),
        businessDate: deriveBusinessDate(new Date('2026-09-23T15:05:00Z'), 'Africa/Harare'),
        physicalLitres: '14480',
        recordedBy: ids.membership,
      });
    });
    const position = await getTankVariance(trusted, ids.dieselTank);
    expect(position.expectedLitres).toBe('14500.000');
    expect(position.physicalLitres).toBe('14480.000');
    expect(position.varianceLitres).toBe('-20.000');
    const persisted = await client<
      { count: number }[]
    >`select count(*)::int as count from app.inventory_movements where tenant_id = ${ids.tenant} and tank_id = ${ids.dieselTank}`;
    expect(persisted[0]?.count).toBe(3);
  });

  it('rejects wrong product, negative stock, and duplicate movement sources', async () => {
    const trusted = context();
    await expect(
      withTenantTransaction(trusted.authority.transaction, (transaction) =>
        postInventoryMovementInTransaction(transaction, {
          tenantId: ids.tenant,
          stationId: ids.station,
          tankId: ids.dieselTank,
          productId: ids.petrol,
          movementType: 'DELIVERY',
          quantityLitres: '1',
          effectiveAt: new Date(),
          businessDate: '2026-09-23',
          sourceType: 'BAD_PRODUCT',
          sourceId: 'a4000000-0000-4000-8000-000000000092',
          actorMembershipId: ids.membership,
        }),
      ),
    ).rejects.toThrow('does not match');
    await expect(
      withTenantTransaction(trusted.authority.transaction, (transaction) =>
        postInventoryMovementInTransaction(transaction, {
          tenantId: ids.tenant,
          stationId: ids.station,
          tankId: ids.dieselTank,
          productId: ids.diesel,
          movementType: 'SALE',
          quantityLitres: '-20000',
          effectiveAt: new Date(),
          businessDate: '2026-09-23',
          sourceType: 'NEGATIVE_STOCK',
          sourceId: 'a4000000-0000-4000-8000-000000000093',
          actorMembershipId: ids.membership,
        }),
      ),
    ).rejects.toThrow('negative stock');
    await expect(
      withTenantTransaction(trusted.authority.transaction, (transaction) =>
        postInventoryMovementInTransaction(transaction, {
          tenantId: ids.tenant,
          stationId: ids.station,
          tankId: ids.dieselTank,
          productId: ids.diesel,
          movementType: 'DELIVERY',
          quantityLitres: '5000',
          effectiveAt: new Date(),
          businessDate: '2026-09-23',
          sourceType: 'FUEL_DELIVERY_ALLOCATION',
          sourceId: ids.allocation,
          actorMembershipId: ids.membership,
        }),
      ),
    ).rejects.toThrow();
  });
});
