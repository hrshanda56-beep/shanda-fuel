import {
  seedClerkSession,
  seedActiveStepUp,
  setFixtureStrongAuthentication,
  clerkHeaders,
} from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as commandPost } from '../../src/app/api/sales-documents/commands/route';
import { downloadSalesDocumentPdfFromRequest } from '../../src/modules/sales-documents/download';
import { sendSalesDocumentEmailFromRequest } from '../../src/modules/sales-documents/send';

// The real sender would call Resend. Everything else in the send path runs for real.
const sentEmails = vi.hoisted(() => ({
  calls: [] as { to: string; subject: string; text: string; attachments?: { content: Buffer }[] }[],
  failWith: null as null | 'configuration' | 'provider',
}));
vi.mock('../../src/platform/email', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/platform/email')>();
  return {
    ...original,
    createResendEmailSender: () => ({
      send: async (message: (typeof sentEmails.calls)[number]) => {
        if (sentEmails.failWith === 'configuration') throw new original.EmailError('configuration');
        if (sentEmails.failWith === 'provider') throw new Error('provider down');
        sentEmails.calls.push(message);
        return { messageId: 'test-message' };
      },
    }),
  };
});
import {
  getSalesDocumentCapabilitiesFromRequest,
  getSalesDocumentCustomersFromRequest,
  getSalesDocumentFromRequest,
  getSalesDocumentProfileFromRequest,
  listSalesDocumentsFromRequest,
} from '../../src/modules/sales-documents/queries';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the sales documents integration tests.');
}

const ids = {
  tenant: '5d000000-0000-4000-8000-000000000001',
  legal: '5d000000-0000-4000-8000-000000000011',
  legal2: '5d000000-0000-4000-8000-000000000012',
  finance: '5d000000-0000-4000-8000-000000000031',
  financeMembership: '5d000000-0000-4000-8000-000000000041',
  financeSession: '5d000000-0000-4000-8000-000000000051',
  admin: '5d000000-0000-4000-8000-000000000032',
  adminMembership: '5d000000-0000-4000-8000-000000000042',
  adminSession: '5d000000-0000-4000-8000-000000000052',
  supervisor: '5d000000-0000-4000-8000-000000000033',
  supervisorMembership: '5d000000-0000-4000-8000-000000000043',
  supervisorSession: '5d000000-0000-4000-8000-000000000053',
  station: '5d000000-0000-4000-8000-000000000021',
  tenantB: '5d100000-0000-4000-8000-000000000001',
  legalB: '5d100000-0000-4000-8000-000000000011',
  financeB: '5d100000-0000-4000-8000-000000000031',
  financeBMembership: '5d100000-0000-4000-8000-000000000041',
  financeBSession: '5d100000-0000-4000-8000-000000000051',
};
const tokens = {
  finance: 'sd-finance-token',
  admin: 'sd-admin-token',
  supervisor: 'sd-supervisor-token',
  financeB: 'sd-finance-b-token',
};

type Json = Record<string, any>;
let client: Sql;

async function command(token: string | null, input: Json, key: string = randomUUID()) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-real-ip': `sd-${randomUUID()}`,
  });
  if (token)
    for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
  const response = await commandPost(
    new Request('http://127.0.0.1:3000/api/sales-documents/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }),
  );
  return { status: response.status, json: (await response.json()) as Json };
}

const entity = { tenantId: ids.tenant, legalEntityId: ids.legal };
const readRequest = (token: string) =>
  new Request('http://127.0.0.1:3000/sales-documents', { headers: clerkHeaders(token) });

const profile = {
  ...entity,
  commandType: 'SaveSalesDocProfile',
  displayName: 'Shanda Fuel (Pvt) Ltd',
  address: '1 Main Road, Harare',
  taxLabel: 'VAT',
  taxNumber: 'TIN-123',
  defaultTaxRate: '15',
  quotationPrefix: 'QT',
  invoicePrefix: 'INV',
  receiptPrefix: 'RC',
};

const line = (over: Json = {}) => ({
  description: 'Diesel',
  quantity: '100',
  unitLabel: 'L',
  unitPrice: '1.50',
  discountAmount: '0',
  taxRate: '15',
  ...over,
});

function draft(over: Json = {}) {
  return {
    ...entity,
    commandType: 'SaveSalesDocumentDraft',
    docType: 'INVOICE',
    recipientName: 'Acme Transport',
    recipientAddress: '5 Depot Road',
    issueDate: '2026-11-18',
    dueDate: '2026-12-18',
    taxLabel: 'VAT',
    lines: [line()],
    ...over,
  };
}

async function issued(type: 'QUOTATION' | 'INVOICE' = 'INVOICE', over: Json = {}) {
  const saved = await command(tokens.finance, draft({ docType: type, ...over }));
  expect(saved.status).toBe(201);
  const done = await command(tokens.finance, {
    ...entity,
    commandType: 'IssueSalesDocument',
    documentId: saved.json.documentId,
    expectedVersion: saved.json.version,
  });
  expect(done.status).toBe(200);
  return { documentId: saved.json.documentId as string, ...done.json } as Json;
}

describe('sales documents PostgreSQL persistence (DEC-045)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-sd-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-sd-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'SD Tenant', 'sd-tenant'),
        ('${ids.tenantB}', 'SD Tenant B', 'sd-tenant-b')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.finance}', 'SD Finance', 'sd-finance@example.test'),
        ('${ids.admin}', 'SD Admin', 'sd-admin@example.test'),
        ('${ids.supervisor}', 'SD Supervisor', 'sd-supervisor@example.test'),
        ('${ids.financeB}', 'SD Finance B', 'sd-finance-b@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.financeMembership}', '${ids.tenant}', '${ids.finance}', 'ACTIVE'),
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE'),
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisor}', 'ACTIVE'),
        ('${ids.financeBMembership}', '${ids.tenantB}', '${ids.financeB}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'SD Legal'),
        ('${ids.legal2}', '${ids.tenant}', 'SD Legal Two'),
        ('${ids.legalB}', '${ids.tenantB}', 'SD Legal B')
        on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'SDST1', 'SD Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.financeMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenantB}', '${ids.financeBMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legalB}', null)
        on conflict do nothing;
    `);
    await seedClerkSession(client, ids.financeSession, tokens.finance, ids.finance, true);
    await seedClerkSession(client, ids.adminSession, tokens.admin, ids.admin, true);
    await seedClerkSession(client, ids.supervisorSession, tokens.supervisor, ids.supervisor, true);
    await seedClerkSession(client, ids.financeBSession, tokens.financeB, ids.financeB, true);
    for (const [session, tenant] of [
      [ids.financeSession, ids.tenant],
      [ids.adminSession, ids.tenant],
      [ids.supervisorSession, ids.tenant],
      [ids.financeBSession, ids.tenantB],
    ] as const) {
      await seedActiveStepUp(client, session, tenant);
    }
  });

  afterAll(async () => client?.end());

  it('denies anonymous callers and roles that may not use documents', async () => {
    expect((await command('', draft())).status).toBe(401);
    const asSupervisor = await command(tokens.supervisor, { ...profile });
    expect(asSupervisor.status).toBe(403);
    const draftAsSupervisor = await command(tokens.supervisor, draft());
    expect(draftAsSupervisor.status).toBe(403);
  });

  it('keeps the letterhead to the owner and administrator', async () => {
    expect((await command(tokens.finance, { ...profile })).status).toBe(403);
    // Re-runnable: when the company already has details, save over them at their current version.
    const existing = await getSalesDocumentProfileFromRequest(readRequest(tokens.admin), entity);
    const saved = await command(tokens.admin, {
      ...profile,
      ...(existing ? { expectedVersion: existing.version } : {}),
    });
    expect(saved.status).toBe(200);
    const stored = await getSalesDocumentProfileFromRequest(readRequest(tokens.finance), entity);
    expect(stored).toMatchObject({ displayName: 'Shanda Fuel (Pvt) Ltd', invoicePrefix: 'INV' });
    const stale = await command(tokens.admin, {
      ...profile,
      displayName: 'Changed',
      expectedVersion: 99,
    });
    expect(stale.status).toBe(409);
    const updated = await command(tokens.admin, {
      ...profile,
      displayName: 'Shanda Fuel (Pvt) Ltd',
      expectedVersion: saved.json.version,
    });
    expect(updated.status).toBe(200);
    expect(updated.json.version).toBe(saved.json.version + 1);
  });

  it('works out totals from exact decimals and stores each draft edit as a new revision', async () => {
    const saved = await command(
      tokens.finance,
      draft({
        lines: [line({ quantity: '10', unitPrice: '12.50', discountAmount: '25', taxRate: '15' })],
      }),
    );
    expect(saved.status).toBe(201);
    expect(saved.json.total).toBe('115.0000');
    const edited = await command(
      tokens.finance,
      draft({
        documentId: saved.json.documentId,
        expectedVersion: saved.json.version,
        lines: [
          line({ quantity: '2', unitPrice: '10', taxRate: '0' }),
          line({ description: 'Oil', quantity: '1', unitPrice: '5.5', taxRate: '0' }),
        ],
      }),
    );
    expect(edited.status).toBe(201);
    expect(edited.json.total).toBe('25.5000');
    const rows = await client`
      select revision, count(*)::int as n from app.sales_document_lines
      where document_id = ${saved.json.documentId} group by revision order by revision`;
    expect(rows.map((r) => [r.revision, r.n])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    const detail = await getSalesDocumentFromRequest(readRequest(tokens.finance), {
      ...entity,
      documentId: saved.json.documentId,
    });
    expect(detail.lines).toHaveLength(2);
    expect(detail.total).toBe('25.5000');
    // A stale copy of the draft cannot overwrite the newer revision.
    const stale = await command(
      tokens.finance,
      draft({ documentId: saved.json.documentId, expectedVersion: saved.json.version }),
    );
    expect(stale.status).toBe(409);
  });

  it('rejects bad input without writing anything', async () => {
    const before =
      await client`select count(*)::int as n from app.sales_documents where tenant_id = ${ids.tenant}`;
    expect((await command(tokens.finance, draft({ lines: [] }))).status).toBe(400);
    expect(
      (await command(tokens.finance, draft({ lines: [line({ unitPrice: 1.5 })] }))).status,
    ).toBe(400);
    expect(
      (await command(tokens.finance, draft({ lines: [line({ discountAmount: '999999' })] })))
        .status,
    ).toBe(400);
    expect((await command(tokens.finance, draft({ dueDate: '2026-01-01' }))).status).toBe(400);
    const after =
      await client`select count(*)::int as n from app.sales_documents where tenant_id = ${ids.tenant}`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('gives gap-free numbers per company, type and year, even when issued at the same time', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 5 }, () =>
        command(tokens.finance, draft({ docType: 'QUOTATION', validUntil: '2026-12-31' })),
      ),
    );
    for (const d of drafts) expect(d.status).toBe(201);
    const results = await Promise.all(
      drafts.map((d) =>
        command(tokens.finance, {
          ...entity,
          commandType: 'IssueSalesDocument',
          documentId: d.json.documentId,
          expectedVersion: d.json.version,
        }),
      ),
    );
    for (const r of results) expect(r.status).toBe(200);
    const seqs = (
      await client`select doc_seq from app.sales_documents
        where tenant_id = ${ids.tenant} and legal_entity_id = ${ids.legal} and doc_type = 'QUOTATION'
          and doc_year = 2026 and doc_number is not null order by doc_seq`
    ).map((r) => r.doc_seq as number);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(results[0]!.json.docNumber).toMatch(/^QT-2026-\d{4}$/);
    // Invoices have their own counter, and another company starts again at one.
    const invoice = await issued('INVOICE');
    expect(invoice.docNumber).toMatch(/^INV-2026-\d{4}$/);
  });

  it('refuses to issue until the company has a letterhead', async () => {
    const other = { tenantId: ids.tenant, legalEntityId: ids.legal2 };
    const saved = await command(tokens.admin, draft({ ...other }));
    expect(saved.status).toBe(201);
    const refused = await command(tokens.admin, {
      ...other,
      commandType: 'IssueSalesDocument',
      documentId: saved.json.documentId,
      expectedVersion: saved.json.version,
    });
    expect(refused.status).toBe(422);
  });

  it('makes an issued document unchangeable, even straight in the database', async () => {
    const invoice = await issued('INVOICE');
    const edit = await command(
      tokens.finance,
      draft({ documentId: invoice.documentId, expectedVersion: invoice.version }),
    );
    expect(edit.status).toBe(422);
    await expect(
      client`update app.sales_documents set total = 1 where id = ${invoice.documentId}`,
    ).rejects.toThrow(/cannot be edited/);
    await expect(
      client`update app.sales_document_lines set quantity = 1 where document_id = ${invoice.documentId}`,
    ).rejects.toThrow(/immutable/);
    const again = await command(tokens.finance, {
      ...entity,
      commandType: 'IssueSalesDocument',
      documentId: invoice.documentId,
      expectedVersion: invoice.version,
    });
    expect(again.status).toBe(422);
  });

  it('replays an issue with the same idempotency key without taking a second number', async () => {
    const saved = await command(tokens.finance, draft());
    const body = {
      ...entity,
      commandType: 'IssueSalesDocument',
      documentId: saved.json.documentId,
      expectedVersion: saved.json.version,
    };
    const key = randomUUID();
    const first = await command(tokens.finance, body, key);
    const second = await command(tokens.finance, body, key);
    expect(second.status).toBe(first.status);
    expect(second.json.docNumber).toBe(first.json.docNumber);
    const reused = await command(tokens.finance, { ...body, expectedVersion: 7 }, key);
    expect(reused.status).toBe(409);
  });

  it('turns a quotation into one invoice, then lets receipts pay it off', async () => {
    const quote = await issued('QUOTATION', { validUntil: '2026-12-31' });
    const accepted = await command(tokens.finance, {
      ...entity,
      commandType: 'AcceptQuotation',
      documentId: quote.documentId,
      expectedVersion: quote.version,
    });
    expect(accepted.status).toBe(200);
    const flag = async () =>
      (await listSalesDocumentsFromRequest(readRequest(tokens.finance), entity)).find(
        (row) => row.id === quote.documentId,
      )?.hasInvoice;
    expect(await flag()).toBe(false);
    const converted = await command(tokens.finance, {
      ...entity,
      commandType: 'ConvertQuotationToInvoice',
      quotationId: quote.documentId,
      issueDate: '2026-11-19',
    });
    expect(converted.status).toBe(201);
    expect(converted.json.total).toBe('172.5000');
    expect(await flag()).toBe(true);
    const twice = await command(tokens.finance, {
      ...entity,
      commandType: 'ConvertQuotationToInvoice',
      quotationId: quote.documentId,
      issueDate: '2026-11-19',
    });
    expect(twice.status).toBe(409);
    const invoice = await command(tokens.finance, {
      ...entity,
      commandType: 'IssueSalesDocument',
      documentId: converted.json.documentId,
      expectedVersion: converted.json.version,
    });
    expect(invoice.status).toBe(200);

    const pay = (amount: string) =>
      command(tokens.finance, {
        ...entity,
        commandType: 'RecordSalesReceipt',
        invoiceId: converted.json.documentId,
        amount,
        paymentMethod: 'Cash',
        paidOn: '2026-11-20',
      });
    const tooMuch = await pay('172.5001');
    expect(tooMuch.status).toBe(422);
    const part = await pay('72.5000');
    expect(part.status).toBe(201);
    expect(part.json.docNumber).toMatch(/^RC-2026-\d{4}$/);
    expect(part.json.invoiceBalanceAfter).toBe('100.0000');
    let detail = await getSalesDocumentFromRequest(readRequest(tokens.finance), {
      ...entity,
      documentId: converted.json.documentId,
    });
    expect(detail.paymentState).toBe('PART_PAID');
    expect(detail.sourceDocNumber).toBe(quote.docNumber);
    const rest = await pay('100');
    expect(rest.status).toBe(201);
    detail = await getSalesDocumentFromRequest(readRequest(tokens.finance), {
      ...entity,
      documentId: converted.json.documentId,
    });
    expect(detail.paymentState).toBe('PAID');
    expect(detail.balance).toBe('0.0000');
    expect(detail.receipts).toHaveLength(2);
    expect((await pay('1')).status).toBe(422);
    const list = await listSalesDocumentsFromRequest(readRequest(tokens.finance), {
      ...entity,
      docType: 'INVOICE',
    });
    expect(list.find((row) => row.id === converted.json.documentId)?.paymentState).toBe('PAID');
  });

  it('needs a fresh identity check to void, never lets finance void, and protects live receipts', async () => {
    const invoice = await issued('INVOICE');
    const receipt = await command(tokens.finance, {
      ...entity,
      commandType: 'RecordSalesReceipt',
      invoiceId: invoice.documentId,
      amount: '10',
      paymentMethod: 'Cash',
      paidOn: '2026-11-20',
    });
    expect(receipt.status).toBe(201);
    const voidBody = (id: string, version: number) => ({
      ...entity,
      commandType: 'VoidSalesDocument',
      documentId: id,
      expectedVersion: version,
      reason: 'Issued to the wrong customer',
    });
    expect(
      (await command(tokens.finance, voidBody(invoice.documentId, invoice.version))).status,
    ).toBe(403);
    const blocked = await command(tokens.admin, voidBody(invoice.documentId, invoice.version));
    expect(blocked.status).toBe(422);
    const voidReceipt = await command(tokens.admin, voidBody(receipt.json.documentId, 0));
    expect(voidReceipt.status).toBe(200);
    // Without a fresh identity check the owner-level void is refused, then allowed once it is done.
    setFixtureStrongAuthentication(ids.adminSession, false);
    const needsStepUp = await command(tokens.admin, voidBody(invoice.documentId, invoice.version));
    expect(needsStepUp.status).toBe(403);
    expect(needsStepUp.json.error).toBe('STEP_UP_REQUIRED');
    await seedActiveStepUp(client, ids.adminSession, ids.tenant);
    const voided = await command(tokens.admin, voidBody(invoice.documentId, invoice.version));
    expect(voided.status).toBe(200);
    expect(voided.json.status).toBe('VOIDED');
    const row =
      await client`select doc_number, status, void_reason from app.sales_documents where id = ${invoice.documentId}`;
    expect(row[0]).toMatchObject({ doc_number: invoice.docNumber, status: 'VOIDED' });
    // A voided document keeps its number and cannot change again.
    await expect(
      client`update app.sales_documents set status = 'ISSUED' where id = ${invoice.documentId}`,
    ).rejects.toThrow();
  });

  it('keeps one company away from another (tenant isolation)', async () => {
    const invoice = await issued('INVOICE');
    const asB = await command(tokens.financeB, {
      ...entity,
      commandType: 'IssueSalesDocument',
      documentId: invoice.documentId,
      expectedVersion: invoice.version,
    });
    expect([403, 404]).toContain(asB.status);
    await expect(
      getSalesDocumentFromRequest(readRequest(tokens.financeB), {
        tenantId: ids.tenantB,
        legalEntityId: ids.legalB,
        documentId: invoice.documentId,
      }),
    ).rejects.toThrow();
    const listB = await listSalesDocumentsFromRequest(readRequest(tokens.financeB), {
      tenantId: ids.tenantB,
      legalEntityId: ids.legalB,
    });
    expect(listB).toEqual([]);
    // Another tenant's id inside this tenant's request is refused as well.
    const crossTenant = await command(
      tokens.financeB,
      draft({ tenantId: ids.tenantB, legalEntityId: ids.legal }),
    );
    expect([403, 404]).toContain(crossTenant.status);
  });

  it('downloads a PDF built from the stored document, and records the download', async () => {
    const entity = { tenantId: ids.tenant, legalEntityId: ids.legal };
    const list = await listSalesDocumentsFromRequest(readRequest(tokens.finance), entity);
    const issued = list.find((row) => row.status === 'ISSUED' && row.docType === 'INVOICE')!;
    const { filename, pdf } = await downloadSalesDocumentPdfFromRequest(
      readRequest(tokens.finance),
      { ...entity, documentId: issued.id },
    );
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(filename).toBe(`${issued.docNumber}.pdf`);
    const [event] = await client`
      select count(*)::int as n from platform.security_events
      where tenant_id = ${ids.tenant} and event_code = 'SALES_DOCUMENT.PDF_DOWNLOADED'`;
    expect(event!.n).toBeGreaterThan(0);
    // Another company's request cannot download it.
    await expect(
      downloadSalesDocumentPdfFromRequest(readRequest(tokens.financeB), {
        tenantId: ids.tenantB,
        legalEntityId: ids.legalB,
        documentId: issued.id,
      }),
    ).rejects.toThrow();
  });

  it('keeps the logo and colour an invoice was issued with, and refuses bad ones', async () => {
    // A tiny but well-formed colour JPEG: start, frame header (3 components), end.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00,
      0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
    ]).toString('base64');
    const current = await getSalesDocumentProfileFromRequest(readRequest(tokens.admin), entity);
    const save = (over: Json) =>
      command(tokens.admin, { ...profile, expectedVersion: current!.version, ...over });

    expect((await save({ brandColour: 'red' })).status).toBe(400);
    expect((await save({ logoJpegBase64: 'AAAA' })).status).toBe(400);
    expect((await save({ logoJpegBase64: '/9j/not base64 !!' })).status).toBe(400);
    expect((await command(tokens.finance, { ...profile, logoJpegBase64: jpeg })).status).toBe(403);

    const withLogo = await save({ logoJpegBase64: jpeg, brandColour: '#1a7f5b' });
    expect(withLogo.status).toBe(200);
    const stored = await getSalesDocumentProfileFromRequest(readRequest(tokens.finance), entity);
    expect(stored).toMatchObject({ logoJpegBase64: jpeg, brandColour: '#1a7f5b' });

    const invoice = await issued('INVOICE');
    const download = () =>
      downloadSalesDocumentPdfFromRequest(readRequest(tokens.finance), {
        ...entity,
        documentId: invoice.documentId,
      });
    const before = (await download()).pdf.toString('latin1');
    expect(before).toContain('/Subtype /Image');
    expect(before).toContain('0.102 0.498 0.357');

    // Removing the logo later must not change a document that is already issued.
    const removed = await command(tokens.admin, {
      ...profile,
      expectedVersion: withLogo.json.version,
      logoJpegBase64: null,
      brandColour: null,
    });
    expect(removed.status).toBe(200);
    const after = (await download()).pdf.toString('latin1');
    expect(after).toContain('/Subtype /Image');
    expect(after).toContain('0.102 0.498 0.357');
  });

  it('keeps the stored logo when a save leaves it out, and refuses a customer from elsewhere', async () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00,
      0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
    ]).toString('base64');
    const read = () => getSalesDocumentProfileFromRequest(readRequest(tokens.admin), entity);
    const first = await command(tokens.admin, {
      ...profile,
      expectedVersion: (await read())!.version,
      logoJpegBase64: jpeg,
      brandColour: '#1a7f5b',
    });
    expect(first.status).toBe(200);
    const omitted = await command(tokens.admin, {
      ...profile,
      expectedVersion: first.json.version,
      displayName: 'Shanda Fuel (Pvt) Ltd',
    });
    expect(omitted.status).toBe(200);
    expect(await read()).toMatchObject({ logoJpegBase64: jpeg, brandColour: '#1a7f5b' });

    const stranger = await command(tokens.finance, draft({ customerId: randomUUID() }));
    expect(stranger.status).toBe(404);
  });

  it('emails the PDF of an issued document, and only that', async () => {
    const send = (token: string, documentId: string, to = 'buyer@example.com') =>
      sendSalesDocumentEmailFromRequest(readRequest(token), { ...entity, documentId, to });
    const invoice = await issued('INVOICE');
    sentEmails.calls.length = 0;
    sentEmails.failWith = null;

    await expect(send(tokens.finance, invoice.documentId)).resolves.toEqual({ sent: true });
    expect(sentEmails.calls).toHaveLength(1);
    const mail = sentEmails.calls[0]!;
    expect(mail.to).toBe('buyer@example.com');
    expect(mail.subject).toMatch(/^Invoice INV-/);
    expect(mail.attachments?.[0]?.content.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    const [event] = await client`
      select e::text as row from platform.security_events e
      where tenant_id = ${ids.tenant} and event_code = 'SALES_DOCUMENT.EMAILED'
      order by occurred_at desc limit 1`;
    expect(event).toBeTruthy();
    expect(event!.row).not.toContain('buyer@example.com');

    // A bad address, a draft, a role without the issue permission and another company's
    // user are all refused, and nothing is sent.
    await expect(send(tokens.finance, invoice.documentId, 'not-an-address')).rejects.toThrow();
    const saved = await command(tokens.finance, draft());
    await expect(send(tokens.finance, saved.json.documentId)).rejects.toThrow(/Only an issued/);
    await expect(send(tokens.supervisor, invoice.documentId)).rejects.toThrow();
    await expect(
      sendSalesDocumentEmailFromRequest(readRequest(tokens.financeB), {
        tenantId: ids.tenantB,
        legalEntityId: ids.legalB,
        documentId: invoice.documentId,
        to: 'buyer@example.com',
      }),
    ).rejects.toThrow();
    expect(sentEmails.calls).toHaveLength(1);

    // When email is not set up, or the provider is down, the person is told plainly and no
    // "emailed" entry is written.
    const countEvents = async () =>
      (
        await client`
          select count(*)::int as n from platform.security_events
          where tenant_id = ${ids.tenant} and event_code = 'SALES_DOCUMENT.EMAILED'`
      )[0]!.n as number;
    const before = await countEvents();
    sentEmails.failWith = 'configuration';
    await expect(send(tokens.finance, invoice.documentId)).rejects.toThrow(/not set up yet/);
    sentEmails.failWith = 'provider';
    await expect(send(tokens.finance, invoice.documentId)).rejects.toThrow(/could not be sent/);
    sentEmails.failWith = null;
    expect(await countEvents()).toBe(before);
  });

  it('tells each role what it may do, and lists saved customers', async () => {
    const entity = { tenantId: ids.tenant, legalEntityId: ids.legal };
    expect(
      await getSalesDocumentCapabilitiesFromRequest(readRequest(tokens.finance), entity),
    ).toEqual({ create: true, issue: true, void: false, manageProfile: false });
    expect(
      await getSalesDocumentCapabilitiesFromRequest(readRequest(tokens.admin), entity),
    ).toEqual({ create: true, issue: true, void: true, manageProfile: true });
    const customers = await getSalesDocumentCustomersFromRequest(
      readRequest(tokens.finance),
      entity,
    );
    expect(Array.isArray(customers)).toBe(true);
  });

  it('is signed into the audit trail', async () => {
    const rows = await client`
      select event_code, count(*)::int as n from platform.security_events
      where tenant_id = ${ids.tenant} and event_code like 'SALES_DOCUMENT.%' group by event_code`;
    const codes = rows.map((r) => r.event_code);
    for (const code of [
      'SALES_DOCUMENT.ISSUED',
      'SALES_DOCUMENT.DRAFT_SAVED',
      'SALES_DOCUMENT.VOIDED',
      'SALES_DOCUMENT.RECEIPT_ISSUED',
      'SALES_DOCUMENT.PDF_DOWNLOADED',
    ]) {
      expect(codes).toContain(code);
    }
  });
});
