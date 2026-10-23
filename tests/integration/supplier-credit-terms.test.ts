import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as supplierCommandPost } from '../../src/app/api/suppliers/commands/route';
import { GET as supplierDueGet } from '../../src/app/api/suppliers/due/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for supplier credit-terms integration tests.');
}

const ids = {
  tenant: 'cc700000-0000-4000-8000-000000000001',
  legal: 'cc700000-0000-4000-8000-000000000011',
  actor: 'cc700000-0000-4000-8000-000000000031',
  membership: 'cc700000-0000-4000-8000-000000000041',
  session: 'cc700000-0000-4000-8000-000000000051',
};
const TOKEN = 'cc7-session-token';

let client: Sql;

async function command(input: Record<string, unknown>, key: string) {
  return supplierCommandPost(
    new Request('http://127.0.0.1:3000/api/suppliers/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(TOKEN),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function json(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

describe('supplier credit terms and the due schedule (PostgreSQL)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-cc7-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-cc7-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'CC7 Tenant', 'cc7-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values ('${ids.actor}', 'CC7 Finance', 'cc7-finance@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${ids.legal}', '${ids.tenant}', 'CC7 Legal') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id)
        values ('${ids.tenant}', '${ids.membership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}') on conflict do nothing;
    `);
    await seedClerkSession(client, ids.session, TOKEN, ids.actor, true);
    await seedActiveStepUp(client, ids.session, ids.tenant);
  });

  afterAll(async () => client?.end());

  it('works out the due date, enforces the rules, and lists what is due by bucket', async () => {
    const base = { tenantId: ids.tenant, legalEntityId: ids.legal };
    const supplier = await json(
      await command(
        { ...base, commandType: 'CreateSupplier', code: 'CC7-001', legalName: 'CC7 Supplier' },
        'cc7-create-supplier',
      ),
    );
    const invoice = (extra: Record<string, unknown>, key: string, amount = '100.0000') =>
      command(
        {
          ...base,
          commandType: 'SubmitSupplierDocument',
          supplierId: supplier.supplierId,
          documentType: 'INVOICE',
          documentDate: '2026-10-01',
          amount,
          lines: [{ description: 'Fuel supply', quantity: '1', unitPrice: amount }],
          ...extra,
        },
        key,
      );
    const post = async (documentId: string, key: string) =>
      expect(
        (
          await command(
            { ...base, commandType: 'PostSupplierDocument', documentId, expectedVersion: 0 },
            key,
          )
        ).status,
      ).toBe(200);

    // Credit with a 30-day period: due date is calculated, not typed.
    const credit30 = await invoice(
      { referenceNumber: 'CC7-C30', paymentTerms: 'CREDIT', creditPeriodDays: 30 },
      'cc7-c30',
    );
    expect(credit30.status).toBe(201);
    const credit30Body = await json(credit30);
    expect(credit30Body).toMatchObject({
      paymentTerms: 'CREDIT',
      creditPeriodDays: 30,
      dueDate: '2026-10-31',
    });
    await post(credit30Body.documentId, 'cc7-post-c30');

    // Credit with a 7-day period, already late as of 2026-10-23.
    const credit7 = await json(
      await invoice(
        { referenceNumber: 'CC7-C7', paymentTerms: 'CREDIT', creditPeriodDays: 7 },
        'cc7-c7',
        '50.5000',
      ),
    );
    expect(credit7.dueDate).toBe('2026-10-08');
    await post(credit7.documentId, 'cc7-post-c7');

    // Cash: no period, no due date, and not part of the due schedule.
    const cash = await json(
      await invoice({ referenceNumber: 'CC7-CASH', paymentTerms: 'CASH' }, 'cc7-cash'),
    );
    expect(cash.dueDate).toBeNull();
    await post(cash.documentId, 'cc7-post-cash');

    // Older callers that send no terms keep working: no due date means "No due date set".
    const legacy = await json(
      await invoice({ referenceNumber: 'CC7-LEGACY' }, 'cc7-legacy', '20.0000'),
    );
    expect(legacy.paymentTerms).toBeNull();
    await post(legacy.documentId, 'cc7-post-legacy');

    // Rule: a credit purchase needs a period or a due date.
    const missing = await invoice(
      { referenceNumber: 'CC7-BAD1', paymentTerms: 'CREDIT' },
      'cc7-bad1',
    );
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.status).toBeLessThan(500);
    // Rule: a typed due date must agree with the period.
    const mismatch = await invoice(
      {
        referenceNumber: 'CC7-BAD2',
        paymentTerms: 'CREDIT',
        creditPeriodDays: 30,
        dueDate: '2026-12-31',
      },
      'cc7-bad2',
    );
    expect(mismatch.status).toBeGreaterThanOrEqual(400);
    expect(mismatch.status).toBeLessThan(500);
    // Rule: cash has no due date.
    const cashDue = await invoice(
      { referenceNumber: 'CC7-BAD3', paymentTerms: 'CASH', dueDate: '2026-11-01' },
      'cc7-bad3',
    );
    expect(cashDue.status).toBeGreaterThanOrEqual(400);
    expect(cashDue.status).toBeLessThan(500);

    // Instalments: pay part of the 30-day invoice; only the unpaid balance is due.
    const payment = await json(
      await command(
        {
          ...base,
          commandType: 'SubmitSupplierPayment',
          supplierId: supplier.supplierId,
          paymentDate: '2026-10-10',
          reference: 'CC7-PAY-1',
          amount: '40.0000',
        },
        'cc7-pay-1',
      ),
    );
    await command(
      {
        ...base,
        commandType: 'PostSupplierPayment',
        paymentId: payment.paymentId,
        expectedVersion: 0,
      },
      'cc7-post-pay-1',
    );
    expect(
      (
        await command(
          {
            ...base,
            commandType: 'AllocateSupplierPayment',
            paymentId: payment.paymentId,
            expectedVersion: 1,
            allocations: [{ documentId: credit30Body.documentId, amount: '40.0000' }],
          },
          'cc7-alloc-1',
        )
      ).status,
    ).toBe(200);

    const due = await json(
      await supplierDueGet(
        new Request(
          `http://127.0.0.1:3000/api/suppliers/due?tenantId=${ids.tenant}&legalEntityId=${ids.legal}&asOf=2026-10-23`,
          { headers: { ...clerkHeaders(TOKEN) } },
        ),
      ),
    );
    const group = (bucket: string) => due.groups.find((g: any) => g.bucket === bucket);
    expect(group('OVERDUE').rows.map((r: any) => r.referenceNumber)).toEqual(['CC7-C7']);
    expect(group('OVERDUE').total).toBe('50.5000');
    expect(group('DAYS_8_TO_14').rows.map((r: any) => [r.referenceNumber, r.balance])).toEqual([
      ['CC7-C30', '60.0000'],
    ]);
    expect(group('NO_DUE_DATE').rows.map((r: any) => r.referenceNumber)).toEqual(['CC7-LEGACY']);
    expect(group('WITHIN_7').count).toBe(0);
    expect(due.total).toBe('130.5000');

    // The database refuses bad terms even if the app were bypassed: a submitted (not yet posted)
    // credit invoice cannot lose its due date, and a posted one cannot change its terms.
    const submitted = await json(
      await invoice(
        { referenceNumber: 'CC7-SUB', paymentTerms: 'CREDIT', creditPeriodDays: 5 },
        'cc7-sub',
      ),
    );
    await expect(
      client.unsafe(`
        update app.supplier_documents set due_date = null
        where id = '${submitted.documentId}'
      `),
    ).rejects.toThrow(/supplier_documents_terms_shape_ck/);
    await expect(
      client.unsafe(`
        update app.supplier_documents set payment_terms = 'CASH', credit_period_days = null,
          due_date = null
        where id = '${credit30Body.documentId}'
      `),
    ).rejects.toThrow(/immutable/);
  });
});
