import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { seedActiveStepUp, seedClerkSession, clerkHeaders } from './auth-session-fixtures';
import { POST as customerCommandPost } from '../../src/app/api/customers/commands/route';
import { readCustomerAgeing } from '../../src/modules/reporting/table-reports/customer-ageing-read';
import { createTrustedTenantTransactionContext } from '../../src/platform/db/tenant-context';
import { withTenantTransaction } from '../../src/platform/db/transaction';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for customer account controls integration tests.');
}

const ids = {
  tenant: 'c1300000-0000-4000-8000-000000000001',
  otherTenant: 'c1300000-0000-4000-8000-000000000002',
  legal: 'c1300000-0000-4000-8000-000000000011',
  otherLegal: 'c1300000-0000-4000-8000-000000000012',
  station: 'c1300000-0000-4000-8000-000000000021',
  otherStation: 'c1300000-0000-4000-8000-000000000022',
  adminActor: 'c1300000-0000-4000-8000-000000000031',
  adminMembership: 'c1300000-0000-4000-8000-000000000041',
  adminSession: 'c1300000-0000-4000-8000-000000000051',
  supActor: 'c1300000-0000-4000-8000-000000000032',
  supMembership: 'c1300000-0000-4000-8000-000000000042',
  supSession: 'c1300000-0000-4000-8000-000000000052',
  outsiderActor: 'c1300000-0000-4000-8000-000000000033',
  outsiderMembership: 'c1300000-0000-4000-8000-000000000043',
  outsiderSession: 'c1300000-0000-4000-8000-000000000053',
  approverActor: 'c1300000-0000-4000-8000-000000000034',
  approverMembership: 'c1300000-0000-4000-8000-000000000044',
  document: 'c1300000-0000-4000-8000-000000000081',
};
const ADMIN = 'c13-admin-token';
const SUPERVISOR = 'c13-supervisor-token';
const OUTSIDER = 'c13-outsider-token';
let client: Sql;
let accountId: string;
let reference: string;
let paymentEntryId: string;
let counter = 0;
const uuid = () =>
  `c1399999-0000-4000-8000-${String(++counter + Math.floor(Date.now() % 1e6) * 1e3)
    .padStart(12, '0')
    .slice(-12)}`;

async function command(input: Record<string, unknown>, token = ADMIN, key = `c13-${uuid()}`) {
  const response = await customerCommandPost(
    new Request('http://127.0.0.1:3000/api/customers/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(token),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const paymentBody = (extra: Record<string, unknown> = {}) => ({
  commandType: 'RecordCustomerPayment',
  tenantId: ids.tenant,
  accountId,
  receivingStationId: ids.station,
  amount: { amount: '10.0000', currency: 'USD' },
  source: { sourceType: 'CUSTOMER_PAYMENT', sourceId: uuid() },
  occurredAt: '2026-10-20T08:00:00+02:00',
  businessDate: '2026-10-20',
  ...extra,
});

describe('customer account controls (S13)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'S13 Tenant', 'c13-tenant'),
        ('${ids.otherTenant}', 'S13 Other Tenant', 'c13-other-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.adminActor}', 'S13 Admin', 'c13-admin@example.test'),
        ('${ids.supActor}', 'S13 Supervisor', 'c13-sup@example.test'),
        ('${ids.approverActor}', 'S13 Approver', 'c13-approver@example.test'),
        ('${ids.outsiderActor}', 'S13 Outsider', 'c13-outsider@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.adminActor}', 'ACTIVE'),
        ('${ids.supMembership}', '${ids.tenant}', '${ids.supActor}', 'ACTIVE'),
        ('${ids.approverMembership}', '${ids.tenant}', '${ids.approverActor}', 'ACTIVE'),
        ('${ids.outsiderMembership}', '${ids.otherTenant}', '${ids.outsiderActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'S13 Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'S13 Other Legal')
        on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'C13S1', 'S13 Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'C13S2', 'S13 Other Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.supMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.approverMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.otherTenant}', '${ids.outsiderMembership}', 'ADMINISTRATOR', 'TENANT', null, null)
        on conflict do nothing;
      insert into app.documents (id, tenant_id, legal_entity_id, station_id, subject_type, subject_id, kind,
        object_key, file_name, content_type, byte_size, sha256, uploaded_by) values
        ('${ids.document}', '${ids.tenant}', '${ids.legal}', '${ids.station}', 'RECONCILIATION',
         'c1300000-0000-4000-8000-0000000000aa', 'RECEIPT', 'private/documents/${ids.document}', 'slip.pdf',
         'application/pdf', 100, '${'a'.repeat(64)}', '${ids.adminMembership}')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.adminSession, ADMIN, ids.adminActor, true);
    await seedClerkSession(client, ids.supSession, SUPERVISOR, ids.supActor, true);
    await seedClerkSession(client, ids.outsiderSession, OUTSIDER, ids.outsiderActor, true);
    await seedActiveStepUp(client, ids.adminSession, ids.tenant);
    await seedActiveStepUp(client, ids.supSession, ids.tenant);
    await seedActiveStepUp(client, ids.outsiderSession, ids.otherTenant);

    reference = `C13-${Date.now()}`;
    const customer = await command({
      commandType: 'CreateCustomer',
      tenantId: ids.tenant,
      accountReference: reference,
      displayName: 'S13 Haulage',
      legalEntityId: ids.legal,
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const account = await command({
      commandType: 'CreateCustomerAccount',
      tenantId: ids.tenant,
      customerId: customer.body.customerId,
      accountType: 'CREDIT',
      currency: 'USD',
      creditLimit: '100.0000',
      stationScope: 'ALL',
    });
    expect(account.status, JSON.stringify(account.body)).toBe(201);
    accountId = account.body.accountId;
  });

  afterAll(async () => client?.end());

  it('records vehicle, driver, voucher, approver and document with a payment', async () => {
    const result = await command(
      paymentBody({
        entryDetails: {
          vehicleRegistration: 'abc 1234',
          driverName: 'T. Moyo',
          voucherNumber: 'V-100',
          approvedByMembershipId: ids.approverMembership,
          documentId: ids.document,
        },
      }),
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    paymentEntryId = result.body.entryId;
    const [row] = await client.unsafe(
      `select * from app.customer_ledger_entry_details where ledger_entry_id = '${paymentEntryId}'`,
    );
    expect(row).toMatchObject({
      tenant_id: ids.tenant,
      account_id: accountId,
      vehicle_registration: 'ABC 1234',
      driver_name: 'T. Moyo',
      voucher_number: 'V-100',
      approved_by_membership_id: ids.approverMembership,
      document_id: ids.document,
      recorded_by: ids.adminMembership,
    });
  });

  it('does not let an administrator approve their own entry', async () => {
    const result = await command(
      paymentBody({ entryDetails: { approvedByMembershipId: ids.adminMembership } }),
    );
    expect(result.status).toBe(400);
  });

  it('refuses a voucher number already used on the same account, ignoring case and spaces', async () => {
    const first = await command(paymentBody({ entryDetails: { voucherNumber: 'V-DUP-1' } }));
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await command(paymentBody({ entryDetails: { voucherNumber: ' v-dup-1 ' } }));
    expect(again.status).toBe(409);
  });

  it('adds details to an existing transaction once, and never changes them', async () => {
    const plain = await command(paymentBody());
    expect(plain.status).toBe(201);
    const entryId = plain.body.entryId;
    const added = await command({
      commandType: 'RecordCustomerEntryDetails',
      tenantId: ids.tenant,
      stationId: ids.station,
      ledgerEntryId: entryId,
      details: { driverName: 'P. Ncube', vehicleRegistration: 'xyz 9' },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const again = await command({
      commandType: 'RecordCustomerEntryDetails',
      tenantId: ids.tenant,
      stationId: ids.station,
      ledgerEntryId: entryId,
      details: { driverName: 'Someone else' },
    });
    expect(again.status).toBe(409);
    await expect(
      client.unsafe(
        `update app.customer_ledger_entry_details set driver_name = 'x' where ledger_entry_id = '${entryId}'`,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      client.unsafe(
        `delete from app.customer_ledger_entry_details where ledger_entry_id = '${entryId}'`,
      ),
    ).rejects.toThrow(/append-only/);
    const audit = await client.unsafe(
      `select 1 from platform.security_events where event_code = 'CUSTOMER.ENTRY_DETAILS_RECORDED' and details->>'subjectId' = '${entryId}'`,
    );
    expect(audit.length).toBeGreaterThan(0);
  });

  it('rejects an approver or document from outside the organisation', async () => {
    const approver = await command(
      paymentBody({ entryDetails: { approvedByMembershipId: ids.outsiderMembership } }),
    );
    expect(approver.status).toBe(400);
    const document = await command(
      paymentBody({ entryDetails: { documentId: 'c1300000-0000-4000-8000-0000000000ff' } }),
    );
    expect(document.status).toBe(404);
  });

  it('overrides a credit limit with approver and reason, keeps history, and audits it', async () => {
    const accountRow = async () =>
      (
        await client.unsafe(
          `select credit_limit::text as limit, version from app.customer_accounts where id = '${accountId}'`,
        )
      )[0]!;
    const before = await accountRow();
    expect(before.limit).toBe('100.0000');
    const result = await command({
      commandType: 'OverrideCustomerCreditLimit',
      tenantId: ids.tenant,
      accountId,
      expectedVersion: Number(before.version),
      newLimit: '2500.5000',
      approvedByMembershipId: ids.approverMembership,
      reason: 'Owner agreed by phone for the harvest season',
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ previousLimit: '100.0000', newLimit: '2500.5000' });
    expect((await accountRow()).limit).toBe('2500.5000');
    const history = await client.unsafe(
      `select previous_limit::text, new_limit::text, approved_by_membership_id, recorded_by, reason
         from app.customer_credit_limit_overrides where account_id = '${accountId}'`,
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      previous_limit: '100.0000',
      new_limit: '2500.5000',
      approved_by_membership_id: ids.approverMembership,
      recorded_by: ids.adminMembership,
    });
    const audit = await client.unsafe(
      `select 1 from platform.security_events
        where event_code = 'CUSTOMER.CREDIT_LIMIT_OVERRIDDEN' and details->>'subjectId' = '${accountId}'`,
    );
    expect(audit.length).toBeGreaterThan(0);
    await expect(
      client.unsafe(
        `delete from app.customer_credit_limit_overrides where account_id = '${accountId}'`,
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses stale versions, a missing reason, and people without the permission', async () => {
    const stale = await command({
      commandType: 'OverrideCustomerCreditLimit',
      tenantId: ids.tenant,
      accountId,
      expectedVersion: 0,
      newLimit: '9999.0000',
      approvedByMembershipId: ids.approverMembership,
      reason: 'stale',
    });
    expect(stale.status).toBe(409);
    const noReason = await command({
      commandType: 'OverrideCustomerCreditLimit',
      tenantId: ids.tenant,
      accountId,
      expectedVersion: 1,
      newLimit: '9999.0000',
      approvedByMembershipId: ids.approverMembership,
      reason: '   ',
    });
    expect(noReason.status).toBe(400);
    const supervisor = await command(
      {
        commandType: 'OverrideCustomerCreditLimit',
        tenantId: ids.tenant,
        accountId,
        expectedVersion: 1,
        newLimit: '9999.0000',
        approvedByMembershipId: ids.approverMembership,
        reason: 'I would like more',
      },
      SUPERVISOR,
    );
    expect(supervisor.status).toBe(403);
    const [row] = await client.unsafe(
      `select credit_limit::text as limit from app.customer_accounts where id = '${accountId}'`,
    );
    expect(row!.limit).toBe('2500.5000');
  });

  it('keeps other organisations out', async () => {
    const override = await command(
      {
        commandType: 'OverrideCustomerCreditLimit',
        tenantId: ids.otherTenant,
        accountId,
        expectedVersion: 1,
        newLimit: '1.0000',
        approvedByMembershipId: ids.outsiderMembership,
        reason: 'cross-tenant attempt',
      },
      OUTSIDER,
    );
    expect([403, 404]).toContain(override.status);
    const crossTenantDetails = await command(
      {
        commandType: 'RecordCustomerEntryDetails',
        tenantId: ids.otherTenant,
        stationId: ids.otherStation,
        ledgerEntryId: paymentEntryId,
        details: { driverName: 'Intruder' },
      },
      OUTSIDER,
    );
    expect(crossTenantDetails.status).toBe(404);

    // Row level security: the runtime role sees only its own organisation's rows.
    const visible = async (tenant: string | null, membership: string, actor: string) =>
      client.begin(async (tx) => {
        await tx.unsafe('set local role app_runtime');
        if (tenant) {
          await tx`select set_config('app.tenant_id', ${tenant}, true),
                          set_config('app.membership_id', ${membership}, true),
                          set_config('app.actor_id', ${actor}, true)`;
        }
        const details = await tx.unsafe('select 1 from app.customer_ledger_entry_details');
        const overrides = await tx.unsafe('select 1 from app.customer_credit_limit_overrides');
        return { details: details.length, overrides: overrides.length };
      });
    expect(
      (await visible(ids.tenant, ids.adminMembership, ids.adminActor)).details,
    ).toBeGreaterThan(0);
    expect(
      (await visible(ids.tenant, ids.adminMembership, ids.adminActor)).overrides,
    ).toBeGreaterThan(0);
    expect(await visible(ids.otherTenant, ids.outsiderMembership, ids.outsiderActor)).toEqual({
      details: 0,
      overrides: 0,
    });
    expect(await visible(null, ids.adminMembership, ids.adminActor)).toEqual({
      details: 0,
      overrides: 0,
    });
  });

  it('ages credit balances oldest-first and shows nothing to another organisation', async () => {
    const [account] = await client.unsafe(
      `select customer_id from app.customer_accounts where id = '${accountId}'`,
    );
    const customerId = account!.customer_id as string;
    // Charges are written by the A5 posting path; seed them directly for the report query.
    await client.unsafe(`
      insert into app.customer_ledger_entries
        (id, tenant_id, customer_id, account_id, account_type, entry_type, direction, amount,
         source_type, source_id, source_key, occurred_at, business_date, actor_membership_id) values
        ('${randomUUID()}', '${ids.tenant}', '${customerId}', '${accountId}', 'CREDIT', 'CREDIT_FUEL_CHARGE', 'INCREASE', 300.2500,
         'A5_RECONCILIATION_CUSTOMER_FUEL', '${randomUUID()}', 'c13-age-${accountId}-1', '2026-06-01T08:00:00Z', '2026-06-01', '${ids.adminMembership}'),
        ('${randomUUID()}', '${ids.tenant}', '${customerId}', '${accountId}', 'CREDIT', 'CREDIT_FUEL_CHARGE', 'INCREASE', 50.0000,
         'A5_RECONCILIATION_CUSTOMER_FUEL', '${randomUUID()}', 'c13-age-${accountId}-2', '2026-10-20T08:00:00Z', '2026-10-20', '${ids.adminMembership}')
        on conflict (id) do nothing;
    `);
    // Payments already recorded on this account total 30.0000 (three of 10.0000, dated 2026-10-20).
    const run = async (tenant: string, membership: string, actor: string) =>
      withTenantTransaction(
        createTrustedTenantTransactionContext({
          tenantId: tenant,
          actorId: actor,
          membershipId: membership,
          requestId: 'c1300000-0000-4000-8000-0000000001c1',
        }),
        (transaction) =>
          readCustomerAgeing(
            transaction,
            {
              tenantId: tenant,
              fromDate: '2026-10-01',
              toDate: '2026-10-23',
              stationIds: [],
            } as never,
            { legalEntityIds: [] },
          ),
      );
    const rows = await run(ids.tenant, ids.adminMembership, ids.adminActor);
    const mine = rows.find((row) => row.accountReference === reference);
    // 350.2500 charged, 30.0000 paid; the payments clear the oldest (June) charge first.
    expect(mine).toMatchObject({
      over90: '270.2500',
      current: '0.0000',
      days1to30: '50.0000',
      totalOwed: '320.2500',
      oldestUnpaid: '2026-06-01',
    });
    expect(await run(ids.otherTenant, ids.outsiderMembership, ids.outsiderActor)).toEqual([]);
  });
});
