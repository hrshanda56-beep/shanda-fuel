import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as purchasingCommandPost } from '../../src/app/api/purchasing/commands/route';
import { GET as purchasingListGet } from '../../src/app/api/purchasing/list/route';
import { GET as purchasingDetailGet } from '../../src/app/api/purchasing/detail/route';
import { GET as purchasingReferenceGet } from '../../src/app/api/purchasing/reference/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for purchase order integration tests.');
}

const ids = {
  tenant: '90a00000-0000-4000-8000-000000000001',
  legal: '90a00000-0000-4000-8000-000000000011',
  station: '90a00000-0000-4000-8000-000000000021',
  station2: '90a00000-0000-4000-8000-000000000022',
  supervisor: '90a00000-0000-4000-8000-000000000031',
  supervisorMembership: '90a00000-0000-4000-8000-000000000041',
  supervisorSession: '90a00000-0000-4000-8000-000000000051',
  finance: '90a00000-0000-4000-8000-000000000032',
  financeMembership: '90a00000-0000-4000-8000-000000000042',
  financeSession: '90a00000-0000-4000-8000-000000000052',
  admin: '90a00000-0000-4000-8000-000000000033',
  adminMembership: '90a00000-0000-4000-8000-000000000043',
  adminSession: '90a00000-0000-4000-8000-000000000053',
  attendant: '90a00000-0000-4000-8000-000000000034',
  attendantMembership: '90a00000-0000-4000-8000-000000000044',
  attendantSession: '90a00000-0000-4000-8000-000000000054',
  supplier: '90a00000-0000-4000-8000-000000000061',
  supplier2: '90a00000-0000-4000-8000-000000000062',
  diesel: '90a00000-0000-4000-8000-000000000071',
  petrol: '90a00000-0000-4000-8000-000000000072',
  tenantB: '90a10000-0000-4000-8000-000000000001',
  legalB: '90a10000-0000-4000-8000-000000000011',
  stationB: '90a10000-0000-4000-8000-000000000021',
  financeB: '90a10000-0000-4000-8000-000000000032',
  financeBMembership: '90a10000-0000-4000-8000-000000000042',
  financeBSession: '90a10000-0000-4000-8000-000000000052',
  supplierB: '90a10000-0000-4000-8000-000000000061',
  dieselB: '90a10000-0000-4000-8000-000000000071',
};

const tokens = {
  supervisor: '90a0-supervisor-token',
  finance: '90a0-finance-token',
  admin: '90a0-admin-token',
  attendant: '90a0-attendant-token',
  financeB: '90a0-finance-b-token',
};

type Json = Record<string, any>;
let client: Sql;

async function command(token: string | null, input: Json, key: string = randomUUID()) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-real-ip': `90a0-${randomUUID()}`,
  });
  if (token)
    for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
  const response = await purchasingCommandPost(
    new Request('http://127.0.0.1:3000/api/purchasing/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }),
  );
  return { status: response.status, json: (await response.json()) as Json };
}

async function read(
  handler: typeof purchasingListGet,
  path: string,
  params: Record<string, string>,
  token: string = tokens.finance,
) {
  const url = new URL(`http://127.0.0.1:3000/api/purchasing/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await handler(new Request(url, { headers: clerkHeaders(token) }));
  return { status: response.status, json: (await response.json()) as Json };
}

const station = { tenantId: ids.tenant, stationId: ids.station };

async function createOrder(overrides: Json = {}, token = tokens.supervisor, key?: string) {
  return command(
    token,
    {
      ...station,
      commandType: 'CreatePurchaseOrder',
      supplierId: ids.supplier,
      orderDate: '2026-10-19',
      expectedDeliveryDate: '2026-10-25',
      lines: [
        { productId: ids.diesel, orderedLitres: '10000.125', agreedUnitPrice: '1.12345678' },
        { productId: ids.petrol, orderedLitres: '5000' },
      ],
      ...overrides,
    },
    key,
  );
}

async function transition(
  commandType: string,
  purchaseOrderId: string,
  expectedVersion: number,
  token: string,
  extra: Json = {},
) {
  return command(token, { ...station, commandType, purchaseOrderId, expectedVersion, ...extra });
}

async function submitted(overrides: Json = {}) {
  const created = await createOrder(overrides);
  expect(created.status).toBe(201);
  const sent = await transition(
    'SubmitPurchaseOrder',
    created.json.purchaseOrderId,
    0,
    tokens.supervisor,
  );
  expect(sent.status).toBe(200);
  return {
    id: created.json.purchaseOrderId as string,
    lines: created.json.lines as Json[],
    version: sent.json.version as number,
  };
}

async function approved(overrides: Json = {}) {
  const order = await submitted(overrides);
  const done = await transition('ApprovePurchaseOrder', order.id, order.version, tokens.finance);
  expect(done.status).toBe(200);
  return { ...order, version: done.json.version as number };
}

async function detail(id: string, token = tokens.finance) {
  const result = await read(
    purchasingDetailGet,
    'detail',
    { ...station, purchaseOrderId: id },
    token,
  );
  expect(result.status).toBe(200);
  return result.json;
}

let deliveryCounter = 0;
async function delivery(
  litres: string,
  status: 'DRAFT' | 'CONFIRMED',
  productId = ids.diesel,
  stationId = ids.station,
  supplierId: string | null = null,
) {
  deliveryCounter += 1;
  const id = randomUUID();
  await client.unsafe(`
    insert into app.fuel_deliveries
      (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date,
       note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by)
    values ('${id}', '${ids.tenant}', '${stationId}', '${productId}', '90A0-DN-${deliveryCounter}-${id.slice(0, 6)}',
       '2026-10-20T07:00:00Z', '2026-10-20', ${litres}, ${litres}, 0, 'DRAFT', '${ids.supervisorMembership}')`);
  // The supplier must be set while the delivery is still a draft: confirmed rows are immutable.
  if (supplierId) await setDeliverySupplier(id, supplierId);
  if (status === 'CONFIRMED') await confirmDelivery(id);
  return id;
}

async function confirmDelivery(id: string) {
  await client.unsafe(
    `update app.fuel_deliveries set status = 'CONFIRMED', confirmed_by = '${ids.financeMembership}', confirmed_at = now() where id = '${id}'`,
  );
}

/** Once the supplier-on-delivery column exists, linkable deliveries must name the supplier. */
async function supplierColumnExists() {
  const probe = await client`select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'fuel_deliveries' and column_name = 'supplier_id'`;
  return probe.length > 0;
}

async function setDeliverySupplier(id: string, supplierId: string | null) {
  const probe = await client`select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'fuel_deliveries' and column_name = 'supplier_id'`;
  if (probe.length === 0) return false;
  await client.unsafe(
    `update app.fuel_deliveries set supplier_id = ${supplierId ? `'${supplierId}'` : 'null'} where id = '${id}'`,
  );
  return true;
}

async function linkable(litres: string, status: 'DRAFT' | 'CONFIRMED', productId = ids.diesel) {
  return delivery(litres, status, productId, ids.station, ids.supplier);
}

async function financialCounts() {
  const rows = await client`
    select
      (select count(*)::int from app.inventory_movements where tenant_id = ${ids.tenant}) as inventory,
      (select count(*)::int from app.cash_movements where tenant_id = ${ids.tenant}) as cash,
      (select count(*)::int from app.supplier_account_movements where tenant_id = ${ids.tenant}) as supplier_ledger,
      (select count(*)::int from app.supplier_documents where tenant_id = ${ids.tenant}) as supplier_documents,
      (select count(*)::int from app.fuel_delivery_allocations where tenant_id = ${ids.tenant}) as allocations`;
  return rows[0]!;
}

describe('purchase orders PostgreSQL persistence', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-90a0-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-90a0-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', '90a0 PO Tenant', '90a0-po-tenant'),
        ('${ids.tenantB}', '90a0 PO Tenant B', '90a0-po-tenant-b')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.supervisor}', '90a0 Supervisor', '90a0-supervisor@example.test'),
        ('${ids.finance}', '90a0 Finance', '90a0-finance@example.test'),
        ('${ids.admin}', '90a0 Admin', '90a0-admin@example.test'),
        ('${ids.attendant}', '90a0 Attendant', '90a0-attendant@example.test'),
        ('${ids.financeB}', '90a0 Finance B', '90a0-finance-b@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisor}', 'ACTIVE'),
        ('${ids.financeMembership}', '${ids.tenant}', '${ids.finance}', 'ACTIVE'),
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendant}', 'ACTIVE'),
        ('${ids.financeBMembership}', '${ids.tenantB}', '${ids.financeB}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', '90a0 Legal'),
        ('${ids.legalB}', '${ids.tenantB}', '90a0 Legal B')
        on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', '90A0ST1', '90a0 Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.station2}', '${ids.tenant}', '${ids.legal}', '90A0ST2', '90a0 Station Two', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationB}', '${ids.tenantB}', '${ids.legalB}', '90A0STB', '90a0 Station B', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.financeMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenantB}', '${ids.financeBMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legalB}', null)
        on conflict do nothing;
      insert into app.suppliers (id, tenant_id, code, legal_name, created_by, updated_by) values
        ('${ids.supplier}', '${ids.tenant}', '90A0-SUP1', '90a0 Supplier One', '${ids.financeMembership}', '${ids.financeMembership}'),
        ('${ids.supplier2}', '${ids.tenant}', '90A0-SUP2', '90a0 Supplier Two', '${ids.financeMembership}', '${ids.financeMembership}'),
        ('${ids.supplierB}', '${ids.tenantB}', '90A0-SUPB', '90a0 Supplier B', '${ids.financeBMembership}', '${ids.financeBMembership}')
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.diesel}', '${ids.tenant}', '90A0-D', '90a0 Diesel'),
        ('${ids.petrol}', '${ids.tenant}', '90A0-P', '90a0 Petrol'),
        ('${ids.dieselB}', '${ids.tenantB}', '90A0-DB', '90a0 Diesel B')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.supervisorSession, tokens.supervisor, ids.supervisor, true);
    await seedClerkSession(client, ids.financeSession, tokens.finance, ids.finance, true);
    await seedClerkSession(client, ids.adminSession, tokens.admin, ids.admin, true);
    await seedClerkSession(client, ids.attendantSession, tokens.attendant, ids.attendant, true);
    await seedClerkSession(client, ids.financeBSession, tokens.financeB, ids.financeB, true);
    for (const [session, tenant] of [
      [ids.supervisorSession, ids.tenant],
      [ids.financeSession, ids.tenant],
      [ids.adminSession, ids.tenant],
      [ids.attendantSession, ids.tenant],
      [ids.financeBSession, ids.tenantB],
    ] as const) {
      await seedActiveStepUp(client, session, tenant);
    }
  });

  afterAll(async () => client?.end());

  it('denies unauthenticated callers and enforces a permission per command', async () => {
    expect((await createOrder({}, '')).status).toBe(401);
    expect((await createOrder({}, tokens.attendant)).status).toBe(403);
    const order = await submitted();
    // Approve, cancel, and close need purchase_order.approve / purchase_order.cancel.
    for (const [type, extra] of [
      ['ApprovePurchaseOrder', {}],
      ['CancelPurchaseOrder', { reason: 'nope' }],
      ['ClosePurchaseOrder', { reason: 'nope' }],
    ] as const) {
      const denied = await transition(type, order.id, order.version, tokens.supervisor, extra);
      expect(denied.status, type).toBe(403);
    }
    // Create-level commands are denied to a role without purchase_order.create.
    for (const [type, extra] of [
      ['SubmitPurchaseOrder', {}],
      [
        'AmendPurchaseOrder',
        { reason: 'x', lines: [{ productId: ids.diesel, orderedLitres: '1' }] },
      ],
    ] as const) {
      const denied = await transition(type, order.id, order.version, tokens.attendant, extra);
      expect(denied.status, type).toBe(403);
    }
    const linkDenied = await command(tokens.attendant, {
      ...station,
      commandType: 'LinkDeliveryToPurchaseOrder',
      purchaseOrderId: order.id,
      purchaseOrderLineId: order.lines[0]!.lineId,
      deliveryId: randomUUID(),
    });
    expect(linkDenied.status).toBe(403);
    const unlinkDenied = await command(tokens.attendant, {
      ...station,
      commandType: 'UnlinkDeliveryFromPurchaseOrder',
      purchaseOrderId: order.id,
      deliveryId: randomUUID(),
      reason: 'x',
    });
    expect(unlinkDenied.status).toBe(403);
    const readDenied = await read(purchasingListGet, 'list', station, tokens.attendant);
    expect(readDenied.status).toBe(403);
    // Nothing the denied callers tried left the order changed.
    expect((await detail(order.id)).version).toBe(order.version);
  });

  it('stores exact decimals and rejects over-precise or non-string values', async () => {
    const created = await createOrder();
    expect(created.status).toBe(201);
    expect(created.json.state).toBe('DRAFT');
    expect(created.json.lines[0]).toMatchObject({
      orderedLitres: '10000.125',
      agreedUnitPrice: '1.12345678',
      lineNumber: 1,
    });
    expect(created.json.lines[1]).toMatchObject({
      orderedLitres: '5000.000',
      agreedUnitPrice: null,
    });
    for (const lines of [
      [{ productId: ids.diesel, orderedLitres: '1.0001' }],
      [{ productId: ids.diesel, orderedLitres: 100 }],
      [{ productId: ids.diesel, orderedLitres: '0' }],
      [{ productId: ids.diesel, orderedLitres: '1', agreedUnitPrice: '1.123456789' }],
      [],
    ]) {
      expect((await createOrder({ lines })).status).toBe(400);
    }
    expect((await createOrder({ expectedDeliveryDate: '2026-10-01' })).status).toBe(400);
    const duplicateNumber = await createOrder({ orderNumber: 'PO-90A0-DUP' });
    expect(duplicateNumber.status).toBe(201);
    expect((await createOrder({ orderNumber: 'PO-90A0-DUP' })).status).toBe(409);
  });

  it('refuses another tenant, another tenant supplier and product, and cross-station access', async () => {
    const own = await createOrder();
    expect(own.status).toBe(201);
    expect((await createOrder({ supplierId: ids.supplierB })).status).toBe(404);
    expect(
      (await createOrder({ lines: [{ productId: ids.dieselB, orderedLitres: '5' }] })).status,
    ).toBe(404);
    // Tenant B's finance user cannot act inside tenant A, by command or by read.
    const foreignCommand = await command(tokens.financeB, {
      ...station,
      commandType: 'ApprovePurchaseOrder',
      purchaseOrderId: own.json.purchaseOrderId,
      expectedVersion: 0,
    });
    expect(foreignCommand.status).toBe(403);
    expect(
      (
        await read(
          purchasingDetailGet,
          'detail',
          { ...station, purchaseOrderId: own.json.purchaseOrderId },
          tokens.financeB,
        )
      ).status,
    ).toBe(403);
    // Inside their own tenant the order does not exist.
    const ownTenantRead = await read(
      purchasingDetailGet,
      'detail',
      { tenantId: ids.tenantB, stationId: ids.stationB, purchaseOrderId: own.json.purchaseOrderId },
      tokens.financeB,
    );
    expect(ownTenantRead.status).toBe(404);
    // Another station of the same tenant cannot see or move it.
    const otherStation = await command(tokens.finance, {
      tenantId: ids.tenant,
      stationId: ids.station2,
      commandType: 'SubmitPurchaseOrder',
      purchaseOrderId: own.json.purchaseOrderId,
      expectedVersion: 0,
    });
    expect(otherStation.status).toBe(404);
    const list = await read(purchasingListGet, 'list', {
      tenantId: ids.tenant,
      stationId: ids.station2,
    });
    expect(list.json.orders).toEqual([]);
  });

  it('lets a sole approver approve their own order, but only with a reason that is audited', async () => {
    await client`update app.memberships set status = 'DISABLED' where id = ${ids.adminMembership}`;
    try {
      const own = await createOrder({}, tokens.finance);
      const ownId = own.json.purchaseOrderId as string;
      await transition('SubmitPurchaseOrder', ownId, 0, tokens.finance);
      // Nobody else can approve, so the screen shows a reason box instead of hiding the button.
      const view = await detail(ownId, tokens.finance);
      expect(view.approvalBlockedForYou).toBe(false);
      expect(view.approvalIsSelf).toBe(true);

      const noReason = await transition('ApprovePurchaseOrder', ownId, 1, tokens.finance);
      expect(noReason.status).toBeGreaterThanOrEqual(400);
      expect(noReason.status).toBeLessThan(500);
      expect(String(noReason.json.message)).toMatch(/approving it yourself/);
      expect((await detail(ownId, tokens.finance)).state).toBe('SUBMITTED');

      const approved = await transition('ApprovePurchaseOrder', ownId, 1, tokens.finance, {
        selfApprovalReason: 'I am the only approver at this company',
      });
      expect(approved.json).toMatchObject({ state: 'APPROVED' });
      const audit = await client<{ reason: string | null }[]>`
        select details->>'reason' as reason from platform.security_events
        where tenant_id = ${ids.tenant} and details->>'subjectId' = ${ownId}
          and event_code = 'PURCHASE_ORDER.APPROVED'
      `;
      expect(audit.map((row) => row.reason)).toContain('I am the only approver at this company');
    } finally {
      await client`update app.memberships set status = 'ACTIVE' where id = ${ids.adminMembership}`;
    }
  });

  it('follows the state machine with named commands and optimistic versions', async () => {
    const created = await createOrder();
    const id = created.json.purchaseOrderId as string;
    // Cannot approve a draft, nor close it.
    expect((await transition('ApprovePurchaseOrder', id, 0, tokens.finance)).status).toBe(409);
    expect(
      (await transition('ClosePurchaseOrder', id, 0, tokens.finance, { reason: 'x' })).status,
    ).toBe(409);
    // Stale version.
    expect((await transition('SubmitPurchaseOrder', id, 5, tokens.supervisor)).status).toBe(409);
    const sent = await transition('SubmitPurchaseOrder', id, 0, tokens.supervisor);
    expect(sent.json).toMatchObject({ state: 'SUBMITTED', version: 1 });
    expect((await transition('SubmitPurchaseOrder', id, 1, tokens.supervisor)).status).toBe(409);
    // The submitter cannot approve while another approver exists, a different approver can.
    const own = await createOrder({}, tokens.finance);
    const ownId = own.json.purchaseOrderId as string;
    await transition('SubmitPurchaseOrder', ownId, 0, tokens.finance);
    // The screen is told the same thing the command enforces.
    expect((await detail(ownId, tokens.finance)).approvalBlockedForYou).toBe(true);
    expect((await detail(ownId, tokens.admin)).approvalBlockedForYou).toBe(false);
    const self = await transition('ApprovePurchaseOrder', ownId, 1, tokens.finance);
    expect(self.status).toBe(403);
    const other = await transition('ApprovePurchaseOrder', ownId, 1, tokens.admin);
    expect(other.json).toMatchObject({ state: 'APPROVED', version: 2 });
    const done = await transition('ApprovePurchaseOrder', id, 1, tokens.finance);
    expect(done.json.state).toBe('APPROVED');
    // PARTIALLY_RECEIVED and RECEIVED cannot be set by any command.
    const sneaky = await command(tokens.finance, {
      ...station,
      commandType: 'ApprovePurchaseOrder',
      purchaseOrderId: id,
      expectedVersion: 2,
      state: 'RECEIVED',
    });
    expect(sneaky.status).toBe(409);
    expect((await detail(id)).state).toBe('APPROVED');
    // Cancel then everything is terminal.
    const cancelled = await transition('CancelPurchaseOrder', id, 2, tokens.finance, {
      reason: 'Supplier withdrew',
    });
    expect(cancelled.json.state).toBe('CANCELLED');
    expect(
      (
        await transition('AmendPurchaseOrder', id, 3, tokens.supervisor, {
          reason: 'late',
          lines: [
            { lineId: created.json.lines[0].lineId, productId: ids.diesel, orderedLitres: '1' },
          ],
        })
      ).status,
    ).toBe(409);
    expect((await transition('SubmitPurchaseOrder', id, 3, tokens.supervisor)).status).toBe(409);
    expect(
      (await transition('ClosePurchaseOrder', id, 3, tokens.finance, { reason: 'x' })).status,
    ).toBe(409);
    // A reason is mandatory to cancel.
    const noReason = await transition('CancelPurchaseOrder', ownId, 2, tokens.finance);
    expect(noReason.status).toBe(400);
    // The database refuses an illegal jump even if the application is bypassed.
    await expect(
      client`update app.purchase_orders set state = 'DRAFT' where id = ${id}`,
    ).rejects.toThrow(/terminal/);
    await expect(
      client`update app.purchase_orders set state = 'CLOSED', closed_by = ${ids.financeMembership}, closed_at = now(), close_reason = 'x' where id = ${ownId} and state = 'SUBMITTED'`,
    ).resolves.toBeDefined();
  });

  it('amends by new revision, keeps every earlier version, and sends approved orders back for approval', async () => {
    const order = await approved();
    expect(order.lines).toHaveLength(2);
    const [diesel, petrol] = order.lines as Json[];
    const amended = await transition(
      'AmendPurchaseOrder',
      order.id,
      order.version,
      tokens.supervisor,
      {
        reason: 'Supplier agreed a larger load and a new price',
        expectedDeliveryDate: '2026-10-28',
        lines: [
          {
            lineId: diesel!.lineId,
            productId: ids.diesel,
            orderedLitres: '12000.500',
            agreedUnitPrice: '1.2',
          },
          { productId: ids.diesel, orderedLitres: '300' },
        ],
      },
    );
    expect(amended.status).toBe(200);
    expect(amended.json).toMatchObject({
      state: 'SUBMITTED',
      revisionNo: 2,
      version: order.version + 1,
    });
    const body = await detail(order.id);
    const active = body.lines.filter((line: Json) => line.status === 'ACTIVE');
    expect(active.map((line: Json) => line.orderedLitres)).toEqual(['12000.500', '300.000']);
    expect(active[0].agreedUnitPrice).toBe('1.20000000');
    expect(body.lines.find((line: Json) => line.lineId === petrol!.lineId).status).toBe('REMOVED');
    expect(body.lines.find((line: Json) => line.lineId === diesel!.lineId).lineNumber).toBe(1);
    // Revision 1 still shows the original terms exactly.
    expect(body.revisions.map((revision: Json) => revision.revisionNo)).toEqual([1, 2]);
    const first = body.revisions[0].snapshot;
    expect(first.state).toBe('DRAFT');
    expect(first.lines.map((line: Json) => line.orderedLitres)).toEqual(['10000.125', '5000.000']);
    expect(first.lines[0].agreedUnitPrice).toBe('1.12345678');
    expect(body.revisions[1].reason).toBe('Supplier agreed a larger load and a new price');
    expect(body.revisions[1].snapshot.expectedDeliveryDate).toBe('2026-10-28');
    // The amender is now the submitter: finance approves, but the amender (also an approver
    // here) could not approve their own change while another approver exists.
    expect(body.state).toBe('SUBMITTED');
    expect(body.approvedAt).toBeNull();
    const reapproved = await transition(
      'ApprovePurchaseOrder',
      order.id,
      order.version + 1,
      tokens.admin,
    );
    expect(reapproved.json.state).toBe('APPROVED');
    // An existing line's product cannot be swapped, and revisions are append-only.
    const swap = await transition(
      'AmendPurchaseOrder',
      order.id,
      order.version + 2,
      tokens.supervisor,
      {
        reason: 'swap',
        lines: [{ lineId: diesel!.lineId, productId: ids.petrol, orderedLitres: '1' }],
      },
    );
    expect(swap.status).toBe(400);
    await expect(
      client`update app.purchase_order_lines set product_id = ${ids.petrol} where id = ${diesel!.lineId}`,
    ).rejects.toThrow(/immutable/);
    // A line with linked deliveries cannot be removed by amendment.
    const linked = await approved();
    const deliveryId = await linkable('100', 'DRAFT');
    const link = await command(tokens.supervisor, {
      ...station,
      commandType: 'LinkDeliveryToPurchaseOrder',
      purchaseOrderId: linked.id,
      purchaseOrderLineId: linked.lines[0]!.lineId,
      deliveryId,
    });
    expect(link.status).toBe(201);
    const removal = await transition(
      'AmendPurchaseOrder',
      linked.id,
      linked.version,
      tokens.supervisor,
      {
        reason: 'drop diesel',
        lines: [{ lineId: linked.lines[1]!.lineId, productId: ids.petrol, orderedLitres: '5000' }],
      },
    );
    expect(removal.status).toBe(422);
  });

  it('derives received state, over-receipt, and short-close from confirmed linked deliveries', async () => {
    const order = await approved({
      lines: [
        { productId: ids.diesel, orderedLitres: '10000' },
        { productId: ids.petrol, orderedLitres: '2000' },
      ],
    });
    const [dieselLine, petrolLine] = order.lines as Json[];
    const before = await financialCounts();
    const link = (lineId: string, deliveryId: string, token = tokens.supervisor) =>
      command(token, {
        ...station,
        commandType: 'LinkDeliveryToPurchaseOrder',
        purchaseOrderId: order.id,
        purchaseOrderLineId: lineId,
        deliveryId,
      });
    expect((await detail(order.id)).displayState).toBe('APPROVED');

    const first = await linkable('4000.250', 'CONFIRMED');
    const draft = await linkable('900', 'DRAFT');
    expect((await link(dieselLine!.lineId, first)).status).toBe(201);
    expect((await link(dieselLine!.lineId, draft)).status).toBe(201);
    let body = await detail(order.id);
    expect(body.displayState).toBe('PARTIALLY_RECEIVED');
    expect(body.lines[0]).toMatchObject({
      receivedLitres: '4000.250',
      pendingLitres: '900.000',
      openLitres: '5999.750',
      overReceiptLitres: '0.000',
      receiptStatus: 'PARTIALLY_RECEIVED',
    });
    expect(body.lines[1].receiptStatus).toBe('NOT_RECEIVED');
    expect(body.deliveries).toHaveLength(2);

    // Confirming the draft delivery moves the derived figure without any order command.
    await confirmDelivery(draft);
    body = await detail(order.id);
    expect(body.lines[0]).toMatchObject({ receivedLitres: '4900.250', pendingLitres: '0.000' });
    expect(body.version).toBe(order.version);

    // Rejected links: wrong product, already linked, other station, cancelled delivery, wrong line.
    const wrongProduct = await linkable('10', 'CONFIRMED', ids.petrol);
    expect((await link(dieselLine!.lineId, wrongProduct)).status).toBe(422);
    expect((await link(dieselLine!.lineId, first)).status).toBe(409);
    const elsewhere = await delivery('10', 'CONFIRMED', ids.diesel, ids.station2);
    expect((await link(dieselLine!.lineId, elsewhere)).status).toBe(422);
    const cancelledDelivery = await linkable('10', 'DRAFT');
    await client`update app.fuel_deliveries set status = 'CANCELLED' where id = ${cancelledDelivery}`;
    expect((await link(dieselLine!.lineId, cancelledDelivery)).status).toBe(422);
    expect((await link(randomUUID(), await linkable('10', 'CONFIRMED'))).status).toBe(404);
    // The unconfirmed-supplier check applies once deliveries carry a supplier.
    const wrongSupplier = await delivery('10', 'CONFIRMED', ids.diesel, ids.station, ids.supplier2);
    if (await supplierColumnExists()) {
      expect((await link(dieselLine!.lineId, wrongSupplier)).status).toBe(422);
    }
    // Another order cannot take an already linked delivery either.
    const second = await approved();
    const stolen = await command(tokens.supervisor, {
      ...station,
      commandType: 'LinkDeliveryToPurchaseOrder',
      purchaseOrderId: second.id,
      purchaseOrderLineId: second.lines[0]!.lineId,
      deliveryId: first,
    });
    expect(stolen.status).toBe(409);

    // Receive the rest plus 0.3 L extra: over-receipt is a fact, not a block.
    const rest = await linkable('5100.050', 'CONFIRMED');
    expect((await link(dieselLine!.lineId, rest)).status).toBe(201);
    body = await detail(order.id);
    expect(body.lines[0]).toMatchObject({
      receivedLitres: '10000.300',
      overReceiptLitres: '0.300',
      openLitres: '0.000',
      receiptStatus: 'RECEIVED',
    });
    expect(body.displayState).toBe('PARTIALLY_RECEIVED');
    const petrolDelivery = await linkable('1500', 'CONFIRMED', ids.petrol);
    expect((await link(petrolLine!.lineId, petrolDelivery)).status).toBe(201);

    // Unlinking is a named, reasoned command that updates the derived figures.
    const unlink = await command(tokens.supervisor, {
      ...station,
      commandType: 'UnlinkDeliveryFromPurchaseOrder',
      purchaseOrderId: order.id,
      deliveryId: petrolDelivery,
      reason: 'Linked to the wrong order',
    });
    expect(unlink.status).toBe(200);
    expect((await detail(order.id)).lines[1].receivedLitres).toBe('0.000');
    expect((await link(petrolLine!.lineId, petrolDelivery)).status).toBe(201);

    // Close records the short-closed litres and the order becomes terminal.
    const closed = await transition('ClosePurchaseOrder', order.id, order.version, tokens.finance, {
      reason: 'Petrol shortfall accepted',
    });
    expect(closed.status).toBe(200);
    expect(closed.json.shortClosed).toEqual([
      expect.objectContaining({ lineNumber: 1, shortClosedLitres: '0.000' }),
      expect.objectContaining({ lineNumber: 2, shortClosedLitres: '500.000' }),
    ]);
    body = await detail(order.id);
    expect(body).toMatchObject({
      state: 'CLOSED',
      displayState: 'CLOSED',
      closeReason: 'Petrol shortfall accepted',
    });
    expect(body.lines[1]).toMatchObject({ shortClosedLitres: '500.000', openLitres: '0.000' });
    // Fuel already received means the order must be closed, never cancelled.
    const received = await approved();
    const receivedDelivery = await linkable('50', 'CONFIRMED');
    await command(tokens.supervisor, {
      ...station,
      commandType: 'LinkDeliveryToPurchaseOrder',
      purchaseOrderId: received.id,
      purchaseOrderLineId: received.lines[0]!.lineId,
      deliveryId: receivedDelivery,
    });
    expect(
      (
        await transition('CancelPurchaseOrder', received.id, received.version, tokens.finance, {
          reason: 'x',
        })
      ).status,
    ).toBe(422);
    await expect(
      client`update app.purchase_orders set state = 'CANCELLED', cancelled_by = ${ids.financeMembership}, cancelled_at = now(), cancellation_reason = 'x' where id = ${received.id}`,
    ).rejects.toThrow(/closed, not cancelled/);

    // The order lifecycle never wrote an inventory, cash, or supplier-ledger row.
    expect(await financialCounts()).toEqual(before);
    // The delivery's physical litres are untouched.
    const litres =
      await client`select actual_quantity_litres::text as litres from app.fuel_deliveries where id = ${first}`;
    expect(litres[0]!.litres).toBe('4000.250');
  });

  it('lists orders and serves reference data', async () => {
    const list = await read(purchasingListGet, 'list', { ...station, state: 'APPROVED' });
    expect(list.status).toBe(200);
    expect(list.json.orders.length).toBeGreaterThan(0);
    expect(list.json.orders.every((order: Json) => order.state === 'APPROVED')).toBe(true);
    const reference = await read(purchasingReferenceGet, 'reference', station, tokens.supervisor);
    expect(reference.status).toBe(200);
    expect(reference.json.suppliers.map((row: Json) => row.id)).toContain(ids.supplier);
    expect(reference.json.suppliers.map((row: Json) => row.id)).not.toContain(ids.supplierB);
    expect(reference.json.products.map((row: Json) => row.id)).not.toContain(ids.dieselB);
    expect(
      (await read(purchasingDetailGet, 'detail', { ...station, purchaseOrderId: 'nope' })).status,
    ).toBe(400);
  });

  it('is idempotent on retry and rejects a changed payload under the same key', async () => {
    const key = `90a0-${randomUUID()}`;
    const first = await createOrder({ orderNumber: 'PO-90A0-IDEM' }, tokens.supervisor, key);
    const retry = await createOrder({ orderNumber: 'PO-90A0-IDEM' }, tokens.supervisor, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.json).toEqual(first.json);
    const count =
      await client`select count(*)::int as n from app.purchase_orders where order_number = 'PO-90A0-IDEM'`;
    expect(count[0]!.n).toBe(1);
    const changed = await createOrder(
      { orderNumber: 'PO-90A0-IDEM', lines: [{ productId: ids.diesel, orderedLitres: '1' }] },
      tokens.supervisor,
      key,
    );
    expect(changed.status).toBe(409);
    expect(changed.json.error).toBe('IDEMPOTENCY_CONFLICT');
    // A retried transition does not bump the version twice.
    const order = await createOrder();
    const id = order.json.purchaseOrderId as string;
    const sendKey = randomUUID();
    const send = () =>
      command(
        tokens.supervisor,
        { ...station, commandType: 'SubmitPurchaseOrder', purchaseOrderId: id, expectedVersion: 0 },
        sendKey,
      );
    const one = await send();
    const two = await send();
    expect(two.json).toEqual(one.json);
    expect((await detail(id)).version).toBe(1);
    // A missing key is refused.
    const noKey = await purchasingCommandPost(
      new Request('http://127.0.0.1:3000/api/purchasing/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...clerkHeaders(tokens.supervisor),
          'x-real-ip': `90a0-${randomUUID()}`,
        },
        body: JSON.stringify({
          ...station,
          commandType: 'SubmitPurchaseOrder',
          purchaseOrderId: id,
          expectedVersion: 1,
        }),
      }),
    );
    expect(noKey.status).toBe(400);
  });

  it('lets exactly one of two concurrent approvals win', async () => {
    const order = await submitted();
    const results = await Promise.all([
      transition('ApprovePurchaseOrder', order.id, order.version, tokens.finance),
      transition('ApprovePurchaseOrder', order.id, order.version, tokens.admin),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const body = await detail(order.id);
    expect(body.state).toBe('APPROVED');
    expect(body.version).toBe(order.version + 1);
    const events = await client`
      select count(*)::int as n from platform.security_events
      where tenant_id = ${ids.tenant} and event_code = 'PURCHASE_ORDER.APPROVED' and details->>'subjectId' = ${order.id}`;
    expect(events[0]!.n).toBe(1);
  });

  it('enforces tenant-safe keys and tenant row-level security for the runtime role', async () => {
    // Composite tenant keys: another tenant's supplier or product cannot be referenced.
    await expect(
      client`insert into app.purchase_orders (tenant_id, legal_entity_id, station_id, supplier_id, order_number, order_date, created_by)
        values (${ids.tenant}, ${ids.legal}, ${ids.station}, ${ids.supplierB}, 'PO-90A0-FK', '2026-10-19', ${ids.financeMembership})`,
    ).rejects.toThrow();
    const sample = await createOrder();
    await expect(
      client`insert into app.purchase_order_lines (tenant_id, purchase_order_id, line_number, product_id, ordered_litres)
        values (${ids.tenant}, ${sample.json.purchaseOrderId}, 9, ${ids.dieselB}, 5)`,
    ).rejects.toThrow();

    const asTenant = async <T>(
      tenantId: string,
      membershipId: string,
      actorId: string,
      work: (sql: Sql) => Promise<T>,
    ): Promise<T> => {
      await client.unsafe('set role app_runtime');
      try {
        await client`select set_config('app.tenant_id', ${tenantId}, false)`;
        await client`select set_config('app.actor_id', ${actorId}, false)`;
        await client`select set_config('app.membership_id', ${membershipId}, false)`;
        return await work(client);
      } finally {
        await client.unsafe('reset role');
        await client`reset app.tenant_id`;
        await client`reset app.actor_id`;
        await client`reset app.membership_id`;
      }
    };
    for (const table of [
      'purchase_orders',
      'purchase_order_lines',
      'purchase_order_revisions',
      'purchase_order_delivery_links',
    ]) {
      const visibleToB = await asTenant(ids.tenantB, ids.financeBMembership, ids.financeB, (sql) =>
        sql.unsafe(`select tenant_id from app.${table}`),
      );
      expect(visibleToB.every((row) => row.tenant_id === ids.tenantB)).toBe(true);
      await client.unsafe('set role app_runtime');
      try {
        const none = await client.unsafe(`select count(*)::int as n from app.${table}`);
        expect(none[0]!.n).toBe(0);
      } finally {
        await client.unsafe('reset role');
      }
    }
    const visibleToA = await asTenant(
      ids.tenant,
      ids.financeMembership,
      ids.finance,
      (sql) => sql`select count(*)::int as n from app.purchase_orders`,
    );
    expect(visibleToA[0]!.n).toBeGreaterThan(0);
    await expect(
      asTenant(
        ids.tenantB,
        ids.financeBMembership,
        ids.financeB,
        (sql) =>
          sql`insert into app.purchase_orders (tenant_id, legal_entity_id, station_id, supplier_id, order_number, order_date, created_by)
            values (${ids.tenant}, ${ids.legal}, ${ids.station}, ${ids.supplier}, 'PO-90A0-RLS', '2026-10-19', ${ids.financeBMembership})`,
      ),
    ).rejects.toThrow();
    const crossUpdate = await asTenant(
      ids.tenantB,
      ids.financeBMembership,
      ids.financeB,
      (sql) => sql`update app.purchase_orders set notes = 'hijack' where tenant_id = ${ids.tenant}`,
    );
    expect(crossUpdate.count).toBe(0);
    // Facts are append-only for the runtime role: no delete, no revision rewrite.
    await expect(
      asTenant(
        ids.tenant,
        ids.financeMembership,
        ids.finance,
        (sql) => sql`delete from app.purchase_orders`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(
        ids.tenant,
        ids.financeMembership,
        ids.finance,
        (sql) => sql`update app.purchase_order_revisions set reason = 'x'`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('writes an audit event for every command and no financial rows', async () => {
    const rows = await client`
      select event_code, count(*)::int as n from platform.security_events
      where tenant_id = ${ids.tenant} and event_code like 'PURCHASE_ORDER.%'
      group by event_code`;
    const codes = new Map(rows.map((row) => [row.event_code as string, row.n as number]));
    for (const code of [
      'PURCHASE_ORDER.CREATED',
      'PURCHASE_ORDER.SUBMITTED',
      'PURCHASE_ORDER.APPROVED',
      'PURCHASE_ORDER.AMENDED',
      'PURCHASE_ORDER.CANCELLED',
      'PURCHASE_ORDER.CLOSED',
      'PURCHASE_ORDER.DELIVERY_LINKED',
      'PURCHASE_ORDER.DELIVERY_UNLINKED',
    ]) {
      expect(codes.get(code) ?? 0, code).toBeGreaterThan(0);
    }
    // Denied and failed commands leave no audit event: created events equal order rows.
    const orders =
      await client`select count(*)::int as n from app.purchase_orders where tenant_id = ${ids.tenant}`;
    expect(codes.get('PURCHASE_ORDER.CREATED')).toBe(orders[0]!.n);
    // No order command ever touched inventory, cash, or the supplier ledger for this tenant.
    expect(await financialCounts()).toEqual({
      inventory: 0,
      cash: 0,
      supplier_ledger: 0,
      supplier_documents: 0,
      allocations: 0,
    });
  });
});
