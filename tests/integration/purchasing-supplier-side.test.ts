import {
  seedClerkSession,
  seedActiveStepUp,
  setFixtureStrongAuthentication,
  clerkHeaders,
} from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as supplierCommandPost } from '../../src/app/api/suppliers/commands/route';
import { GET as exposureGet } from '../../src/app/api/suppliers/exposure/route';
import { GET as varianceGet } from '../../src/app/api/suppliers/variance/route';
import { GET as policyGet } from '../../src/app/api/suppliers/policy/route';
import { POST as inventoryCommandPost } from '../../src/app/api/inventory/commands/route';
import { GET as deliverySuppliersGet } from '../../src/app/api/inventory/suppliers/route';
import { POST as purchasingCommandPost } from '../../src/app/api/purchasing/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for purchasing supplier-side integration tests.');
}

// Fixture prefix 90b0 (unique across tests/integration).
const P = '90b00000-0000-4000-8000';
const ids = {
  tenant: `${P}-000000000001`,
  legal: `${P}-000000000011`,
  station: `${P}-000000000021`,
  tank: `${P}-000000000061`,
  product: `${P}-000000000051`,
  productOther: `${P}-000000000052`,
  finance: `${P}-000000000031`,
  financeMembership: `${P}-000000000041`,
  financeSession: `${P}-000000000071`,
  finance2: `${P}-000000000032`,
  finance2Membership: `${P}-000000000042`,
  finance2Session: `${P}-000000000072`,
  admin: `${P}-000000000033`,
  adminMembership: `${P}-000000000043`,
  adminSession: `${P}-000000000073`,
  supervisor: `${P}-000000000034`,
  supervisorMembership: `${P}-000000000044`,
  supervisorSession: `${P}-000000000074`,
  tenantB: '90b10000-0000-4000-8000-000000000001',
  legalB: '90b10000-0000-4000-8000-000000000011',
  stationB: '90b10000-0000-4000-8000-000000000021',
  financeB: '90b10000-0000-4000-8000-000000000031',
  financeBMembership: '90b10000-0000-4000-8000-000000000041',
  financeBSession: '90b10000-0000-4000-8000-000000000071',
};
const tokens = {
  finance: '90b0-finance-token',
  finance2: '90b0-finance2-token',
  admin: '90b0-admin-token',
  supervisor: '90b0-supervisor-token',
  financeB: '90b0-finance-b-token',
};

type Json = Record<string, any>;
let client: Sql;
let noteCounter = 0;
let refCounter = 0;

const entity = { tenantId: ids.tenant, legalEntityId: ids.legal };
const station = { tenantId: ids.tenant, stationId: ids.station };

async function call(
  handler: (request: Request) => Promise<Response>,
  url: string,
  token: string | null,
  input: Json,
  key: string = randomUUID(),
) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-real-ip': `90b0-${randomUUID()}`,
  });
  if (token)
    for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
  const response = await handler(
    new Request(url, { method: 'POST', headers, body: JSON.stringify(input) }),
  );
  return { status: response.status, json: (await response.json()) as Json };
}

const supplierCmd = (token: string | null, input: Json, key?: string) =>
  call(supplierCommandPost, 'http://127.0.0.1:3000/api/suppliers/commands', token, input, key);
const inventoryCmd = (token: string | null, input: Json, key?: string) =>
  call(inventoryCommandPost, 'http://127.0.0.1:3000/api/inventory/commands', token, input, key);

async function read(
  handler: (request: Request) => Promise<Response>,
  path: string,
  params: Record<string, string>,
  token: string = tokens.finance,
) {
  const url = new URL(`http://127.0.0.1:3000/api/suppliers/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await handler(new Request(url, { headers: clerkHeaders(token) }));
  return { status: response.status, json: (await response.json()) as Json };
}

const exposure = (params: Record<string, string> = {}, token = tokens.finance) =>
  read(exposureGet, 'exposure', { ...entity, ...params }, token);
const variance = (params: Record<string, string> = {}, token = tokens.finance) =>
  read(varianceGet, 'variance', { ...entity, ...params }, token);
const policyRead = (params: Record<string, string> = {}, token = tokens.finance) =>
  read(policyGet, 'policy', { ...entity, ...params }, token);

async function createSupplier(code: string, token = tokens.finance, scope: Json = entity) {
  const result = await supplierCmd(token, {
    ...scope,
    commandType: 'CreateSupplier',
    code,
    legalName: `${code} Fuel Supplier`,
  });
  expect(result.status).toBe(201);
  return result.json.supplierId as string;
}

async function createDelivery(
  supplierId: string,
  overrides: Json = {},
  litres = '1000.000',
  token = tokens.admin,
) {
  noteCounter += 1;
  const result = await inventoryCmd(token, {
    ...station,
    commandType: 'CreateDelivery',
    productId: ids.product,
    supplierId,
    deliveryNoteNumber: `90B0-DN-${noteCounter}`,
    deliveredAt: '2026-10-01T08:00:00+02:00',
    noteQuantityLitres: litres,
    actualQuantityLitres: litres,
    allocations: [{ tankId: ids.tank, quantityLitres: litres }],
    ...overrides,
  });
  return result;
}

async function confirmedDelivery(supplierId: string, overrides: Json = {}, litres = '1000.000') {
  const created = await createDelivery(supplierId, overrides, litres);
  expect(created.status).toBe(200);
  const confirmed = await inventoryCmd(tokens.admin, {
    ...station,
    commandType: 'ConfirmDelivery',
    deliveryId: created.json.deliveryId,
  });
  expect(confirmed.status).toBe(200);
  return {
    deliveryId: created.json.deliveryId as string,
    allocationId: (created.json.allocationIds as string[])[0]!,
  };
}

function invoice(supplierId: string, overrides: Json = {}) {
  refCounter += 1;
  return {
    ...entity,
    commandType: 'SubmitSupplierDocument',
    supplierId,
    documentType: 'INVOICE',
    referenceNumber: `90B0-INV-${refCounter}`,
    documentDate: '2026-10-05',
    ...overrides,
  };
}

const fuelLine = (
  deliveryId: string,
  quantity = '1000.000',
  unitPrice = '1.2',
  extra: Json = {},
) => ({
  productId: ids.product,
  description: 'Diesel',
  quantity,
  unitPrice,
  deliveryId,
  ...extra,
});

async function post(
  documentId: string,
  token = tokens.finance,
  extra: Json = {},
  expectedVersion = 0,
) {
  return supplierCmd(token, {
    ...entity,
    commandType: 'PostSupplierDocument',
    documentId,
    expectedVersion,
    ...extra,
  });
}

async function setPolicy(fields: Json, supplierId?: string, token = tokens.admin) {
  const current = await policyRead(supplierId ? { supplierId } : {});
  const existing = supplierId ? current.json.supplierOverride : current.json.tenantPolicy;
  return supplierCmd(token, {
    ...entity,
    commandType: 'SetPurchasingPolicy',
    ...(supplierId ? { supplierId } : {}),
    ...(existing ? { expectedVersion: existing.version } : {}),
    reason: 'integration test',
    ...fields,
  });
}

async function a4Snapshot() {
  const rows = await client`
    select
      (select count(*)::int from app.fuel_deliveries where tenant_id = ${ids.tenant}) as deliveries,
      (select count(*)::int from app.fuel_delivery_allocations where tenant_id = ${ids.tenant}) as allocations,
      (select count(*)::int from app.inventory_movements where tenant_id = ${ids.tenant}) as movements,
      (select count(*)::int from app.inventory_cost_events where tenant_id = ${ids.tenant}) as cost_events,
      (select coalesce(sum(actual_quantity_litres), 0)::text from app.fuel_deliveries where tenant_id = ${ids.tenant}) as litres,
      (select coalesce(sum(quantity_litres), 0)::text from app.inventory_movements where tenant_id = ${ids.tenant}) as movement_litres`;
  return rows[0]!;
}

async function auditCount(code: string): Promise<number> {
  const rows = await client`
    select count(*)::int as n from platform.security_events
    where tenant_id = ${ids.tenant} and event_code = ${code}`;
  return rows[0]!.n as number;
}

describe('ADR-018 supplier side: delivery supplier, invoice lines, coverage and policy', () => {
  let s1: string;
  let s2: string;
  let sB: string;

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-90b0-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-90b0-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', '90B0 Purchasing Tenant', '90b0-purchasing'),
        ('${ids.tenantB}', '90B0 Purchasing Tenant B', '90b0-purchasing-b')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.finance}', '90B0 Finance', '90b0-finance@example.test'),
        ('${ids.finance2}', '90B0 Finance Two', '90b0-finance2@example.test'),
        ('${ids.admin}', '90B0 Admin', '90b0-admin@example.test'),
        ('${ids.supervisor}', '90B0 Supervisor', '90b0-supervisor@example.test'),
        ('${ids.financeB}', '90B0 Finance B', '90b0-finance-b@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.financeMembership}', '${ids.tenant}', '${ids.finance}', 'ACTIVE'),
        ('${ids.finance2Membership}', '${ids.tenant}', '${ids.finance2}', 'ACTIVE'),
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE'),
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisor}', 'ACTIVE'),
        ('${ids.financeBMembership}', '${ids.tenantB}', '${ids.financeB}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', '90B0 Legal'),
        ('${ids.legalB}', '${ids.tenantB}', '90B0 Legal B')
        on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', '90B0ST1', '90B0 Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationB}', '${ids.tenantB}', '${ids.legalB}', '90B0STB', '90B0 Station B', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.financeMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.tenant}', '${ids.finance2Membership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenantB}', '${ids.financeBMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legalB}', null)
        on conflict do nothing;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.tenant}', '90B0-DIESEL', 'Diesel'),
        ('${ids.productOther}', '${ids.tenant}', '90B0-PETROL', 'Petrol')
        on conflict (id) do nothing;
      insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, created_by, updated_by)
        values ('${ids.tank}', '${ids.tenant}', '${ids.station}', '90B0T1', '${ids.product}', 1000000,
                '${ids.adminMembership}', '${ids.adminMembership}')
        on conflict (id) do nothing;
    `);
    for (const [session, token, user, tenant] of [
      [ids.financeSession, tokens.finance, ids.finance, ids.tenant],
      [ids.finance2Session, tokens.finance2, ids.finance2, ids.tenant],
      [ids.adminSession, tokens.admin, ids.admin, ids.tenant],
      [ids.supervisorSession, tokens.supervisor, ids.supervisor, ids.tenant],
      [ids.financeBSession, tokens.financeB, ids.financeB, ids.tenantB],
    ] as const) {
      await seedClerkSession(client, session, token, user, true);
      await seedActiveStepUp(client, session, tenant);
    }
    s1 = await createSupplier('90B0-S1');
    s2 = await createSupplier('90B0-S2');
    sB = await createSupplier('90B0-SB', tokens.financeB, {
      tenantId: ids.tenantB,
      legalEntityId: ids.legalB,
    });
  });

  afterAll(async () => client?.end());

  // -------------------------------------------------------------------------------------
  it('requires a supplier on every new delivery and refuses an unusable one', async () => {
    const missing = await createDelivery(s1, { supplierId: undefined });
    expect(missing.status).toBe(400);

    const unknown = await createDelivery(randomUUID());
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(unknown.json)).toMatch(/supplier was not found/i);

    // Another tenant's supplier is invisible, not merely refused.
    const crossTenant = await createDelivery(sB);
    expect(crossTenant.status).toBe(404);

    const inactive = await createSupplier('90B0-INACTIVE');
    await client`update app.suppliers set status = 'INACTIVE' where id = ${inactive}`;
    const refusedInactive = await createDelivery(inactive);
    expect(refusedInactive.status).toBe(409);
    expect(JSON.stringify(refusedInactive.json)).toMatch(/inactive/);

    const ok = await createDelivery(s1);
    expect(ok.status).toBe(200);
    const stored = await client`
      select supplier_id from app.fuel_deliveries where id = ${ok.json.deliveryId}`;
    expect(stored[0]!.supplier_id).toBe(s1);
  });

  it('shows a legacy delivery as supplier unassigned and refuses to confirm it', async () => {
    const legacyId = randomUUID();
    await client`
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date,
         note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by)
      values (${legacyId}, ${ids.tenant}, ${ids.station}, ${ids.product}, '90B0-LEGACY',
              '2026-09-30T08:00:00Z', '2026-09-30', 50, 50, 0, 'DRAFT', ${ids.adminMembership})`;
    const confirm = await inventoryCmd(tokens.admin, {
      ...station,
      commandType: 'ConfirmDelivery',
      deliveryId: legacyId,
    });
    expect(confirm.status).toBe(409);
    expect(JSON.stringify(confirm.json)).toMatch(/no supplier recorded/);

    const assigned = await inventoryCmd(tokens.admin, {
      ...station,
      commandType: 'CorrectDeliverySupplier',
      deliveryId: legacyId,
      supplierId: s1,
      reason: 'Legacy delivery assigned during cutover',
    });
    expect(assigned.status).toBe(200);
    expect(assigned.json.previousSupplierId).toBeNull();
  });

  it('corrects a confirmed delivery supplier by named command only, with permission, reason and audit', async () => {
    const d = await confirmedDelivery(s1);
    const body = {
      ...station,
      commandType: 'CorrectDeliverySupplier',
      deliveryId: d.deliveryId,
      supplierId: s2,
      reason: 'Wrong supplier captured at the dock',
    };
    // A plain edit is impossible: confirmed deliveries are immutable.
    await expect(
      client`update app.fuel_deliveries set supplier_id = ${s2} where id = ${d.deliveryId}`,
    ).rejects.toThrow(/immutable/);
    expect((await inventoryCmd(tokens.supervisor, body)).status).toBe(403); // no supplier.delivery.link
    expect((await inventoryCmd(tokens.finance, body)).status).toBe(403); // no inventory.delivery.manage
    expect((await inventoryCmd(null, body)).status).toBe(401);
    expect((await inventoryCmd(tokens.admin, { ...body, reason: ' ' })).status).toBe(400);
    expect((await inventoryCmd(tokens.admin, { ...body, supplierId: sB })).status).toBe(404);
    setFixtureStrongAuthentication(ids.adminSession, false);
    expect((await inventoryCmd(tokens.admin, body)).status).toBe(403); // high-risk: needs step-up
    setFixtureStrongAuthentication(ids.adminSession, true);

    const before = await auditCount('INVENTORY.DELIVERY_SUPPLIER_CORRECTED');
    const key = randomUUID();
    const corrected = await inventoryCmd(tokens.admin, body, key);
    expect(corrected.status).toBe(200);
    expect(corrected.json).toMatchObject({ previousSupplierId: s1, supplierId: s2 });
    const retry = await inventoryCmd(tokens.admin, body, key);
    expect(retry.json.supplierId).toBe(s2);
    expect(
      (await inventoryCmd(tokens.admin, { ...body, reason: 'different payload' }, key)).status,
    ).toBe(409);
    expect(await auditCount('INVENTORY.DELIVERY_SUPPLIER_CORRECTED')).toBe(before + 1);
    const history = await client`
      select previous_supplier_id, supplier_id, reason from app.delivery_supplier_corrections
      where delivery_id = ${d.deliveryId}`;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ previous_supplier_id: s1, supplier_id: s2 });
    // Nothing else about the delivery moved.
    const row = await client`
      select actual_quantity_litres::text as litres, status from app.fuel_deliveries where id = ${d.deliveryId}`;
    expect(row[0]).toMatchObject({ litres: '1000.000', status: 'CONFIRMED' });
  });

  // -------------------------------------------------------------------------------------
  it('requires invoice lines by default and keeps the header equal to the lines exactly', async () => {
    const headerOnly = await supplierCmd(tokens.finance, invoice(s1, { amount: '10.0000' }));
    expect(headerOnly.status).toBe(400);
    expect(JSON.stringify(headerOnly.json)).toMatch(/Add the invoice lines/);

    const mismatch = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '1200.0001',
        lines: [{ description: 'Diesel', quantity: '1000', unitPrice: '1.2' }],
      }),
    );
    expect(mismatch.status).toBe(400);
    expect(JSON.stringify(mismatch.json)).toMatch(/lines add up to 1200\.0000/);

    const vatWhileOff = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '1200.0000',
        lines: [{ description: 'Diesel', quantity: '1000', unitPrice: '1.2', vatAmount: '1' }],
      }),
    );
    expect(vatWhileOff.status).toBe(400);
    expect(JSON.stringify(vatWhileOff.json)).toMatch(/VAT is switched off/);

    const exact = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '0.0200',
        lines: [{ description: 'Exactness 0.1 x 0.2', quantity: '0.100', unitPrice: '0.2' }],
      }),
    );
    expect(exact.status).toBe(201);
    expect(exact.json).toMatchObject({
      netAmount: '0.0200',
      vatAmount: '0.0000',
      vatMode: 'NONE',
      lineCount: 1,
    });
    const stored = await client`
      select quantity::text, unit_price::text, net_amount::text, gross_amount::text
      from app.supplier_document_lines where supplier_document_id = ${exact.json.documentId}`;
    expect(stored[0]).toMatchObject({
      quantity: '0.100',
      unit_price: '0.20000000',
      net_amount: '0.0200',
    });
  });

  it('lets only a policy administrator with step-up change the policy, versioned and audited', async () => {
    const unconfigured = await policyRead();
    expect(unconfigured.json).toMatchObject({ configured: false });
    expect(unconfigured.json.resolved).toMatchObject({
      vatMode: 'NONE',
      requireInvoiceLines: true,
      toleranceAction: 'FLAG',
    });

    const fields = { vatMode: 'NONE', requireInvoiceLines: true, toleranceAction: 'FLAG' };
    expect((await setPolicy(fields, undefined, tokens.finance)).status).toBe(403);
    expect((await setPolicy(fields, undefined, tokens.supervisor)).status).toBe(403);
    expect((await setPolicy(fields, undefined, '')).status).toBe(401);
    setFixtureStrongAuthentication(ids.adminSession, false);
    expect((await setPolicy(fields)).status).toBe(403);
    setFixtureStrongAuthentication(ids.adminSession, true);

    const before = await auditCount('PURCHASING.POLICY_SET');
    const created = await setPolicy(fields);
    expect(created.status).toBe(200);
    expect(created.json.version).toBe(0);
    const bad = await setPolicy({ ...fields, quantityToleranceLitres: '-1' });
    expect(bad.status).toBe(400);
    const stale = await supplierCmd(tokens.admin, {
      ...entity,
      commandType: 'SetPurchasingPolicy',
      expectedVersion: 5,
      reason: 'stale',
      ...fields,
    });
    expect(stale.status).toBe(409);
    const missingReason = await supplierCmd(tokens.admin, {
      ...entity,
      commandType: 'SetPurchasingPolicy',
      expectedVersion: 0,
      reason: ' ',
      ...fields,
    });
    expect(missingReason.status).toBe(400);
    const updated = await setPolicy({ ...fields, quantityToleranceLitres: '0.100' });
    expect(updated.json.version).toBe(1);
    const revisions = await client`
      select version from app.purchasing_policy_revisions where tenant_id = ${ids.tenant} order by version`;
    expect(revisions.map((row) => row.version)).toEqual([0, 1]);
    expect(await auditCount('PURCHASING.POLICY_SET')).toBe(before + 2);
    const read = await policyRead();
    expect(read.json.configured).toBe(true);
    expect(read.json.tenantPolicy).toMatchObject({ version: 1, quantityToleranceLitres: '0.100' });
    // Back to zero tolerance for the variance tests below.
    await setPolicy(fields);
  });

  it('applies VAT exactly as configured: none, exclusive, inclusive, per product', async () => {
    // NONE: the printed amount is the payable.
    const none = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '100.0000',
        lines: [{ description: 'x', quantity: '100', unitPrice: '1' }],
      }),
    );
    expect(none.json).toMatchObject({
      netAmount: '100.0000',
      vatAmount: '0.0000',
      vatMode: 'NONE',
    });

    // The rate below is an arbitrary test configuration, not tax advice.
    await setPolicy({
      vatMode: 'EXCLUSIVE',
      defaultVatRate: '15',
      requireInvoiceLines: true,
      toleranceAction: 'FLAG',
      productVatRates: { [ids.productOther]: '0' },
    });
    const wrongTotal = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '100.0000',
        lines: [{ description: 'x', quantity: '100', unitPrice: '1' }],
      }),
    );
    expect(wrongTotal.status).toBe(400);
    expect(JSON.stringify(wrongTotal.json)).toMatch(/lines add up to 115\.0000/);
    const exclusive = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '115.0000',
        netAmount: '100',
        vatAmount: '15',
        lines: [{ description: 'x', quantity: '100', unitPrice: '1' }],
      }),
    );
    expect(exclusive.status).toBe(201);
    expect(exclusive.json).toMatchObject({
      netAmount: '100.0000',
      vatAmount: '15.0000',
      vatMode: 'EXCLUSIVE',
    });
    const zeroRated = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '100.0000',
        lines: [
          { productId: ids.productOther, description: 'Petrol', quantity: '100', unitPrice: '1' },
        ],
      }),
    );
    expect(zeroRated.json).toMatchObject({ vatAmount: '0.0000' });

    await setPolicy({
      vatMode: 'INCLUSIVE',
      defaultVatRate: '15',
      requireInvoiceLines: true,
      toleranceAction: 'FLAG',
    });
    const inclusive = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '100.0000',
        lines: [{ description: 'x', quantity: '100', unitPrice: '1' }],
      }),
    );
    expect(inclusive.status).toBe(201);
    expect(inclusive.json).toMatchObject({
      netAmount: '86.9565',
      vatAmount: '13.0435',
      vatMode: 'INCLUSIVE',
    });
    const header = await client`
      select amount::text, net_amount::text, vat_amount::text from app.supplier_documents
      where id = ${inclusive.json.documentId}`;
    expect(header[0]).toMatchObject({
      amount: '100.0000',
      net_amount: '86.9565',
      vat_amount: '13.0435',
    });

    // Legacy header-only submit is accepted only when the policy says lines are not required.
    await setPolicy({ vatMode: 'NONE', requireInvoiceLines: false, toleranceAction: 'FLAG' });
    const legacy = await supplierCmd(tokens.finance, invoice(s1, { amount: '10.0000' }));
    expect(legacy.status).toBe(201);
    expect(legacy.json).toMatchObject({ netAmount: null, vatMode: null, lineCount: 0 });
    await setPolicy({ vatMode: 'NONE', requireInvoiceLines: true, toleranceAction: 'FLAG' });
  });

  // -------------------------------------------------------------------------------------
  it('links only same-tenant, same-supplier, confirmed deliveries', async () => {
    const d1 = await confirmedDelivery(s1);
    const d2 = await confirmedDelivery(s2);
    const draft = await createDelivery(s1);
    const link = (deliveryId: string) => [{ stationId: ids.station, deliveryId }];
    const base = { amount: '1200.0000' };

    const wrongSupplier = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        ...base,
        lines: [fuelLine(d2.deliveryId)],
        deliveryReferences: link(d2.deliveryId),
      }),
    );
    expect(wrongSupplier.status).toBe(409);
    expect(JSON.stringify(wrongSupplier.json)).toMatch(/different supplier/);

    const unconfirmed = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        ...base,
        lines: [fuelLine(draft.json.deliveryId)],
        deliveryReferences: link(draft.json.deliveryId),
      }),
    );
    expect(unconfirmed.status).toBe(409);
    expect(JSON.stringify(unconfirmed.json)).toMatch(/not been confirmed/);

    // Tenant B cannot see tenant A's delivery or supplier.
    const crossTenant = await supplierCmd(
      tokens.financeB,
      invoice(sB, {
        tenantId: ids.tenantB,
        legalEntityId: ids.legalB,
        ...base,
        lines: [fuelLine(d1.deliveryId)],
        deliveryReferences: [{ stationId: ids.station, deliveryId: d1.deliveryId }],
      }),
    );
    expect(crossTenant.status).toBe(404);
    const crossSupplier = await supplierCmd(
      tokens.financeB,
      invoice(s1, {
        tenantId: ids.tenantB,
        legalEntityId: ids.legalB,
        ...base,
        lines: [fuelLine(d1.deliveryId)],
      }),
    );
    expect(crossSupplier.status).toBe(404);

    const denied = await supplierCmd(
      tokens.supervisor,
      invoice(s1, {
        ...base,
        lines: [fuelLine(d1.deliveryId)],
        deliveryReferences: link(d1.deliveryId),
      }),
    );
    expect(denied.status).toBe(403);
    // A line may not point at a delivery that is not linked, or at another product's delivery.
    const unlinkedLine = await supplierCmd(
      tokens.finance,
      invoice(s1, { ...base, lines: [fuelLine(d1.deliveryId)] }),
    );
    expect(unlinkedLine.status).toBe(400);
    const wrongProduct = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        ...base,
        lines: [fuelLine(d1.deliveryId, '1000.000', '1.2', { productId: ids.productOther })],
        deliveryReferences: link(d1.deliveryId),
      }),
    );
    expect(wrongProduct.status).toBe(400);
  });

  it('covers a delivery by one posted invoice only; credit notes are exempt; A4 never changes', async () => {
    const d = await confirmedDelivery(s1);
    const link = [{ stationId: ids.station, deliveryId: d.deliveryId }];
    const lines = [fuelLine(d.deliveryId)];
    const before = await a4Snapshot();

    const key = randomUUID();
    const input = invoice(s1, { amount: '1200.0000', lines, deliveryReferences: link });
    const first = await supplierCmd(tokens.finance, input, key);
    expect(first.status).toBe(201);
    const retry = await supplierCmd(tokens.finance, input, key);
    expect(retry.json.documentId).toBe(first.json.documentId);
    const changed = await supplierCmd(tokens.finance, { ...input, amount: '1.0000' }, key);
    expect(changed.status).toBe(409);

    // Second invoice submitted while the first is still unposted: allowed, resolved at posting.
    const second = await supplierCmd(
      tokens.finance,
      invoice(s1, { amount: '1200.0000', lines, deliveryReferences: link }),
    );
    expect(second.status).toBe(201);

    const posted = await post(first.json.documentId);
    expect(posted.status).toBe(200);
    expect(posted.json.varianceStatus).toBe('WITHIN_TOLERANCE');
    const duplicate = await post(second.json.documentId);
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.json)).toMatch(/already covered by posted invoice/);
    // Submitting a third invoice for the covered delivery is refused up front.
    const third = await supplierCmd(
      tokens.finance,
      invoice(s1, { amount: '1200.0000', lines, deliveryReferences: link }),
    );
    expect(third.status).toBe(409);

    // A credit note against the already-invoiced delivery is allowed and posts.
    const credit = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        documentType: 'CREDIT_NOTE',
        amount: '120.0000',
        lines: [fuelLine(d.deliveryId, '100.000')],
        deliveryReferences: link,
      }),
    );
    expect(credit.status).toBe(201);
    expect((await post(credit.json.documentId)).status).toBe(200);

    // The supplier of a covered delivery is frozen.
    const frozen = await inventoryCmd(tokens.admin, {
      ...station,
      commandType: 'CorrectDeliverySupplier',
      deliveryId: d.deliveryId,
      supplierId: s2,
      reason: 'should be refused',
    });
    expect(frozen.status).toBe(409);
    expect(JSON.stringify(frozen.json)).toMatch(/already covered by posted supplier document/);
    await expect(
      client`select set_config('app.delivery_supplier_correction', 'on', false)`.then(
        () => client`update app.fuel_deliveries set supplier_id = ${s2} where id = ${d.deliveryId}`,
      ),
    ).rejects.toThrow();
    await client`select set_config('app.delivery_supplier_correction', 'off', false)`;

    // Reversal releases coverage, then the other invoice can be posted.
    const reversed = await supplierCmd(tokens.finance, {
      ...entity,
      commandType: 'ReverseSupplierDocument',
      documentId: first.json.documentId,
      expectedVersion: 1,
      reason: 'Supplier re-issued the invoice',
    });
    expect(reversed.status).toBe(200);
    const refs = await client`
      select active, released_at is not null as released from app.supplier_document_delivery_refs
      where supplier_document_id = ${first.json.documentId}`;
    expect(refs[0]).toMatchObject({ active: false, released: true });
    expect((await post(second.json.documentId)).status).toBe(200);

    // Invoices never touch A4 rows or quantities.
    const after = await a4Snapshot();
    expect(after).toEqual(before);
    expect(await auditCount('SUPPLIER.DOCUMENT_POSTED')).toBeGreaterThanOrEqual(3);
  });

  it('lets exactly one of two concurrent invoices post over one delivery', async () => {
    const d = await confirmedDelivery(s1);
    const link = [{ stationId: ids.station, deliveryId: d.deliveryId }];
    const a = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '1200.0000',
        lines: [fuelLine(d.deliveryId)],
        deliveryReferences: link,
      }),
    );
    const b = await supplierCmd(
      tokens.finance2,
      invoice(s1, {
        amount: '1200.0000',
        lines: [fuelLine(d.deliveryId)],
        deliveryReferences: link,
      }),
    );
    expect([a.status, b.status]).toEqual([201, 201]);
    const results = await Promise.all([
      post(a.json.documentId, tokens.finance),
      post(b.json.documentId, tokens.finance2),
    ]);
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 409]);
    const active = await client`
      select count(*)::int as n from app.supplier_document_delivery_refs
      where delivery_id = ${d.deliveryId} and active and document_type = 'INVOICE'`;
    expect(active[0]!.n).toBe(1);
  });

  it('keeps the database backstop: one active invoice ref per delivery allocation', async () => {
    const d = await confirmedDelivery(s1);
    const link = [{ stationId: ids.station, deliveryId: d.deliveryId }];
    const a = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '1200.0000',
        lines: [fuelLine(d.deliveryId)],
        deliveryReferences: link,
      }),
    );
    const b = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '1200.0000',
        lines: [fuelLine(d.deliveryId)],
        deliveryReferences: link,
      }),
    );
    expect((await post(a.json.documentId)).status).toBe(200);
    // Force document b to POSTED behind the command's back (rolled back afterwards); activating
    // its reference must then hit the unique index.
    let message = '';
    await client
      .begin(async (tx) => {
        await tx`update app.supplier_documents set state = 'POSTED', posted_by = ${ids.financeMembership}, posted_at = now()
                 where id = ${b.json.documentId}`;
        try {
          await tx`update app.supplier_document_delivery_refs set active = true where supplier_document_id = ${b.json.documentId}`;
        } catch (error) {
          message = String(error);
        }
        throw new Error('rollback');
      })
      .catch(() => undefined);
    expect(message).toMatch(/supplier_document_delivery_refs_active_invoice_uidx/);
  });

  // -------------------------------------------------------------------------------------
  it('evaluates variance against the customizable policy and lets a policy change flip the outcome', async () => {
    const fields = { vatMode: 'NONE', requireInvoiceLines: true };
    await setPolicy({ ...fields, toleranceAction: 'FLAG' });
    const d = await confirmedDelivery(s1, {
      unitLandedCost: '1.20000000',
      totalLandedCost: '1200.0000',
      currency: 'USD',
    });
    const link = [{ stationId: ids.station, deliveryId: d.deliveryId }];
    // Invoice bills 1000.300 litres for 1000.000 received: 0.300 litres over.
    const over = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '1200.3600',
        lines: [fuelLine(d.deliveryId, '1000.300')],
        deliveryReferences: link,
      }),
    );
    expect(over.status).toBe(201);

    const read = await variance({ deliveryId: d.deliveryId });
    expect(read.status).toBe(200);
    // Not yet posted: the invoice is not in force, so only receipt checks run.
    expect(read.json.deliveries[0].invoicedLitres).toBeNull();

    // Zero tolerance + FLAG: posts, but is flagged with a plain-language reason.
    const flagged = await post(over.json.documentId);
    expect(flagged.status).toBe(200);
    expect(flagged.json.varianceStatus).toBe('FLAGGED');
    const flaggedRead = await variance({ deliveryId: d.deliveryId });
    const row = flaggedRead.json.deliveries[0];
    expect(row).toMatchObject({
      acceptedLitres: '1000.000',
      invoicedLitres: '1000.300',
      invoicedVsAcceptedLitres: '0.300',
      exceeded: true,
      toleranceAction: 'FLAG',
    });
    expect(row.reasons.join(' ')).toMatch(
      /bills 1000\.300 litres but only 1000\.000 litres were received/,
    );

    // Raise the tolerance to exactly 0.300 litres: the same invoice is now within tolerance.
    await setPolicy({ ...fields, toleranceAction: 'FLAG', quantityToleranceLitres: '0.300' });
    const tolerated = await variance({ deliveryId: d.deliveryId });
    expect(
      tolerated.json.deliveries[0].findings.filter((f: Json) => f.code === 'QUANTITY_OVER_BILLED'),
    ).toHaveLength(0);
    await setPolicy({ ...fields, toleranceAction: 'FLAG', quantityToleranceLitres: '0.299' });
    const strictAgain = await variance({ deliveryId: d.deliveryId });
    expect(
      strictAgain.json.deliveries[0].findings.some((f: Json) => f.code === 'QUANTITY_OVER_BILLED'),
    ).toBe(true);

    // REQUIRE_APPROVAL: posting needs a reason and someone other than the submitter.
    await setPolicy({ ...fields, toleranceAction: 'REQUIRE_APPROVAL' });
    const d2 = await confirmedDelivery(s1, {
      unitLandedCost: '1.20000000',
      totalLandedCost: '1200.0000',
      currency: 'USD',
    });
    const link2 = [{ stationId: ids.station, deliveryId: d2.deliveryId }];
    const overAgain = await supplierCmd(
      tokens.finance,
      invoice(s1, {
        amount: '1200.3600',
        lines: [fuelLine(d2.deliveryId, '1000.300')],
        deliveryReferences: link2,
      }),
    );
    const noReason = await post(overAgain.json.documentId);
    expect(noReason.status).toBe(409);
    expect(JSON.stringify(noReason.json)).toMatch(/needs approval before it can be posted/);
    const selfApproved = await post(overAgain.json.documentId, tokens.finance, {
      varianceApprovalReason: 'I checked',
    });
    expect(selfApproved.status).toBe(403);
    const approved = await post(overAgain.json.documentId, tokens.finance2, {
      varianceApprovalReason: 'Supplier confirmed metering error credit follows',
    });
    expect(approved.status).toBe(200);
    expect(approved.json.varianceStatus).toBe('APPROVED');
    const stored = await client`
      select variance_status, variance_approval_reason, variance_approved_by, variance_snapshot
      from app.supplier_documents where id = ${overAgain.json.documentId}`;
    expect(stored[0]).toMatchObject({
      variance_status: 'APPROVED',
      variance_approved_by: ids.finance2Membership,
    });
    await setPolicy({ ...fields, toleranceAction: 'FLAG' });
  });

  it('reports price and amount variance and never treats an unpriced delivery as zero', async () => {
    await setPolicy({
      vatMode: 'NONE',
      requireInvoiceLines: true,
      toleranceAction: 'FLAG',
      priceTolerancePercent: '2',
    });
    const priced = await confirmedDelivery(s1, {
      unitLandedCost: '1.20000000',
      totalLandedCost: '1200.0000',
      currency: 'USD',
    });
    const unpriced = await confirmedDelivery(s1);
    const sendInvoice = async (deliveryId: string, unitPrice: string, amount: string) => {
      const submitted = await supplierCmd(
        tokens.finance,
        invoice(s1, {
          amount,
          lines: [fuelLine(deliveryId, '1000.000', unitPrice)],
          deliveryReferences: [{ stationId: ids.station, deliveryId }],
        }),
      );
      expect(submitted.status).toBe(201);
      expect((await post(submitted.json.documentId)).status).toBe(200);
    };
    await sendInvoice(priced.deliveryId, '1.2240', '1224.0000'); // exactly 2% above cost: within
    await sendInvoice(unpriced.deliveryId, '9.9', '9900.0000');
    const within = await variance({ deliveryId: priced.deliveryId });
    expect(within.json.deliveries[0].findings).toEqual([]);
    expect(within.json.deliveries[0].priceDifference).toBe('0.02400000');
    const skipped = await variance({ deliveryId: unpriced.deliveryId });
    expect(skipped.json.deliveries[0].findings).toEqual([]);
    expect(skipped.json.deliveries[0].skipped.join(' ')).toMatch(/unpriced, not zero/);

    const onlyExceptions = await variance({ onlyExceptions: 'true' });
    expect(onlyExceptions.json.deliveries.every((row: Json) => row.exceeded)).toBe(true);
    await setPolicy({ vatMode: 'NONE', requireInvoiceLines: true, toleranceAction: 'FLAG' });
  });

  it('supports a per-supplier override that inherits everything it leaves unset', async () => {
    await setPolicy({
      vatMode: 'NONE',
      requireInvoiceLines: true,
      toleranceAction: 'FLAG',
      priceTolerancePercent: '5',
    });
    const override = await setPolicy({ quantityToleranceLitres: '50' }, s2);
    expect(override.status).toBe(200);
    const read = await policyRead({ supplierId: s2 });
    expect(read.json.resolved).toMatchObject({
      source: 'SUPPLIER_OVERRIDE',
      quantityToleranceLitres: '50.000',
      priceTolerancePercent: '5.0000',
    });
    const refusedRates = await setPolicy({ productVatRates: { [ids.product]: '1' } }, s2);
    expect(refusedRates.status).toBe(400);
    await setPolicy({ vatMode: 'NONE', requireInvoiceLines: true, toleranceAction: 'FLAG' });
  });

  // -------------------------------------------------------------------------------------
  it('reports unbilled exposure with states, as-of dates, unpriced litres and a supplier-unassigned bucket', async () => {
    const supplier = await createSupplier('90B0-EXPO');
    const priced = await confirmedDelivery(supplier, {
      unitLandedCost: '1.50000000',
      totalLandedCost: '1500.0000',
      currency: 'USD',
    });
    const unpriced = await confirmedDelivery(supplier, {}, '400.000');
    const partial = await confirmedDelivery(supplier, {}, '1000.000');
    const exposed = await exposure({ supplierId: supplier });
    const group = exposed.json.suppliers[0];
    expect(group.counts.UNBILLED).toBe(3);
    const byId = (id: string) => group.deliveries.find((row: Json) => row.deliveryId === id);
    expect(byId(priced.deliveryId)).toMatchObject({
      state: 'UNBILLED',
      unbilledLitres: '1000.000',
      valuation: 'PRICED',
      unbilledValue: '1500.0000',
    });
    expect(byId(unpriced.deliveryId)).toMatchObject({
      state: 'UNBILLED',
      valuation: 'UNPRICED',
      unbilledValue: null,
    });
    expect(group.unpricedUnbilledLitres).toBe('1400.000');
    expect(group.unbilledValue).toBe('1500.0000');

    // Bill the priced one in full and the partial one for 600 litres, dated 2026-10-05.
    const invoiceFor = async (deliveryId: string, litres: string, amount: string) => {
      const submitted = await supplierCmd(
        tokens.finance,
        invoice(supplier, {
          amount,
          lines: [fuelLine(deliveryId, litres)],
          deliveryReferences: [{ stationId: ids.station, deliveryId }],
        }),
      );
      expect(submitted.status).toBe(201);
      const posted = await post(submitted.json.documentId);
      expect(posted.status).toBe(200);
      return submitted.json.documentId as string;
    };
    const fullDoc = await invoiceFor(priced.deliveryId, '1000.000', '1200.0000');
    await invoiceFor(partial.deliveryId, '600.000', '720.0000');

    const asOfBefore = await exposure({ supplierId: supplier, asOf: '2026-10-04' });
    expect(asOfBefore.json.suppliers[0].counts.UNBILLED).toBe(3);
    const asOfOn = await exposure({ supplierId: supplier, asOf: '2026-10-05' });
    const onGroup = asOfOn.json.suppliers[0];
    const on = (id: string) => onGroup.deliveries.find((row: Json) => row.deliveryId === id);
    expect(on(priced.deliveryId)).toMatchObject({
      state: 'BILLED',
      unbilledLitres: '0.000',
      unbilledValue: '0.0000',
    });
    expect(on(partial.deliveryId)).toMatchObject({
      state: 'PARTIALLY_BILLED',
      unbilledLitres: '400.000',
      invoicedLitres: '600.000',
    });
    expect(on(unpriced.deliveryId).state).toBe('UNBILLED');
    // Deliveries dated after the as-of date are not exposure yet.
    const early = await exposure({ supplierId: supplier, asOf: '2026-09-30' });
    expect(early.json.suppliers).toHaveLength(0);

    // Reversal reopens exposure from the day it happens; earlier as-of dates still show it billed.
    const reversed = await supplierCmd(tokens.finance, {
      ...entity,
      commandType: 'ReverseSupplierDocument',
      documentId: fullDoc,
      expectedVersion: 1,
      reason: 'Invoice issued in error',
    });
    expect(reversed.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    const reopened = await exposure({ supplierId: supplier, asOf: today });
    expect(
      reopened.json.suppliers[0].deliveries.find(
        (row: Json) => row.deliveryId === priced.deliveryId,
      ),
    ).toMatchObject({ state: 'UNBILLED', unbilledValue: '1500.0000' });
    const historical = await exposure({ supplierId: supplier, asOf: '2026-10-05' });
    expect(
      historical.json.suppliers[0].deliveries.find(
        (row: Json) => row.deliveryId === priced.deliveryId,
      ).state,
    ).toBe('BILLED');

    // Over-billing surfaces as a state, never as a correction of the delivery.
    const over = await confirmedDelivery(supplier, {}, '100.000');
    await invoiceFor(over.deliveryId, '150.000', '180.0000');
    const overRead = await exposure({ supplierId: supplier, state: 'OVER_BILLED' });
    expect(overRead.json.suppliers[0].deliveries).toHaveLength(1);
    expect(overRead.json.suppliers[0].deliveries[0]).toMatchObject({
      overBilledLitres: '50.000',
      acceptedLitres: '100.000',
    });

    // Legacy deliveries without a supplier form their own bucket.
    const legacyId = randomUUID();
    await client`
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date,
         note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by,
         confirmed_by, confirmed_at)
      values (${legacyId}, ${ids.tenant}, ${ids.station}, ${ids.product}, '90B0-LEGACY-CONFIRMED',
              '2026-09-29T08:00:00Z', '2026-09-29', 70, 70, 0, 'CONFIRMED', ${ids.adminMembership},
              ${ids.adminMembership}, now())`;
    const unassigned = await exposure({ supplierId: 'unassigned' });
    expect(unassigned.json.suppliers).toHaveLength(1);
    expect(unassigned.json.suppliers[0]).toMatchObject({
      supplierId: null,
      supplierUnassigned: true,
      legalName: 'Supplier unassigned',
    });
    expect(
      unassigned.json.suppliers[0].deliveries.some(
        (row: Json) => row.deliveryId === legacyId && row.valuation === 'UNPRICED',
      ),
    ).toBe(true);

    expect((await exposure({}, tokens.supervisor)).status).toBe(403);
    expect(
      (await exposure({ tenantId: ids.tenantB, legalEntityId: ids.legalB }, tokens.finance)).status,
    ).not.toBe(200);
  });

  // -------------------------------------------------------------------------------------
  it('isolates every new table by tenant and keeps facts append-only for the runtime role', async () => {
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
    const tables = [
      'supplier_document_lines',
      'purchasing_policies',
      'purchasing_policy_revisions',
      'delivery_supplier_corrections',
      'supplier_document_delivery_refs',
    ];
    for (const table of tables) {
      const asB = await asTenant(ids.tenantB, ids.financeBMembership, ids.financeB, (sql) =>
        sql.unsafe(`select tenant_id from app.${table}`),
      );
      expect(asB.every((row) => row.tenant_id === ids.tenantB)).toBe(true);
      const asA = await asTenant(ids.tenant, ids.financeMembership, ids.finance, (sql) =>
        sql.unsafe(`select count(*)::int as n from app.${table}`),
      );
      expect(asA[0]!.n).toBeGreaterThan(0);
      await client.unsafe('set role app_runtime');
      try {
        const noContext = await client.unsafe(`select count(*)::int as n from app.${table}`);
        expect(noContext[0]!.n).toBe(0);
      } finally {
        await client.unsafe('reset role');
      }
    }
    // Cross-tenant writes fail; lines, revisions and corrections cannot be rewritten or deleted.
    await expect(
      asTenant(
        ids.tenantB,
        ids.financeBMembership,
        ids.financeB,
        (sql) =>
          sql`insert into app.purchasing_policies (tenant_id, tolerance_action, vat_mode, require_invoice_lines, updated_by)
            values (${ids.tenant}, 'FLAG', 'NONE', true, ${ids.financeBMembership})`,
      ),
    ).rejects.toThrow();
    for (const statement of [
      `update app.supplier_document_lines set quantity = 1 where tenant_id = '${ids.tenant}'`,
      `delete from app.supplier_document_lines where tenant_id = '${ids.tenant}'`,
      `update app.purchasing_policy_revisions set reason = 'x' where tenant_id = '${ids.tenant}'`,
      `delete from app.delivery_supplier_corrections where tenant_id = '${ids.tenant}'`,
      `delete from app.purchasing_policies where tenant_id = '${ids.tenant}'`,
      // Only the coverage flag may be updated on a delivery link.
      `update app.supplier_document_delivery_refs set invoiced_amount = 1 where tenant_id = '${ids.tenant}'`,
    ]) {
      await expect(
        asTenant(ids.tenant, ids.financeMembership, ids.finance, (sql) => sql.unsafe(statement)),
      ).rejects.toThrow();
    }
  });
  // -------------------------------------------------------------------------------------
  // Follow-up gaps (ADR-018): delivery supplier list, PO price basis, credit netting,
  // reference reuse after reversal, over-receipt flag.
  // -------------------------------------------------------------------------------------
  const strictPolicy = (fields: Json = {}) =>
    setPolicy({ vatMode: 'NONE', requireInvoiceLines: true, toleranceAction: 'FLAG', ...fields });

  it('lists only active suppliers for receiving, authorized by the delivery permission', async () => {
    const hidden = await createSupplier('90B0-LISTHIDDEN');
    await client`update app.suppliers set status = 'INACTIVE' where id = ${hidden}`;
    const listUrl = (tenantId: string, stationId: string) =>
      new URL(
        `http://127.0.0.1:3000/api/inventory/suppliers?tenantId=${tenantId}&stationId=${stationId}`,
      );
    const get = async (token: string | null, tenantId = ids.tenant, stationId = ids.station) => {
      const response = await deliverySuppliersGet(
        new Request(listUrl(tenantId, stationId), {
          headers: token ? clerkHeaders(token) : {},
        }),
      );
      return { status: response.status, json: (await response.json()) as Json };
    };
    for (const token of [tokens.admin, tokens.supervisor]) {
      const ok = await get(token);
      expect(ok.status).toBe(200);
      const rows = ok.json.data as Json[];
      expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([s1, s2]));
      expect(rows.map((row) => row.id)).not.toContain(hidden); // inactive
      expect(rows.map((row) => row.id)).not.toContain(sB); // other tenant
      for (const row of rows) expect(Object.keys(row).sort()).toEqual(['code', 'id', 'name']);
    }
    // Finance has creditor access but not inventory.delivery.manage, and no session is 401.
    expect((await get(tokens.finance)).status).toBe(403);
    expect((await get(null)).status).toBe(401);
    // A station of another tenant is invisible to this actor.
    expect((await get(tokens.admin, ids.tenantB, ids.stationB)).status).toBeGreaterThanOrEqual(400);
  });

  it('judges the invoice price against the linked purchase-order price and reports the basis', async () => {
    await strictPolicy();
    const poCmd = async (token: string, input: Json) => {
      const headers = new Headers({
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        'x-real-ip': `90b0-${randomUUID()}`,
      });
      for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
      const response = await purchasingCommandPost(
        new Request('http://127.0.0.1:3000/api/purchasing/commands', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...station, ...input }),
        }),
      );
      return { status: response.status, json: (await response.json()) as Json };
    };
    const supplier = await createSupplier('90B0-POPRICE');
    const created = await poCmd(tokens.finance, {
      commandType: 'CreatePurchaseOrder',
      supplierId: supplier,
      orderDate: '2026-10-19',
      lines: [{ productId: ids.product, orderedLitres: '5000', agreedUnitPrice: '1.1' }],
    });
    expect(created.status).toBe(201);
    const poId = created.json.purchaseOrderId as string;
    const lineId = (created.json.lines as Json[])[0]!.lineId as string;
    const sent = await poCmd(tokens.finance, {
      commandType: 'SubmitPurchaseOrder',
      purchaseOrderId: poId,
      expectedVersion: 0,
    });
    expect(sent.status).toBe(200);
    expect(
      (
        await poCmd(tokens.admin, {
          commandType: 'ApprovePurchaseOrder',
          purchaseOrderId: poId,
          expectedVersion: sent.json.version,
        })
      ).status,
    ).toBe(200);

    // Receipt cost equals the invoice price (1.20), the PO agreed 1.10.
    const costed = { unitLandedCost: '1.20000000', totalLandedCost: '1200.0000', currency: 'USD' };
    const linked = await confirmedDelivery(supplier, costed);
    const link = await poCmd(tokens.finance, {
      commandType: 'LinkDeliveryToPurchaseOrder',
      purchaseOrderId: poId,
      purchaseOrderLineId: lineId,
      deliveryId: linked.deliveryId,
    });
    expect(link.status).toBe(201);
    const unlinked = await confirmedDelivery(supplier, costed);

    const send = async (deliveryId: string) => {
      const submitted = await supplierCmd(
        tokens.finance,
        invoice(supplier, {
          amount: '1200.0000',
          lines: [fuelLine(deliveryId, '1000.000', '1.2')],
          deliveryReferences: [{ stationId: ids.station, deliveryId }],
        }),
      );
      expect(submitted.status).toBe(201);
      return post(submitted.json.documentId);
    };
    const linkedPost = await send(linked.deliveryId);
    expect(linkedPost.status).toBe(200);
    expect(linkedPost.json.varianceStatus).toBe('FLAGGED'); // price above the PO price
    expect((await send(unlinked.deliveryId)).json.varianceStatus).toBe('WITHIN_TOLERANCE');

    const viaPo = (await variance({ deliveryId: linked.deliveryId })).json.deliveries[0];
    expect(viaPo).toMatchObject({
      priceBasis: 'PURCHASE_ORDER',
      purchaseOrderUnitPrice: '1.10000000',
      invoicedUnitPrice: '1.20000000',
      priceDifference: '0.10000000',
      exceeded: true,
    });
    expect(viaPo.findings[0]).toMatchObject({ code: 'PRICE_ABOVE_PO_PRICE' });
    expect(viaPo.reasons[0]).toMatch(/agreed price on purchase order/);
    const viaCost = (await variance({ deliveryId: unlinked.deliveryId })).json.deliveries[0];
    expect(viaCost).toMatchObject({ priceBasis: 'RECEIPT_COST', purchaseOrderUnitPrice: null });
    expect(viaCost.findings).toEqual([]);

    // The PO price tolerance is the policy's price tolerance (here 10% covers 1.10 vs 1.20).
    await strictPolicy({ priceTolerancePercent: '10' });
    const tolerated = (await variance({ deliveryId: linked.deliveryId })).json.deliveries[0];
    expect(tolerated.findings).toEqual([]);
    await strictPolicy();
  });

  it('nets posted credit notes from billed exposure, never below zero, keeping one invoice per delivery', async () => {
    await strictPolicy();
    const supplier = await createSupplier('90B0-CREDIT');
    const d = await confirmedDelivery(supplier, {
      unitLandedCost: '1.20000000',
      totalLandedCost: '1200.0000',
      currency: 'USD',
    });
    const link = [{ stationId: ids.station, deliveryId: d.deliveryId }];
    const inv = await supplierCmd(
      tokens.finance,
      invoice(supplier, {
        amount: '1200.0000',
        lines: [fuelLine(d.deliveryId, '1000.000', '1.2')],
        deliveryReferences: link,
      }),
    );
    expect((await post(inv.json.documentId)).status).toBe(200);
    const credit = async (litres: string, amount: string) => {
      const submitted = await supplierCmd(
        tokens.finance,
        invoice(supplier, {
          documentType: 'CREDIT_NOTE',
          amount,
          lines: [fuelLine(d.deliveryId, litres, '1.2')],
          deliveryReferences: link,
        }),
      );
      expect(submitted.status).toBe(201);
      expect((await post(submitted.json.documentId)).status).toBe(200);
    };
    const row = async () =>
      (await exposure({ supplierId: supplier })).json.suppliers[0].deliveries[0] as Json;

    expect(await row()).toMatchObject({ state: 'BILLED', netBilledLitres: '1000.000' });
    await credit('400.000', '480.0000');
    expect(await row()).toMatchObject({
      state: 'PARTIALLY_BILLED',
      invoicedLitres: '1000.000',
      creditedLitres: '400.000',
      netBilledLitres: '600.000',
      unbilledLitres: '400.000',
      invoicedAmount: '1200.0000',
      creditedAmount: '480.0000',
      netBilledAmount: '720.0000',
      unbilledValue: '480.0000',
      creditExceedsInvoiced: false,
    });
    const totals = (await exposure({ supplierId: supplier })).json.totals;
    expect(totals.unbilledLitres).toBe('400.000');

    // More credit than invoiced: held at zero and reported, not silently negative.
    await credit('700.000', '840.0000');
    const clamped = await row();
    expect(clamped).toMatchObject({
      state: 'PARTIALLY_BILLED',
      creditedLitres: '1100.000',
      netBilledLitres: '0.000',
      netBilledAmount: '0.0000',
      unbilledLitres: '1000.000',
      creditExceedsInvoiced: true,
      unappliedCreditLitres: '100.000',
    });
    expect(clamped.note).toMatch(/more litres than the invoices bill/);

    // One active invoice per delivery is unchanged: a second invoice is still refused.
    const second = await supplierCmd(
      tokens.finance,
      invoice(supplier, {
        amount: '1200.0000',
        lines: [fuelLine(d.deliveryId, '1000.000', '1.2')],
        deliveryReferences: link,
      }),
    );
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.json)).toMatch(/already covered by posted invoice/);
  });

  it('lets a corrected invoice reuse the reference of a reversed one, and only of a reversed one', async () => {
    await strictPolicy();
    const supplier = await createSupplier('90B0-REFREUSE');
    const reference = 'REUSE-0001';
    const submit = (overrides: Json = {}) =>
      supplierCmd(
        tokens.finance,
        invoice(supplier, {
          referenceNumber: reference,
          amount: '100.0000',
          lines: [{ description: 'Diesel', quantity: '100', unitPrice: '1' }],
          ...overrides,
        }),
      );
    const first = await submit();
    expect(first.status).toBe(201);
    // While the first is active (even unposted) the reference is taken, for both document types.
    const clash = await submit();
    expect(clash.status).toBe(409);
    expect(JSON.stringify(clash.json)).toMatch(/already has a document with reference REUSE-0001/);
    expect((await submit({ documentType: 'CREDIT_NOTE' })).status).toBe(409);
    expect((await post(first.json.documentId)).status).toBe(200);
    expect((await submit()).status).toBe(409);

    const reversed = await supplierCmd(tokens.finance, {
      ...entity,
      commandType: 'ReverseSupplierDocument',
      documentId: first.json.documentId,
      expectedVersion: 1,
      reason: 'Wrong quantity on the invoice',
    });
    expect(reversed.status).toBe(200);
    const corrected = await submit({
      amount: '110.0000',
      lines: [{ description: 'Diesel', quantity: '110', unitPrice: '1' }],
    });
    expect(corrected.status).toBe(201);
    expect((await post(corrected.json.documentId)).status).toBe(200);
    // The corrected invoice now owns the reference again.
    expect((await submit()).status).toBe(409);
    const rows = await client`
      select state from app.supplier_documents
      where supplier_id = ${supplier} and reference_number = ${reference} order by created_at`;
    expect(rows.map((row) => row.state)).toEqual(['REVERSED', 'POSTED']);
    // The database enforces the same rule beneath the command.
    await expect(
      client`insert into app.supplier_documents (id, tenant_id, legal_entity_id, supplier_id,
        document_type, reference_number, document_date, currency, amount, state, version,
        created_by, submitted_by, submitted_at)
        values (${randomUUID()}, ${ids.tenant}, ${ids.legal}, ${supplier}, 'INVOICE', ${reference},
        '2026-10-05', 'USD', 1, 'SUBMITTED', 0, ${ids.financeMembership}, ${ids.financeMembership}, now())`,
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('flags over-receipt beyond the tolerance without blocking, and honours the tolerance action', async () => {
    await strictPolicy({ overReceiptToleranceLitres: '5.000' });
    const supplier = await createSupplier('90B0-OVERREC');
    const d = await confirmedDelivery(supplier, { noteQuantityLitres: '1000.000' }, '1010.000');
    const status = await client`
      select status from app.fuel_deliveries where id = ${d.deliveryId}`;
    expect(status[0]!.status).toBe('CONFIRMED'); // never blocked at the dock

    const read1 = (await variance({ deliveryId: d.deliveryId })).json.deliveries[0];
    expect(read1.overReceipt).toMatchObject({
      flagged: true,
      excessLitres: '10.000',
      allowedLitres: '5.000',
      action: 'FLAG',
      reviewRequired: false,
    });
    expect(read1.overReceiptReviewRequired).toBe(false);
    expect(read1.exceeded).toBe(true);
    expect(read1.findings[0]).toMatchObject({ code: 'OVER_RECEIPT', difference: '10.000' });

    await strictPolicy({
      overReceiptToleranceLitres: '5.000',
      toleranceAction: 'REQUIRE_APPROVAL',
    });
    const read2 = (await variance({ deliveryId: d.deliveryId })).json.deliveries[0];
    expect(read2.toleranceAction).toBe('REQUIRE_APPROVAL');
    expect(read2.overReceiptReviewRequired).toBe(true);

    // Exactly at the allowance is within tolerance.
    await strictPolicy({ overReceiptToleranceLitres: '10.000' });
    const read3 = (await variance({ deliveryId: d.deliveryId })).json.deliveries[0];
    expect(read3.overReceipt).toBeNull();
    expect(read3.findings).toEqual([]);

    // Percent tolerance applies too (1% of 1000 = 10 litres allowed; 0.9% flags).
    await strictPolicy({ overReceiptTolerancePercent: '0.9' });
    expect(
      (await variance({ deliveryId: d.deliveryId })).json.deliveries[0].overReceipt,
    ).not.toBeNull();
    await strictPolicy();
  });
});
