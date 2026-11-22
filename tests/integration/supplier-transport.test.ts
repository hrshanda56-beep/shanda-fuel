import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as supplierCommandPost } from '../../src/app/api/suppliers/commands/route';
import { POST as inventoryCommandPost } from '../../src/app/api/inventory/commands/route';
import { GET as varianceGet } from '../../src/app/api/suppliers/variance/route';
import { GET as policyGet } from '../../src/app/api/suppliers/policy/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for supplier transport integration tests.');
}

// Fixture prefix 91a0 (unique across tests/integration).
const P = '91a00000-0000-4000-8000';
const ids = {
  tenant: `${P}-000000000001`,
  legal: `${P}-000000000011`,
  station: `${P}-000000000021`,
  tank: `${P}-000000000061`,
  product: `${P}-000000000051`,
  finance: `${P}-000000000031`,
  financeMembership: `${P}-000000000041`,
  financeSession: `${P}-000000000071`,
  admin: `${P}-000000000033`,
  adminMembership: `${P}-000000000043`,
  adminSession: `${P}-000000000073`,
};
const tokens = { finance: '91a0-finance-token', admin: '91a0-admin-token' };

type Json = Record<string, any>;
let client: Sql;
let noteCounter = 0;
let refCounter = 0;

const entity = { tenantId: ids.tenant, legalEntityId: ids.legal };
const station = { tenantId: ids.tenant, stationId: ids.station };

async function call(
  handler: (request: Request) => Promise<Response>,
  url: string,
  token: string,
  input: Json,
) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': randomUUID(),
    'x-real-ip': `91a0-${randomUUID()}`,
  });
  for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
  const response = await handler(
    new Request(url, { method: 'POST', headers, body: JSON.stringify(input) }),
  );
  return { status: response.status, json: (await response.json()) as Json };
}
const supplierCmd = (token: string, input: Json) =>
  call(supplierCommandPost, 'http://127.0.0.1:3000/api/suppliers/commands', token, input);
const inventoryCmd = (token: string, input: Json) =>
  call(inventoryCommandPost, 'http://127.0.0.1:3000/api/inventory/commands', token, input);

async function createSupplier(code: string, roles: Json = {}) {
  const result = await supplierCmd(tokens.finance, {
    ...entity,
    commandType: 'CreateSupplier',
    code,
    legalName: `${code} Company`,
    ...roles,
  });
  return result;
}

async function confirmedDelivery(supplierId: string, extra: Json = {}) {
  noteCounter += 1;
  const created = await inventoryCmd(tokens.admin, {
    ...station,
    commandType: 'CreateDelivery',
    productId: ids.product,
    supplierId,
    deliveryNoteNumber: `91A0-DN-${noteCounter}`,
    deliveredAt: '2026-10-01T08:00:00+02:00',
    noteQuantityLitres: '1000.000',
    actualQuantityLitres: '1000.000',
    allocations: [{ tankId: ids.tank, quantityLitres: '1000.000' }],
    noPoReason: 'EMERGENCY_PURCHASE',
    ...extra,
  });
  if (created.status !== 200) return { created };
  const confirmed = await inventoryCmd(tokens.admin, {
    ...station,
    commandType: 'ConfirmDelivery',
    deliveryId: created.json.deliveryId,
  });
  expect(confirmed.status).toBe(200);
  return { created, deliveryId: created.json.deliveryId as string };
}

function bill(supplierId: string, lines: Json[], links: Json[], extra: Json = {}) {
  refCounter += 1;
  return supplierCmd(tokens.finance, {
    ...entity,
    commandType: 'SubmitSupplierDocument',
    supplierId,
    documentType: 'INVOICE',
    paymentTerms: 'CASH',
    referenceNumber: `91A0-INV-${refCounter}`,
    documentDate: '2026-10-05',
    lines,
    // The payable total must equal the lines: 1000 L at 1.2 for fuel, one trip at 150 for transport.
    amount: lines[0]?.lineType === 'TRANSPORT' ? '150.0000' : '1200.0000',
    deliveryReferences: links.map((link) => ({ stationId: ids.station, ...link })),
    ...extra,
  });
}

const fuelLine = (deliveryId: string) => ({
  lineType: 'FUEL',
  productId: ids.product,
  description: 'Diesel',
  quantity: '1000.000',
  unitPrice: '1.2',
  deliveryId,
});
const transportLine = (deliveryId: string) => ({
  lineType: 'TRANSPORT',
  description: 'Haulage',
  quantity: '1',
  unitPrice: '150',
  deliveryId,
});

async function read(
  handler: (request: Request) => Promise<Response>,
  path: string,
  params: Record<string, string>,
) {
  const url = new URL(`http://127.0.0.1:3000/api/suppliers/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await handler(new Request(url, { headers: clerkHeaders(tokens.finance) }));
  return { status: response.status, json: (await response.json()) as Json };
}

/** Saves the company policy (or one supplier's override), keeping the version in step. */
async function setPolicy(fields: Json, supplierId?: string) {
  const current = await read(policyGet, 'policy', {
    ...entity,
    ...(supplierId ? { supplierId } : {}),
  });
  const existing = supplierId ? current.json.supplierOverride : current.json.tenantPolicy;
  return supplierCmd(tokens.admin, {
    ...entity,
    commandType: 'SetPurchasingPolicy',
    ...(supplierId ? { supplierId } : {}),
    ...(existing ? { expectedVersion: existing.version } : {}),
    reason: 'integration test',
    ...fields,
  });
}

async function post(documentId: string) {
  return supplierCmd(tokens.finance, {
    ...entity,
    commandType: 'PostSupplierDocument',
    documentId,
    expectedVersion: 0,
  });
}

describe('Transportation under suppliers', () => {
  let fuelCo: string;
  let haulier: string;
  let bothCo: string;

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-91a0-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-91a0-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', '91A0 Transport Tenant', '91a0-transport') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.finance}', '91A0 Finance', '91a0-finance@example.test'),
        ('${ids.admin}', '91A0 Admin', '91a0-admin@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.financeMembership}', '${ids.tenant}', '${ids.finance}', 'ACTIVE'),
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', '91A0 Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', '91A0ST1', '91A0 Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.financeMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null)
        on conflict do nothing;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.tenant}', '91A0-DIESEL', 'Diesel') on conflict (id) do nothing;
      insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, created_by, updated_by)
        values ('${ids.tank}', '${ids.tenant}', '${ids.station}', '91A0T1', '${ids.product}', 1000000,
                '${ids.adminMembership}', '${ids.adminMembership}') on conflict (id) do nothing;
    `);
    for (const [session, token, user] of [
      [ids.financeSession, tokens.finance, ids.finance],
      [ids.adminSession, tokens.admin, ids.admin],
    ] as const) {
      await seedClerkSession(client, session, token, user, true);
      await seedActiveStepUp(client, session, ids.tenant);
    }
    fuelCo = (await createSupplier('91A0-FUEL')).json.supplierId;
    haulier = (await createSupplier('91A0-HAUL', { providesFuel: false, providesTransport: true }))
      .json.supplierId;
    bothCo = (await createSupplier('91A0-BOTH', { providesFuel: true, providesTransport: true }))
      .json.supplierId;
  });

  afterAll(async () => client?.end());

  it('stores what a company does and refuses one that does neither', async () => {
    const rows = await client`
      select code, provides_fuel, provides_transport from app.suppliers
      where tenant_id = ${ids.tenant} order by code`;
    expect(rows.map((row) => [row.code, row.provides_fuel, row.provides_transport])).toEqual([
      ['91A0-BOTH', true, true],
      ['91A0-FUEL', true, false],
      ['91A0-HAUL', false, true],
    ]);
    const none = await createSupplier('91A0-NONE', {
      providesFuel: false,
      providesTransport: false,
    });
    expect(none.status).toBe(400);
  });

  it('accepts a transporter only if it carries fuel, or is the delivery supplier', async () => {
    const notCarrier = await confirmedDelivery(fuelCo, { transporterSupplierId: bothCo });
    expect(notCarrier.deliveryId).toBeDefined(); // BOTH carries fuel, so it is a valid pick

    const refused = await confirmedDelivery(bothCo, { transporterSupplierId: fuelCo });
    expect(refused.created.status).toBe(409);
    expect(JSON.stringify(refused.created.json)).toMatch(/not set up to transport/);

    const own = await confirmedDelivery(fuelCo, { transporterSupplierId: fuelCo });
    expect(own.deliveryId).toBeDefined(); // the supplier may carry its own fuel

    const missing = await confirmedDelivery(fuelCo, { transporterSupplierId: randomUUID() });
    expect(missing.created.status).toBe(404);

    const typed = await confirmedDelivery(fuelCo, { transporter: 'A. Driver Haulage' });
    const row = await client`
      select transporter, transporter_supplier_id from app.fuel_deliveries where id = ${typed.deliveryId!}`;
    expect(row[0]).toMatchObject({
      transporter: 'A. Driver Haulage',
      transporter_supplier_id: null,
    });
  });

  it('bills fuel and transport separately for one delivery', async () => {
    const { deliveryId } = await confirmedDelivery(fuelCo, { transporterSupplierId: haulier });
    const fuel = await bill(fuelCo, [fuelLine(deliveryId!)], [{ deliveryId }]);
    expect(fuel.status).toBe(201);
    expect((await post(fuel.json.documentId)).status).toBe(200);

    // The haulier's bill for the same delivery is not blocked by the posted fuel invoice.
    const freight = await bill(haulier, [transportLine(deliveryId!)], [{ deliveryId }]);
    expect(freight.status).toBe(201);
    const posted = await post(freight.json.documentId);
    expect(posted.status).toBe(200);
    const refs = await client`
      select r.kind, r.active, r.invoiced_quantity_litres from app.supplier_document_delivery_refs r
      where r.delivery_id = ${deliveryId!} order by r.kind`;
    expect(refs.map((row) => [row.kind, row.active])).toEqual([
      ['FUEL', true],
      ['TRANSPORT', true],
    ]);
    expect(refs.find((row) => row.kind === 'TRANSPORT')!.invoiced_quantity_litres).toBeNull();

    // A second transport bill for the same delivery is refused.
    const again = await bill(haulier, [transportLine(deliveryId!)], [{ deliveryId }]);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.json)).toMatch(/transport bill/);
  });

  it('refuses a transport bill from a company that did not carry the delivery', async () => {
    const { deliveryId } = await confirmedDelivery(fuelCo, { transporterSupplierId: haulier });
    // Saying it is a transport bill does not help a company that did not carry the delivery.
    const wrong = await bill(
      bothCo,
      [transportLine(deliveryId!)],
      [{ deliveryId, kind: 'TRANSPORT' }],
    );
    expect(wrong.status).toBe(409);
    expect(JSON.stringify(wrong.json)).toMatch(/not carried by this company/);
    // Left unsaid, an unrelated company is treated as a fuel supplier and refused as before.
    const unsaid = await bill(bothCo, [transportLine(deliveryId!)], [{ deliveryId }]);
    expect(unsaid.status).toBe(409);
    expect(JSON.stringify(unsaid.json)).toMatch(/different supplier/);
  });

  it('lets a company that supplies and carries bill each part on its own bill', async () => {
    const { deliveryId } = await confirmedDelivery(bothCo, { transporterSupplierId: bothCo });
    const fuel = await bill(bothCo, [fuelLine(deliveryId!)], [{ deliveryId, kind: 'FUEL' }]);
    expect(fuel.status).toBe(201);
    const freight = await bill(
      bothCo,
      [transportLine(deliveryId!)],
      [{ deliveryId, kind: 'TRANSPORT' }],
    );
    expect(freight.status).toBe(201);
  });

  it('lets one haulier bill cover several deliveries, one line each', async () => {
    const one = await confirmedDelivery(fuelCo, { transporterSupplierId: haulier });
    const two = await confirmedDelivery(fuelCo, { transporterSupplierId: haulier });
    const combined = await bill(
      haulier,
      [transportLine(one.deliveryId!), transportLine(two.deliveryId!)],
      [{ deliveryId: one.deliveryId }, { deliveryId: two.deliveryId }],
      { amount: '300.0000' },
    );
    expect(combined.status).toBe(201);
    expect((await post(combined.json.documentId)).status).toBe(200);
    const refs = await client`
      select r.kind, r.active from app.supplier_document_delivery_refs r
      where r.supplier_document_id = ${combined.json.documentId}`;
    expect(refs.map((row) => [row.kind, row.active])).toEqual([
      ['TRANSPORT', true],
      ['TRANSPORT', true],
    ]);
  });

  it('can require a transport bill for every delivery another company carried', async () => {
    const base = { vatMode: 'NONE', requireInvoiceLines: true, toleranceAction: 'FLAG' };
    const flagsOf = async (deliveryId: string) => {
      const read1 = await read(varianceGet, 'variance', { ...entity, deliveryId });
      expect(read1.status).toBe(200);
      return read1.json.deliveries[0] as Json;
    };

    // Not required by default: an unbilled carried delivery raises nothing.
    const first = await confirmedDelivery(fuelCo, { transporterSupplierId: haulier });
    expect((await flagsOf(first.deliveryId!)).findings.map((f: Json) => f.code)).not.toContain(
      'TRANSPORT_BILL_MISSING',
    );

    expect((await setPolicy({ ...base, requireTransportBill: true })).status).toBe(200);
    const policy = await read(policyGet, 'policy', { ...entity });
    expect(policy.json.resolved.requireTransportBill).toBe(true);

    // Required: the carried delivery is flagged until the carrier's own bill is posted.
    const flagged = await flagsOf(first.deliveryId!);
    expect(flagged.exceeded).toBe(true);
    expect(flagged.transporterName).toBe('91A0-HAUL Company');
    expect(flagged.findings.map((f: Json) => f.code)).toContain('TRANSPORT_BILL_MISSING');

    // A transporter that was only typed in is not a supplier we can be billed by: nothing to chase.
    const typed = await confirmedDelivery(fuelCo, { transporter: 'A. Driver Haulage' });
    expect((await flagsOf(typed.deliveryId!)).findings.map((f: Json) => f.code)).not.toContain(
      'TRANSPORT_BILL_MISSING',
    );

    // An unposted bill does not count; a posted one clears the flag.
    const freight = await bill(
      haulier,
      [transportLine(first.deliveryId!)],
      [{ deliveryId: first.deliveryId }],
    );
    expect(freight.status).toBe(201);
    expect((await flagsOf(first.deliveryId!)).transportBilled).toBe(false);
    expect((await post(freight.json.documentId)).status).toBe(200);
    const cleared = await flagsOf(first.deliveryId!);
    expect(cleared.transportBilled).toBe(true);
    expect(cleared.findings.map((f: Json) => f.code)).not.toContain('TRANSPORT_BILL_MISSING');

    // One carrier can be excused: its own setting wins over the company's.
    expect((await setPolicy({ ...base, requireTransportBill: false }, haulier)).status).toBe(200);
    const excused = await confirmedDelivery(fuelCo, { transporterSupplierId: haulier });
    expect((await flagsOf(excused.deliveryId!)).findings.map((f: Json) => f.code)).not.toContain(
      'TRANSPORT_BILL_MISSING',
    );
  });
});
