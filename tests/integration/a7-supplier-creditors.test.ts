import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as supplierCommandPost } from '../../src/app/api/suppliers/commands/route';
import { GET as supplierSummaryGet } from '../../src/app/api/suppliers/summary/route';
import { GET as supplierStatementGet } from '../../src/app/api/suppliers/statement/route';
import { GET as supplierPendingGet } from '../../src/app/api/suppliers/pending/route';

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
  return token;
}

async function command(input: Record<string, unknown>, key: string) {
  return supplierCommandPost(
    new Request('http://127.0.0.1:3000/api/suppliers/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(await signedCookie('a7-session-token')),
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

    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a7-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a7-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'A7 Supplier Tenant', 'a7-supplier-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values ('${ids.actor}', 'A7 Finance', 'a7-finance@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${ids.legal}', '${ids.tenant}', 'A7 Supplier Legal') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id)
        values ('${ids.tenant}', '${ids.membership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}') on conflict do nothing;
    `);
    await seedClerkSession(client, ids.session, 'a7-session-token', ids.actor, true);
    await seedActiveStepUp(client, ids.session, ids.tenant);
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
        paymentTerms: 'CASH',
        referenceNumber: 'INV-A7-001',
        documentDate: '2026-09-24',
        amount: '100.2500',
        lines: [{ description: 'A7 fuel supply', quantity: '1', unitPrice: '100.25' }],
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
    const posting = await client<{ before_state: string; after_state: string }[]>`
      select details->'before'->>'state' as before_state, details->'after'->>'state' as after_state
      from platform.security_events
      where tenant_id = ${ids.tenant} and details->>'subjectId' = ${document.documentId}
        and event_code = 'SUPPLIER.DOCUMENT_POSTED'
    `;
    expect(posting).toEqual([{ before_state: 'SUBMITTED', after_state: 'POSTED' }]);

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
            ...clerkHeaders(await signedCookie('a7-session-token')),
          },
        },
      ),
    );
    const summaryRow = (await json(summary))[0];
    expect(summaryRow.total).toBe('40.2500');
    // A document without a due date is neither due nor overdue.
    expect(summaryRow).toMatchObject({
      dueToday: '0',
      dueSoon: '0',
      dueSoonDays: 7,
      overdueAging: { days1To7: '0', days8To14: '0', days15To30: '0', over30: '0' },
    });
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
            ...clerkHeaders(await signedCookie('a7-session-token')),
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
            ...clerkHeaders(await signedCookie('a7-session-token')),
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

  it('keeps an unposted invoice out of what is owed and lists it as waiting to be posted', async () => {
    const base = { tenantId: ids.tenant, legalEntityId: ids.legal };
    const created = await json(
      await command(
        {
          ...base,
          commandType: 'CreateSupplier',
          code: 'A7-WAIT',
          legalName: 'A7 Waiting Supplier',
        },
        'a7-wait-supplier',
      ),
    );
    const submitted = await json(
      await command(
        {
          ...base,
          commandType: 'SubmitSupplierDocument',
          supplierId: created.supplierId,
          documentType: 'INVOICE',
          paymentTerms: 'CREDIT',
          creditPeriodDays: 30,
          referenceNumber: 'INV-WAIT-001',
          documentDate: '2099-01-01',
          dueDate: '2099-01-31',
          amount: '8800.0000',
          lines: [{ description: 'A7 waiting fuel', quantity: '1', unitPrice: '8800' }],
        },
        'a7-wait-submit',
      ),
    );
    const headers = { ...clerkHeaders(await signedCookie('a7-session-token')) };
    const query = `tenantId=${ids.tenant}&legalEntityId=${ids.legal}&supplierId=${created.supplierId}`;
    const summaryOf = async () =>
      (
        await json(
          await supplierSummaryGet(
            new Request(`http://127.0.0.1:3000/api/suppliers/summary?${query}`, { headers }),
          ),
        )
      )[0];
    const pendingOf = async () =>
      (await (
        await supplierPendingGet(
          new Request(`http://127.0.0.1:3000/api/suppliers/pending?${query}`, { headers }),
        )
      ).json()) as Array<Record<string, any>>;

    // Submitted but not posted: nothing is owed or "not yet due", and it is listed as waiting.
    expect(await summaryOf()).toMatchObject({ total: '0', current: '0', overdue: '0' });
    expect(await pendingOf()).toEqual([
      expect.objectContaining({
        id: submitted.documentId,
        referenceNumber: 'INV-WAIT-001',
        amount: '8800.0000',
        version: 0,
      }),
    ]);

    expect(
      (
        await command(
          {
            ...base,
            commandType: 'PostSupplierDocument',
            documentId: submitted.documentId,
            expectedVersion: 0,
          },
          'a7-wait-post',
        )
      ).status,
    ).toBe(200);

    // Posted: it now counts, on the same basis in both figures, and the waiting list empties.
    expect(await summaryOf()).toMatchObject({ total: '8800.0000', current: '8800.0000' });
    expect(await pendingOf()).toEqual([]);
  });

  it('returns an unposted invoice with a reason and lets its reference be entered again', async () => {
    const base = { tenantId: ids.tenant, legalEntityId: ids.legal };
    const created = await json(
      await command(
        { ...base, commandType: 'CreateSupplier', code: 'A7-RET', legalName: 'A7 Return Supplier' },
        'a7-ret-supplier',
      ),
    );
    const invoice = (key: string) =>
      command(
        {
          ...base,
          commandType: 'SubmitSupplierDocument',
          supplierId: created.supplierId,
          documentType: 'INVOICE',
          paymentTerms: 'CASH',
          referenceNumber: 'INV-RET-001',
          documentDate: '2099-01-01',
          amount: '500.0000',
          lines: [{ description: 'A7 returned fuel', quantity: '1', unitPrice: '500' }],
        },
        key,
      );
    const first = await json(await invoice('a7-ret-submit-1'));
    // The reference is taken while the invoice is waiting.
    expect((await invoice('a7-ret-submit-dup')).status).toBe(409);

    const returnIt = (reason: string, key: string, version = 0) =>
      command(
        {
          ...base,
          commandType: 'ReturnSupplierDocument',
          documentId: first.documentId,
          expectedVersion: version,
          reason,
        },
        key,
      );
    expect((await returnIt('  ', 'a7-ret-blank')).status).toBeGreaterThanOrEqual(400);
    const returned = await returnIt('Wrong amount on the paper invoice', 'a7-ret-ok');
    expect(returned.status).toBe(200);
    expect(await json(returned)).toMatchObject({ state: 'RETURNED', version: 1 });

    const row = (
      await client.unsafe(
        'select state, return_reason, returned_by is not null as has_actor from app.supplier_documents where id = $1',
        [first.documentId],
      )
    )[0];
    expect(row).toMatchObject({
      state: 'RETURNED',
      return_reason: 'Wrong amount on the paper invoice',
      has_actor: true,
    });

    // Returned is final: it cannot be posted, and the reference is free for the corrected invoice.
    expect(
      (
        await command(
          {
            ...base,
            commandType: 'PostSupplierDocument',
            documentId: first.documentId,
            expectedVersion: 1,
          },
          'a7-ret-post-after',
        )
      ).status,
    ).toBe(409);
    expect((await invoice('a7-ret-submit-2')).status).toBe(201);
  });

  it('records the station and what each invoice line is for', async () => {
    const base = { tenantId: ids.tenant, legalEntityId: ids.legal };
    const supplier = await json(
      await command(
        {
          ...base,
          commandType: 'CreateSupplier',
          code: 'A7-LT',
          legalName: 'A7 Line Type Supplier',
        },
        'a7-lt-supplier',
      ),
    );
    const invoice = (
      extra: Record<string, unknown>,
      lines: Record<string, unknown>[],
      key: string,
    ) =>
      command(
        {
          ...base,
          commandType: 'SubmitSupplierDocument',
          supplierId: supplier.supplierId,
          documentType: 'INVOICE',
          paymentTerms: 'CASH',
          documentDate: '2099-01-01',
          amount: '510.0000',
          lines,
          ...extra,
        },
        key,
      );
    const fuelLine = { lineType: 'FUEL', description: 'Diesel', quantity: '100', unitPrice: '4.5' };
    const haulage = {
      lineType: 'TRANSPORT',
      description: 'Haulage',
      quantity: '1',
      unitPrice: '60',
    };
    const ok = await invoice({ referenceNumber: 'INV-LT-001' }, [fuelLine, haulage], 'a7-lt-1');
    expect(ok.status).toBe(201);
    const stored = await client.unsafe(
      'select line_no, line_type from app.supplier_document_lines where supplier_document_id = $1 order by line_no',
      [(await json(ok)).documentId],
    );
    expect(stored.map((row) => row.line_type)).toEqual(['FUEL', 'TRANSPORT']);

    const stationId = 'a7b00000-0000-4000-8000-000000000061';
    await client.unsafe(
      `insert into app.stations (id, tenant_id, legal_entity_id, code, name, status)
       values ($1, $2, $3, 'A7-LT-ST', 'A7 Line Type Station', 'ACTIVE')`,
      [stationId, ids.tenant, ids.legal],
    );
    const withStation = await invoice(
      { referenceNumber: 'INV-LT-004', stationId },
      [fuelLine, haulage],
      'a7-lt-4',
    );
    expect(withStation.status).toBe(201);
    const [header] = await client.unsafe(
      'select station_id from app.supplier_documents where id = $1',
      [(await json(withStation)).documentId],
    );
    expect(header?.station_id).toBe(stationId);

    // A station from another company is refused; an unknown line type is refused by the schema.
    expect(
      (
        await invoice(
          { referenceNumber: 'INV-LT-002', stationId: '00000000-0000-4000-8000-000000000999' },
          [fuelLine, haulage],
          'a7-lt-2',
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await invoice(
          { referenceNumber: 'INV-LT-003' },
          [{ ...haulage, lineType: 'SNACKS' }],
          'a7-lt-3',
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it('sets, reports and clears a supplier credit limit without blocking purchases', async () => {
    const base = { tenantId: ids.tenant, legalEntityId: ids.legal };
    const created = await json(
      await command(
        {
          ...base,
          commandType: 'CreateSupplier',
          code: 'A7-LIMIT',
          legalName: 'A7 Limit Supplier',
        },
        'a7-limit-create',
      ),
    );
    const readRow = async () => {
      const response = await supplierSummaryGet(
        new Request(
          `http://127.0.0.1:3000/api/suppliers/summary?tenantId=${ids.tenant}&legalEntityId=${ids.legal}&supplierId=${created.supplierId}`,
          { headers: { ...clerkHeaders(await signedCookie('a7-session-token')) } },
        ),
      );
      return (await json(response))[0];
    };

    const before = await readRow();
    expect(before.creditLimit).toMatchObject({ status: 'none', limit: null });

    const set = await command(
      {
        ...base,
        commandType: 'SetSupplierCreditLimit',
        supplierId: created.supplierId,
        expectedVersion: before.version,
        creditLimit: '1000.00',
      },
      'a7-limit-set',
    );
    expect(set.status).toBe(200);
    const stale = await command(
      {
        ...base,
        commandType: 'SetSupplierCreditLimit',
        supplierId: created.supplierId,
        expectedVersion: before.version,
        creditLimit: '2000',
      },
      'a7-limit-stale',
    );
    expect(stale.status).toBe(409);

    const after = await readRow();
    expect(after.creditLimit).toMatchObject({
      status: 'ok',
      limit: '1000.0000',
      available: '1000',
    });

    const cleared = await command(
      {
        ...base,
        commandType: 'SetSupplierCreditLimit',
        supplierId: created.supplierId,
        expectedVersion: after.version,
        creditLimit: null,
      },
      'a7-limit-clear',
    );
    expect(cleared.status).toBe(200);
    expect((await readRow()).creditLimit.status).toBe('none');

    // The signed audit record keeps the limit as it was before each change.
    const limitChanges = await client<{ before_limit: string | null; after_version: number }[]>`
      select details->'before'->>'creditLimit' as before_limit,
             (details->'after'->>'version')::int as after_version
      from platform.security_events
      where tenant_id = ${ids.tenant} and details->>'subjectId' = ${created.supplierId}
        and event_code = 'SUPPLIER.CREDIT_LIMIT_SET'
      order by occurred_at
    `;
    expect(limitChanges.map((row) => row.before_limit)).toEqual([null, '1000.0000']);
  });

  it('does not let another tenant act on this tenant’s supplier', async () => {
    const other = {
      tenant: 'a7b00000-0000-4000-8000-0000000000a1',
      legal: 'a7b00000-0000-4000-8000-0000000000a2',
      actor: 'a7b00000-0000-4000-8000-0000000000a3',
      membership: 'a7b00000-0000-4000-8000-0000000000a4',
      session: 'a7b00000-0000-4000-8000-0000000000a5',
    };
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values ('${other.tenant}', 'A7 Other Tenant', 'a7-other-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values ('${other.actor}', 'A7 Other Finance', 'a7-other-finance@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${other.membership}', '${other.tenant}', '${other.actor}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${other.legal}', '${other.tenant}', 'A7 Other Legal') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id)
        values ('${other.tenant}', '${other.membership}', 'FINANCE', 'LEGAL_ENTITY', '${other.legal}') on conflict do nothing;
    `);
    await seedClerkSession(client, other.session, 'a7-other-session-token', other.actor, true);
    await seedActiveStepUp(client, other.session, other.tenant);

    const owner = { tenantId: ids.tenant, legalEntityId: ids.legal };
    const created = await command(
      { ...owner, commandType: 'CreateSupplier', code: 'A7-ISO-1', legalName: 'A7 Isolated' },
      'a7-iso-create',
    );
    expect(created.status).toBe(201);
    const supplierId = (await json(created)).supplierId as string;

    const asOther = async (input: Record<string, unknown>, key: string) =>
      supplierCommandPost(
        new Request('http://127.0.0.1:3000/api/suppliers/commands', {
          method: 'POST',
          headers: {
            ...clerkHeaders('a7-other-session-token'),
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify(input),
        }),
      );
    const invoice = {
      commandType: 'SubmitSupplierDocument',
      supplierId,
      documentType: 'INVOICE',
      paymentTerms: 'CASH',
      referenceNumber: 'INV-ISO-1',
      documentDate: '2026-09-24',
      amount: '10.0000',
      lines: [{ description: 'Isolation', quantity: '1', unitPrice: '10' }],
    };

    // Naming the owner's tenant is refused: the caller has no membership there.
    const intoOwnerTenant = await asOther({ ...owner, ...invoice }, 'a7-iso-1');
    expect(intoOwnerTenant.status).toBeGreaterThanOrEqual(400);
    expect(intoOwnerTenant.status).toBeLessThan(500);

    // Using their own tenant but the owner's supplier id cannot find that supplier.
    const withForeignSupplier = await asOther(
      { tenantId: other.tenant, legalEntityId: other.legal, ...invoice },
      'a7-iso-2',
    );
    expect(withForeignSupplier.status).toBeGreaterThanOrEqual(400);
    expect(withForeignSupplier.status).toBeLessThan(500);

    const [row] = await client.unsafe(
      `select count(*)::int as n from app.supplier_documents where supplier_id = '${supplierId}'`,
    );
    expect(row?.n).toBe(0);
  });

  it('refuses a repeated invoice or payment reference for one supplier but allows it for another', async () => {
    const base = { tenantId: ids.tenant, legalEntityId: ids.legal };
    const supplierOf = async (code: string) => {
      const created = await command(
        { ...base, commandType: 'CreateSupplier', code, legalName: `${code} Supplier` },
        `a7-dup-create-${code}`,
      );
      expect(created.status).toBe(201);
      return (await json(created)).supplierId as string;
    };
    const invoice = (supplierId: string, key: string) =>
      command(
        {
          ...base,
          commandType: 'SubmitSupplierDocument',
          supplierId,
          documentType: 'INVOICE',
          paymentTerms: 'CASH',
          referenceNumber: 'INV-DUP-1',
          documentDate: '2026-09-24',
          amount: '10.0000',
          lines: [{ description: 'Dup check', quantity: '1', unitPrice: '10' }],
        },
        key,
      );
    const pay = (supplierId: string, key: string) =>
      command(
        {
          ...base,
          commandType: 'SubmitSupplierPayment',
          supplierId,
          paymentDate: '2026-09-24',
          reference: 'PAY-DUP-1',
          amount: '5.0000',
        },
        key,
      );

    const first = await supplierOf('A7-DUP-A');
    const second = await supplierOf('A7-DUP-B');

    expect((await invoice(first, 'a7-dup-inv-1')).status).toBe(201);
    const repeatedInvoice = await invoice(first, 'a7-dup-inv-2');
    expect(repeatedInvoice.status).toBeGreaterThanOrEqual(400);
    expect(repeatedInvoice.status).toBeLessThan(500);
    expect((await invoice(second, 'a7-dup-inv-3')).status).toBe(201);

    expect((await pay(first, 'a7-dup-pay-1')).status).toBe(201);
    const repeatedPayment = await pay(first, 'a7-dup-pay-2');
    expect(repeatedPayment.status).toBeGreaterThanOrEqual(400);
    expect(repeatedPayment.status).toBeLessThan(500);
    expect((await pay(second, 'a7-dup-pay-3')).status).toBe(201);
  });
});
