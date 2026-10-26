import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { clerkHeaders, seedActiveStepUp, seedClerkSession } from './auth-session-fixtures';
import {
  createSupplierPaymentProofDownloadFromRequest,
  listSupplierPaymentProofsFromRequest,
  uploadSupplierPaymentProofFromRequest,
  type SupplierPaymentProofStorage,
} from '../../src/modules/creditors/payment-proofs';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for supplier payment proof tests.');

const ids = {
  tenant: 'a9f10000-0000-4000-8000-000000000001',
  legal: 'a9f10000-0000-4000-8000-000000000011',
  supplier: 'a9f10000-0000-4000-8000-000000000021',
  actor: 'a9f10000-0000-4000-8000-000000000031',
  membership: 'a9f10000-0000-4000-8000-000000000041',
  session: 'a9f10000-0000-4000-8000-000000000051',
  payment: 'a9f10000-0000-4000-8000-000000000061',
};
const TOKEN = 'a9f-finance-token';
let client: Sql;

class FakeStorage {
  readonly objects = new Map<string, { size: number; contentType: string }>();
  readonly put: SupplierPaymentProofStorage['put'] = async ({ key, body, contentType }) => {
    this.objects.set(key, { size: body.byteLength, contentType });
  };
  readonly delete: SupplierPaymentProofStorage['delete'] = async (key) => {
    this.objects.delete(key);
  };
  readonly createReadUrl: SupplierPaymentProofStorage['createReadUrl'] = async (key, seconds) =>
    `https://storage.invalid/${key}?expires=${seconds}`;
}

function request(): Request {
  return new Request('http://127.0.0.1:3000/api/suppliers/payments/proof', {
    method: 'POST',
    headers: { ...clerkHeaders(TOKEN) },
  });
}

function form(file: { name: string; type: string; body: Uint8Array }) {
  const data = new FormData();
  data.set('tenantId', ids.tenant);
  data.set('legalEntityId', ids.legal);
  data.set('file', new File([file.body as BlobPart], file.name, { type: file.type }));
  return data;
}

const pdf = (extra = '') => new TextEncoder().encode(`%PDF-1.4\n${extra}\n%%EOF`);

describe('supplier payment proof documents', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a9f-payment-proof-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a9f-payment-proof-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Payment Proof Tenant', 'a9f-payment-proof-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.actor}', 'Payment Proof Finance', 'a9f-payment-proof@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Payment Proof Legal')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.membership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}', null)
        on conflict (id) do nothing;
      insert into app.suppliers
        (id, tenant_id, code, legal_name, status, created_by, updated_by) values
        ('${ids.supplier}', '${ids.tenant}', 'A9F-PROOF', 'Payment Proof Supplier', 'ACTIVE',
         '${ids.membership}', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.supplier_payments
        (id, tenant_id, legal_entity_id, supplier_id, payment_date, payment_reference,
         currency, amount, state, version, created_by, submitted_by, submitted_at) values
        ('${ids.payment}', '${ids.tenant}', '${ids.legal}', '${ids.supplier}', '2026-10-26',
         'A9F-PROOF-001', 'USD', 125.5000, 'SUBMITTED', 0, '${ids.membership}',
         '${ids.membership}', now())
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.session, TOKEN, ids.actor, true);
    await seedActiveStepUp(client, ids.session, ids.tenant);
  });

  afterAll(async () => client?.end());

  it('stores, lists, downloads, and audits a private proof without a station scope', async () => {
    const storage = new FakeStorage();
    const uploaded = await uploadSupplierPaymentProofFromRequest(
      request(),
      ids.payment,
      form({ name: '../../proof.pdf', type: 'application/pdf', body: pdf('payment') }),
      { storage },
    );

    expect(uploaded).toMatchObject({
      subjectType: 'SUPPLIER_PAYMENT',
      subjectId: ids.payment,
      kind: 'PAYMENT_PROOF',
      fileName: 'proof.pdf',
      contentType: 'application/pdf',
      stationId: null,
    });
    const [key] = [...storage.objects.keys()];
    expect(key).toBe(`private/documents/${uploaded.documentId}`);

    const [row] = await client.unsafe(
      `select station_id, legal_entity_id, subject_type, kind from app.documents where id = '${uploaded.documentId}'`,
    );
    expect(row).toMatchObject({
      station_id: null,
      legal_entity_id: ids.legal,
      subject_type: 'SUPPLIER_PAYMENT',
      kind: 'PAYMENT_PROOF',
    });

    const listed = await listSupplierPaymentProofsFromRequest(request(), ids.payment, {
      tenantId: ids.tenant,
      legalEntityId: ids.legal,
    });
    expect(listed.items.some((item) => item.documentId === uploaded.documentId)).toBe(true);

    const download = await createSupplierPaymentProofDownloadFromRequest(
      request(),
      ids.payment,
      uploaded.documentId,
      { tenantId: ids.tenant, legalEntityId: ids.legal },
      { storage },
    );
    expect(download.downloadUrl).toBe(`https://storage.invalid/${key}?expires=300`);

    const audit = await client.unsafe(
      `select details from platform.security_events
       where event_code = 'SUPPLIER.PAYMENT_PROOF_UPLOADED'
         and details->>'subjectId' = '${uploaded.documentId}'`,
    );
    expect(audit).toHaveLength(1);
  });

  it('rejects unsupported or content-mismatched files before storage', async () => {
    const storage = new FakeStorage();
    await expect(
      uploadSupplierPaymentProofFromRequest(
        request(),
        ids.payment,
        form({ name: 'proof.exe', type: 'application/x-msdownload', body: pdf() }),
        { storage },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      uploadSupplierPaymentProofFromRequest(
        request(),
        ids.payment,
        form({
          name: 'proof.pdf',
          type: 'application/pdf',
          body: new TextEncoder().encode('text'),
        }),
        { storage },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(storage.objects.size).toBe(0);
  });
});
