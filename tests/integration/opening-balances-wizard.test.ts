import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { randomUUID } from 'node:crypto';
import { GET as openingGet, POST as openingPost } from '../../src/app/api/opening-balances/route';
import { GET as overviewGet } from '../../src/app/api/setup/overview/route';
import {
  BLANK_OPENING,
  buildOpeningCsv,
  type OpeningOptions,
} from '../../src/modules/opening-balances/wizard';

/**
 * The opening-balances wizard against a real database: the lookup that decides what to ask, and the
 * create, approve and lock commands it ends with, including the cash, bank, customer and supplier
 * lines whose posting once failed at lock time (a JavaScript Date in raw SQL). Synthetic data only.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for opening balance wizard integration tests.');
}

// New ids every run: a locked batch and the ledgers it posts to cannot be removed, so the test
// makes its own tenant each time instead of cleaning up.
const ids = {
  tenant: randomUUID(),
  otherTenant: randomUUID(),
  legal: randomUUID(),
  otherLegal: randomUUID(),
  station: randomUUID(),
  otherStation: randomUUID(),
  admin: randomUUID(),
  adminMembership: randomUUID(),
  adminSession: randomUUID(),
  otherAdmin: randomUUID(),
  otherMembership: randomUUID(),
  product: randomUUID(),
  customer: randomUUID(),
  customerAccount: randomUUID(),
  otherCustomer: randomUUID(),
  otherAccount: randomUUID(),
  invitation: randomUUID(),
};
const token = `opening-wizard-admin-token-${ids.admin}`;
let client: Sql;

const url = (query: string) => `http://127.0.0.1:3000/api/opening-balances${query}`;

async function getOptions(): Promise<OpeningOptions | null> {
  const response = await openingGet(
    new Request(url(`?tenantId=${ids.tenant}&optionsFor=${ids.station}`), {
      headers: { ...clerkHeaders(token) },
    }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { options: OpeningOptions | null }).options;
}

async function command(payload: Record<string, unknown>, key: string) {
  return openingPost(
    new Request(url(''), {
      method: 'POST',
      headers: {
        ...clerkHeaders(token, payload),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    }),
  );
}

describe('opening balances wizard (PostgreSQL)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-opening-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-opening-secret-integration-opening-secret';
    client = postgres(databaseUrl!, { max: 4, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Opening Wizard Tenant', 'opening-wizard-${ids.tenant.slice(0, 8)}'),
        ('${ids.otherTenant}', 'Opening Wizard Other', 'opening-wizard-o-${ids.otherTenant.slice(0, 8)}')
      on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.admin}', 'Opening Admin', 'opening-wizard-${ids.admin}@example.test'),
        ('${ids.otherAdmin}', 'Opening Other Admin', 'opening-wizard-${ids.otherAdmin}@example.test')
      on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE'),
        ('${ids.otherMembership}', '${ids.otherTenant}', '${ids.otherAdmin}', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Opening Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'Opening Other Legal')
      on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'OPWIZ', 'Opening Wizard Station', 'ONBOARDING'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'OPOTHER', 'Opening Other Station', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.otherTenant}', '${ids.otherMembership}', 'ADMINISTRATOR', 'TENANT', null, null)
      on conflict do nothing;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.tenant}', 'OPWIZ-DSL', 'Opening Diesel')
      on conflict (id) do nothing;
      insert into app.tanks (tenant_id, station_id, code, product_id, capacity_litres, acceptable_variance_litres, created_by, updated_by)
      values
        ('${ids.tenant}', '${ids.station}', 'T1', '${ids.product}', 20000, 25, '${ids.adminMembership}', '${ids.adminMembership}')
      on conflict do nothing;
      insert into app.cash_locations (tenant_id, station_id, code, name, location_type)
      values
        ('${ids.tenant}', '${ids.station}', 'SAFE', 'Opening Safe', 'STATION_SAFE'),
        ('${ids.otherTenant}', '${ids.otherStation}', 'OTHERSAFE', 'Other Tenant Safe', 'STATION_SAFE')
      on conflict do nothing;
      insert into app.bank_accounts (tenant_id, legal_entity_id, name, bank_name, account_reference_masked)
      values
        ('${ids.tenant}', '${ids.legal}', 'Opening Main', 'Opening Bank', '****4321'),
        ('${ids.otherTenant}', '${ids.otherLegal}', 'Other Tenant Bank', 'Other Bank', '****9999')
      on conflict do nothing;
      insert into app.customers (id, tenant_id, account_reference, display_name, created_by, updated_by)
      values
        ('${ids.customer}', '${ids.tenant}', 'OPWIZ-C1', 'Opening Customer', '${ids.adminMembership}', '${ids.adminMembership}'),
        ('${ids.otherCustomer}', '${ids.otherTenant}', 'OTHER-C1', 'Other Tenant Customer', '${ids.otherMembership}', '${ids.otherMembership}')
      on conflict (id) do nothing;
      insert into app.customer_accounts (id, tenant_id, customer_id, account_type, created_by, updated_by)
      values
        ('${ids.customerAccount}', '${ids.tenant}', '${ids.customer}', 'CREDIT', '${ids.adminMembership}', '${ids.adminMembership}'),
        ('${ids.otherAccount}', '${ids.otherTenant}', '${ids.otherCustomer}', 'CREDIT', '${ids.otherMembership}', '${ids.otherMembership}')
      on conflict (id) do nothing;
      insert into app.suppliers (tenant_id, code, legal_name, created_by, updated_by)
      values
        ('${ids.tenant}', 'OPWIZ-SUP', 'Opening Supplier', '${ids.adminMembership}', '${ids.adminMembership}'),
        ('${ids.otherTenant}', 'OTHER-SUP', 'Other Tenant Supplier', '${ids.otherMembership}', '${ids.otherMembership}')
      on conflict do nothing;
    `);
    await seedClerkSession(client, ids.adminSession, token, ids.admin, true);
    await seedActiveStepUp(client, ids.adminSession, ids.tenant);
  });

  afterAll(async () => client?.end());

  it('asks only about this company and station, and about every figure not yet entered', async () => {
    const options = await getOptions();
    expect(options).not.toBeNull();
    expect(options!.station).toMatchObject({ code: 'OPWIZ', name: 'Opening Wizard Station' });
    expect(options!.tanks).toEqual([
      { code: 'T1', fuel: 'Opening Diesel', capacityLitres: '20000.000', hasOpening: false },
    ]);
    expect(options!.cashLocations).toEqual([
      { code: 'SAFE', name: 'Opening Safe', hasOpening: false },
    ]);
    expect(options!.bankAccounts).toEqual([
      { name: 'Opening Main', bankName: 'Opening Bank', hasOpening: false },
    ]);
    expect(options!.customers).toEqual([
      { accountId: ids.customerAccount, name: 'Opening Customer', hasOpening: false },
    ]);
    expect(options!.suppliers).toEqual([{ code: 'OPWIZ-SUP', name: 'Opening Supplier' }]);
    // Nothing from the other tenant leaks in, whichever table it comes from.
    expect(JSON.stringify(options)).not.toMatch(/Other Tenant|OTHERSAFE|OTHER-SUP/);
  });

  it('gives nothing for a station of another tenant', async () => {
    const response = await openingGet(
      new Request(url(`?tenantId=${ids.tenant}&optionsFor=${ids.otherStation}`), {
        headers: { ...clerkHeaders(token) },
      }),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { options: unknown }).options).toBeNull();
  });

  it('saves, approves and locks what the wizard builds, then stops asking about it', async () => {
    const options = (await getOptions())!;
    const answers = {
      ...BLANK_OPENING,
      asOf: '2026-11-20',
      tanks: { T1: { litres: '12500.5', value: '' } },
      cash: { SAFE: '1500' },
      bank: { 'Opening Main': '8000.25' },
      customers: [
        { accountId: ids.customerAccount, name: 'Opening Customer', amount: '320.5', due: '' },
      ],
      suppliers: [
        {
          code: 'OPWIZ-SUP',
          name: 'Opening Supplier',
          reference: 'INV-WIZ-1',
          amount: '900',
          due: '',
        },
      ],
    };
    const { csv } = buildOpeningCsv(options, answers);

    const preview = await openingPost(
      new Request(url(`?tenantId=${ids.tenant}`), {
        method: 'POST',
        headers: { ...clerkHeaders(token), 'content-type': 'text/csv' },
        body: csv,
      }),
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      valid: true,
      duplicateBatch: null,
      parserIssues: [],
      resolutionIssues: [],
    });

    const created = await command(
      {
        commandType: 'CreateOpeningBalanceBatch',
        tenantId: ids.tenant,
        asOfDate: '2026-11-20',
        sourceFilename: 'Opening balances, Opening Wizard Station',
        csv,
      },
      `opening-wizard-create-${ids.tenant}`,
    );
    expect(created.status).toBe(201);
    const batch = (await created.json()) as { batchId: string; version: number };

    // The same figures again are recognised as already saved, not saved twice.
    const again = await openingPost(
      new Request(url(`?tenantId=${ids.tenant}`), {
        method: 'POST',
        headers: { ...clerkHeaders(token), 'content-type': 'text/csv' },
        body: csv,
      }),
    );
    expect(
      ((await again.json()) as { duplicateBatch: { id: string; state: string } }).duplicateBatch,
    ).toEqual({
      id: batch.batchId,
      state: 'DRAFT',
    });

    // A draft that was never locked is not yet an opening figure.
    expect((await getOptions())!.tanks[0]!.hasOpening).toBe(false);

    const approved = await command(
      {
        commandType: 'ApproveOpeningBalanceBatch',
        tenantId: ids.tenant,
        batchId: batch.batchId,
        expectedVersion: batch.version,
      },
      `opening-wizard-approve-${ids.tenant}`,
    );
    expect(approved.status).toBe(200);

    // Locking posts the tank, cash, bank, customer and supplier lines.
    const locked = await command(
      {
        commandType: 'LockOpeningBalanceBatch',
        tenantId: ids.tenant,
        batchId: batch.batchId,
        expectedVersion: batch.version + 1,
      },
      `opening-wizard-lock-${ids.tenant}`,
    );
    expect(locked.status).toBe(200);

    const after = (await getOptions())!;
    expect(after.tanks[0]!.hasOpening).toBe(true);
    expect(after.cashLocations[0]!.hasOpening).toBe(true);
    expect(after.bankAccounts[0]!.hasOpening).toBe(true);
    expect(after.customers[0]!.hasOpening).toBe(true);

    const posted = await client.unsafe(`
      select
        (select count(*) from app.inventory_movements where tenant_id = '${ids.tenant}' and movement_type = 'OPENING_BALANCE') as tank,
        (select count(*) from app.cash_movements where tenant_id = '${ids.tenant}' and source_type = 'OPENING_BALANCE') as cash,
        (select count(*) from app.bank_opening_balances where tenant_id = '${ids.tenant}') as bank,
        (select count(*) from app.customer_ledger_entries where tenant_id = '${ids.tenant}' and account_id = '${ids.customerAccount}') as customer,
        (select count(*) from app.supplier_documents where tenant_id = '${ids.tenant}' and reference_number = 'INV-WIZ-1') as supplier
    `);
    expect(Object.fromEntries(Object.entries(posted[0]!).map(([k, v]) => [k, Number(v)]))).toEqual({
      tank: 1,
      cash: 1,
      bank: 1,
      customer: 1,
      supplier: 1,
    });
  });

  it('a tank locked without a value still needs one before the station can go live', async () => {
    const response = await overviewGet(
      new Request(
        `http://127.0.0.1:3000/api/setup/overview?tenantId=${ids.tenant}&legalEntityId=${ids.legal}&stationId=${ids.station}`,
        { headers: { ...clerkHeaders(token) } },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { stations: Array<Record<string, any>> };
    const station = body.stations.find((s) => s.stationCode === 'OPWIZ')!;
    const tanks = station.areas.find((a: any) => a.code === 'TANKS');
    expect(tanks.detail).toContain('opening stock has no cost for 1');
    // Opening stock never holds a station back from going live on its own, and it is no longer asked.
    expect(station.wants.openingStock).toBe(false);
  });

  it('knows that someone was invited to the station and has not joined yet', async () => {
    const overview = async () => {
      const response = await overviewGet(
        new Request(
          `http://127.0.0.1:3000/api/setup/overview?tenantId=${ids.tenant}&legalEntityId=${ids.legal}&stationId=${ids.station}`,
          { headers: { ...clerkHeaders(token) } },
        ),
      );
      const body = (await response.json()) as { stations: Array<Record<string, any>> };
      return body.stations.find((s) => s.stationCode === 'OPWIZ')!;
    };
    expect((await overview()).wants.invitationPending).toBe(false);

    await client.unsafe(`
      insert into app.staff_invitations (
        id, tenant_id, invited_email, invited_name, assigned_role, scope_type, legal_entity_id, token_hash,
        expires_at, created_by_user_id, created_by_membership_id, delivery_method
      ) values (
        '${ids.invitation}', '${ids.tenant}', 'pending-${ids.invitation}@example.test', 'Pending Person', 'ATTENDANT', 'STATION', '${ids.legal}',
        '${ids.invitation.replaceAll('-', '').repeat(2)}', now() + interval '7 days', '${ids.admin}', '${ids.adminMembership}', 'EMAIL'
      ) on conflict (id) do nothing;
      insert into app.staff_invitation_stations (tenant_id, invitation_id, legal_entity_id, station_id)
      values ('${ids.tenant}', '${ids.invitation}', '${ids.legal}', '${ids.station}')
      on conflict do nothing;
    `);
    const pending = await overview();
    expect(pending.wants.invitationPending).toBe(true);
    // Still not someone who can work shifts, so going live keeps waiting for them.
    expect(pending.missing.map((m: any) => m.code)).toContain('STAFF');

    // Once the invitation is revoked or has run out it no longer counts.
    await client.unsafe(
      `update app.staff_invitations set status = 'REVOKED', revoked_at = now() where id = '${ids.invitation}'`,
    );
    expect((await overview()).wants.invitationPending).toBe(false);
  });
});
