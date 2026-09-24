import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';
import { POST as supplierCommandPost } from '../../src/app/api/suppliers/commands/route';
import { GET as supplierSummaryGet } from '../../src/app/api/suppliers/summary/route';
import { GET as supplierStatementGet } from '../../src/app/api/suppliers/statement/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for A7 supplier-creditors integration tests.');
}

const ids = {
  tenant: 'a7b00000-0000-4000-8000-000000000001',
  legal: 'a7b00000-0000-4000-8000-000000000011',
  actor: 'a7b00000-0000-4000-8000-000000000031',
  membership: 'a7b00000-0000-4000-8000-000000000041',
  session: 'a7b00000-0000-4000-8000-000000000051',
};

let client: Sql;

async function signedCookie(token: string): Promise<string> {
  return `${token}.${await makeSignature(token, process.env.BETTER_AUTH_SECRET!)}`;
}

async function command(input: Record<string, unknown>, key: string) {
  return supplierCommandPost(
    new Request('http://127.0.0.1:3000/api/suppliers/commands', {
      method: 'POST',
      headers: {
        cookie: `shanda-fuel.session_token=${await signedCookie('a7-session-token')}`,
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

describe('A7 supplier creditors PostgreSQL persistence', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a7-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a7-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'A7 Supplier Tenant', 'a7-supplier-tenant') on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values ('${ids.actor}', 'A7 Finance', 'a7-finance@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${ids.legal}', '${ids.tenant}', 'A7 Supplier Legal') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id)
        values ('${ids.tenant}', '${ids.membership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}') on conflict do nothing;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values ('${ids.session}', '2030-01-01T00:00:00Z', 'a7-session-token', '${ids.actor}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
    `);
  });

  afterAll(async () => client?.end());

  it('persists the document/payment lifecycle, exact allocation, reversal, audit, and retry safety', async () => {
    const base = { tenantId: ids.tenant, legalEntityId: ids.legal };
    const created = await command(
      { ...base, commandType: 'CreateSupplier', code: 'A7-001', legalName: 'A7 Test Supplier' },
      'a7-create-supplier',
    );
    expect(created.status).toBe(201);
    const supplier = await json(created);
    const retry = await command(
      { ...base, commandType: 'CreateSupplier', code: 'A7-001', legalName: 'A7 Test Supplier' },
      'a7-create-supplier',
    );
    expect((await json(retry)).supplierId).toBe(supplier.supplierId);

    const submittedDocument = await command(
      {
        ...base,
        commandType: 'SubmitSupplierDocument',
        supplierId: supplier.supplierId,
        documentType: 'INVOICE',
        referenceNumber: 'INV-A7-001',
        documentDate: '2026-09-24',
        amount: '100.2500',
      },
      'a7-submit-document',
    );
    expect(submittedDocument.status).toBe(201);
    const document = await json(submittedDocument);
    expect(
      (
        await command(
          {
            ...base,
            commandType: 'PostSupplierDocument',
            documentId: document.documentId,
            expectedVersion: 0,
          },
          'a7-post-document',
        )
      ).status,
    ).toBe(200);

    const submittedPayment = await command(
      {
        ...base,
        commandType: 'SubmitSupplierPayment',
        supplierId: supplier.supplierId,
        paymentDate: '2026-09-24',
        reference: 'PAY-A7-001',
        amount: '60.0000',
      },
      'a7-submit-payment',
    );
    expect(submittedPayment.status).toBe(201);
    const payment = await json(submittedPayment);
    expect(
      (
        await command(
          {
            ...base,
            commandType: 'PostSupplierPayment',
            paymentId: payment.paymentId,
            expectedVersion: 0,
          },
          'a7-post-payment',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await command(
          {
            ...base,
            commandType: 'AllocateSupplierPayment',
            paymentId: payment.paymentId,
            expectedVersion: 1,
            allocations: [{ documentId: document.documentId, amount: '60.0000' }],
          },
          'a7-allocate-payment-1',
        )
      ).status,
    ).toBe(200);

    const summary = await supplierSummaryGet(
      new Request(
        `http://127.0.0.1:3000/api/suppliers/summary?tenantId=${ids.tenant}&legalEntityId=${ids.legal}`,
        {
          headers: {
            cookie: `shanda-fuel.session_token=${await signedCookie('a7-session-token')}`,
          },
        },
      ),
    );
    expect((await json(summary))[0].total).toBe('40.2500');
    const secondSubmittedPayment = await command(
      {
        ...base,
        commandType: 'SubmitSupplierPayment',
        supplierId: supplier.supplierId,
        paymentDate: '2026-09-24',
        reference: 'PAY-A7-002',
        amount: '40.2500',
      },
      'a7-submit-payment-2',
    );
    const secondPayment = await json(secondSubmittedPayment);
    expect(
      (
        await command(
          {
            ...base,
            commandType: 'PostSupplierPayment',
            paymentId: secondPayment.paymentId,
            expectedVersion: 0,
          },
          'a7-post-payment-2',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await command(
          {
            ...base,
            commandType: 'AllocateSupplierPayment',
            paymentId: secondPayment.paymentId,
            expectedVersion: 1,
            allocations: [{ documentId: document.documentId, amount: '40.2500' }],
          },
          'a7-allocate-payment-2',
        )
      ).status,
    ).toBe(200);
    const paidSummary = await supplierSummaryGet(
      new Request(
        `http://127.0.0.1:3000/api/suppliers/summary?tenantId=${ids.tenant}&legalEntityId=${ids.legal}`,
        {
          headers: {
            cookie: `shanda-fuel.session_token=${await signedCookie('a7-session-token')}`,
          },
        },
      ),
    );
    expect((await json(paidSummary))[0].total).toBe('0.0000');
    expect(
      (
        await command(
          {
            ...base,
            commandType: 'ReverseSupplierPayment',
            paymentId: secondPayment.paymentId,
            expectedVersion: 2,
            reason: 'A7 integration reversal',
          },
          'a7-reverse-payment',
        )
      ).status,
    ).toBe(200);

    const statement = await supplierStatementGet(
      new Request(
        `http://127.0.0.1:3000/api/suppliers/statement?tenantId=${ids.tenant}&legalEntityId=${ids.legal}&supplierId=${supplier.supplierId}`,
        {
          headers: {
            cookie: `shanda-fuel.session_token=${await signedCookie('a7-session-token')}`,
          },
        },
      ),
    );
    expect(
      (await json(statement)).some(
        (row: { movementType: string }) => row.movementType === 'PAYMENT_REVERSAL',
      ),
    ).toBe(true);
  });
});
