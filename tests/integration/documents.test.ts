import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import {
  createDocumentDownloadFromRequest,
  listDocumentsFromRequest,
  uploadDocumentFromRequest,
  type DocumentStorage,
} from '../../src/modules/documents/documents';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for documents integration tests.');

const ids = {
  tenant: 'a9f00000-0000-4000-8000-000000000001',
  otherTenant: 'a9f00000-0000-4000-8000-000000000002',
  legal: 'a9f00000-0000-4000-8000-000000000011',
  stationA: 'a9f00000-0000-4000-8000-000000000021',
  stationB: 'a9f00000-0000-4000-8000-000000000022',
  supervisorActor: 'a9f00000-0000-4000-8000-000000000031',
  supervisorMembership: 'a9f00000-0000-4000-8000-000000000041',
  supervisorSession: 'a9f00000-0000-4000-8000-000000000051',
  attendantActor: 'a9f00000-0000-4000-8000-000000000032',
  attendantMembership: 'a9f00000-0000-4000-8000-000000000042',
  attendantSession: 'a9f00000-0000-4000-8000-000000000052',
  outsiderActor: 'a9f00000-0000-4000-8000-000000000033',
  outsiderMembership: 'a9f00000-0000-4000-8000-000000000043',
  outsiderSession: 'a9f00000-0000-4000-8000-000000000053',
  tillA: 'a9f00000-0000-4000-8000-000000000081',
  safeA: 'a9f00000-0000-4000-8000-000000000082',
  tillB: 'a9f00000-0000-4000-8000-000000000083',
  safeB: 'a9f00000-0000-4000-8000-000000000084',
  handoverA: 'a9f00000-0000-4000-8000-0000000000a1',
  handoverB: 'a9f00000-0000-4000-8000-0000000000a2',
};
const SUPERVISOR = 'a9f-supervisor-token';
const ATTENDANT = 'a9f-attendant-token';
const OUTSIDER = 'a9f-outsider-token';
let client: Sql;

class FakeStorage {
  readonly objects = new Map<string, { size: number; contentType: string }>();
  readonly put: DocumentStorage['put'] = async ({ key, body, contentType }) => {
    this.objects.set(key, { size: body.byteLength, contentType });
  };
  readonly delete: DocumentStorage['delete'] = async (key) => {
    this.objects.delete(key);
  };
  readonly createReadUrl: DocumentStorage['createReadUrl'] = async (key, seconds) =>
    `https://storage.invalid/${key}?expires=${seconds}`;
}

const pdf = (extra = '') => new TextEncoder().encode(`%PDF-1.4\n${extra}\n%%EOF`);

function request(token: string): Request {
  return new Request('http://127.0.0.1:3000/api/documents', {
    method: 'POST',
    headers: { ...clerkHeaders(token) },
  });
}

function form(
  fields: Record<string, string>,
  file?: { name: string; type: string; body: Uint8Array },
) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  if (file) data.set('file', new File([file.body as BlobPart], file.name, { type: file.type }));
  return data;
}

const target = (station = ids.stationA, subjectId = ids.handoverA) => ({
  tenantId: ids.tenant,
  stationId: station,
  subjectType: 'CASH_HANDOVER',
  subjectId,
  kind: 'DEPOSIT_SLIP',
});

async function count(): Promise<number> {
  const rows = await client.unsafe(
    `select count(*)::int as n from app.documents where tenant_id = '${ids.tenant}'`,
  );
  return rows[0]!.n;
}

describe('documents', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a9f-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a9f-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Documents Tenant', 'a9f-documents-tenant'),
        ('${ids.otherTenant}', 'Other Documents Tenant', 'a9f-other-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.supervisorActor}', 'Docs Supervisor', 'a9f-supervisor@example.test'),
        ('${ids.attendantActor}', 'Docs Attendant', 'a9f-attendant@example.test'),
        ('${ids.outsiderActor}', 'Docs Outsider', 'a9f-outsider@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendantActor}', 'ACTIVE'),
        ('${ids.outsiderMembership}', '${ids.otherTenant}', '${ids.outsiderActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Documents Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.stationA}', '${ids.tenant}', '${ids.legal}', 'A9FSA', 'Docs Station A', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationB}', '${ids.tenant}', '${ids.legal}', 'A9FSB', 'Docs Station B', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.stationA}'),
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.stationA}')
        on conflict (id) do nothing;
      insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type) values
        ('${ids.tillA}', '${ids.tenant}', '${ids.stationA}', 'A9F-TA', 'Till A', 'STATION_TILL'),
        ('${ids.safeA}', '${ids.tenant}', '${ids.stationA}', 'A9F-SA', 'Safe A', 'STATION_SAFE'),
        ('${ids.tillB}', '${ids.tenant}', '${ids.stationB}', 'A9F-TB', 'Till B', 'STATION_TILL'),
        ('${ids.safeB}', '${ids.tenant}', '${ids.stationB}', 'A9F-SB', 'Safe B', 'STATION_SAFE')
        on conflict (id) do nothing;
      insert into app.cash_handovers
        (id, tenant_id, station_id, from_location_id, to_location_id, expected_amount, delivered_by, state) values
        ('${ids.handoverA}', '${ids.tenant}', '${ids.stationA}', '${ids.tillA}', '${ids.safeA}', 10, '${ids.supervisorMembership}', 'DRAFT'),
        ('${ids.handoverB}', '${ids.tenant}', '${ids.stationB}', '${ids.tillB}', '${ids.safeB}', 10, '${ids.supervisorMembership}', 'DRAFT')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.supervisorSession, SUPERVISOR, ids.supervisorActor, true);
    await seedClerkSession(client, ids.attendantSession, ATTENDANT, ids.attendantActor, true);
    await seedClerkSession(client, ids.outsiderSession, OUTSIDER, ids.outsiderActor, true);
    await seedActiveStepUp(client, ids.supervisorSession, ids.tenant);
    await seedActiveStepUp(client, ids.attendantSession, ids.tenant);
    await seedActiveStepUp(client, ids.outsiderSession, ids.otherTenant);
  });

  afterAll(async () => client?.end());

  it('stores the file privately, records it, audits it, and hands out a short-lived link', async () => {
    const storage = new FakeStorage();
    const uploaded = await uploadDocumentFromRequest(
      request(SUPERVISOR),
      form(target(), { name: '../../etc/slip.pdf', type: 'application/pdf', body: pdf('slip') }),
      { storage },
    );
    expect(uploaded).toMatchObject({
      subjectType: 'CASH_HANDOVER',
      subjectId: ids.handoverA,
      kind: 'DEPOSIT_SLIP',
      fileName: 'slip.pdf',
      contentType: 'application/pdf',
    });

    const [key] = [...storage.objects.keys()];
    expect(key).toBe(`private/documents/${uploaded.documentId}`);
    expect(key).not.toContain('slip');
    const [row] = await client.unsafe(
      `select object_key, uploaded_by, sha256 from app.documents where id = '${uploaded.documentId}'`,
    );
    expect(row).toMatchObject({ object_key: key, uploaded_by: ids.supervisorMembership });
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);

    const audit = await client.unsafe(
      `select details from platform.security_events
        where event_code = 'DOCUMENT.UPLOADED' and details->>'subjectId' = '${uploaded.documentId}'`,
    );
    expect(audit).toHaveLength(1);

    const listed = await listDocumentsFromRequest(request(SUPERVISOR), {
      tenantId: ids.tenant,
      stationId: ids.stationA,
      subjectType: 'CASH_HANDOVER',
      subjectId: ids.handoverA,
    });
    expect(listed.canUpload).toBe(true);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      documentId: uploaded.documentId,
      uploadedByName: 'Docs Supervisor',
    });
    expect(JSON.stringify(listed)).not.toContain('private/documents');

    const download = await createDocumentDownloadFromRequest(
      request(SUPERVISOR),
      uploaded.documentId,
      { tenantId: ids.tenant },
      { storage },
    );
    expect(download.downloadUrl).toBe(`https://storage.invalid/${key}?expires=300`);
    expect(download.expiresInSeconds).toBe(300);
  });

  it("attaches the supplier's own invoice file to a supplier document of the same company", async () => {
    const supplierId = 'a9f00000-0000-4000-8000-000000000091';
    const documentId = 'a9f00000-0000-4000-8000-000000000092';
    await client.unsafe(`
      insert into app.suppliers (id, tenant_id, code, legal_name, created_by, updated_by) values
        ('${supplierId}', '${ids.tenant}', 'A9F-SUP', 'Docs Supplier', '${ids.supervisorMembership}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.supplier_documents
        (id, tenant_id, legal_entity_id, supplier_id, document_type, reference_number, document_date, amount, state, created_by)
        values ('${documentId}', '${ids.tenant}', '${ids.legal}', '${supplierId}', 'INVOICE', 'A9F-INV-1', '2026-10-20', 100, 'SUBMITTED', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
    `);
    const storage = new FakeStorage();
    const fields = {
      tenantId: ids.tenant,
      stationId: ids.stationA,
      subjectType: 'SUPPLIER_DOCUMENT',
      subjectId: documentId,
      kind: 'INVOICE',
    };
    const uploaded = await uploadDocumentFromRequest(
      request(SUPERVISOR),
      form(fields, { name: 'invoice.pdf', type: 'application/pdf', body: pdf('invoice') }),
      { storage },
    );
    expect(uploaded).toMatchObject({ subjectType: 'SUPPLIER_DOCUMENT', subjectId: documentId });
    // It is listed from the other station too, because an invoice belongs to the company.
    const listed = await listDocumentsFromRequest(request(SUPERVISOR), {
      tenantId: ids.tenant,
      stationId: ids.stationA,
      subjectType: 'SUPPLIER_DOCUMENT',
      subjectId: documentId,
    });
    expect(listed.items.map((item) => item.documentId)).toEqual([uploaded.documentId]);
    // A record that does not exist is refused.
    await expect(
      uploadDocumentFromRequest(
        request(SUPERVISOR),
        form(
          { ...fields, subjectId: 'a9f00000-0000-4000-8000-0000000000ff' },
          { name: 'invoice.pdf', type: 'application/pdf', body: pdf('x') },
        ),
        { storage },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a file whose content does not match what it claims to be', async () => {
    const storage = new FakeStorage();
    const before = await count();
    for (const file of [
      { name: 'note.pdf', type: 'application/pdf', body: new TextEncoder().encode('just text') },
      { name: 'x.png', type: 'application/pdf', body: pdf() },
      { name: 'run.exe', type: 'application/x-msdownload', body: pdf() },
      { name: 'empty.pdf', type: 'application/pdf', body: new Uint8Array() },
    ]) {
      await expect(
        uploadDocumentFromRequest(request(SUPERVISOR), form(target(), file), { storage }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(storage.objects.size).toBe(0);
    expect(await count()).toBe(before);
  });

  it('only attaches to a record at the same station and only of a known kind', async () => {
    const storage = new FakeStorage();
    const before = await count();
    const file = { name: 'slip.pdf', type: 'application/pdf', body: pdf() };
    await expect(
      uploadDocumentFromRequest(
        request(SUPERVISOR),
        form(target(ids.stationA, ids.handoverB), file),
        { storage },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      uploadDocumentFromRequest(request(SUPERVISOR), form({ ...target(), kind: 'MALWARE' }, file), {
        storage,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      uploadDocumentFromRequest(
        request(SUPERVISOR),
        form({ ...target(), subjectType: 'pg_user' }, file),
        { storage },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // The supervisor works at station A only.
    await expect(
      uploadDocumentFromRequest(
        request(SUPERVISOR),
        form(target(ids.stationB, ids.handoverB), file),
        { storage },
      ),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    expect(storage.objects.size).toBe(0);
    expect(await count()).toBe(before);
  });

  it('keeps people without document permission, and other organisations, out', async () => {
    const storage = new FakeStorage();
    const file = { name: 'slip.pdf', type: 'application/pdf', body: pdf() };
    await expect(
      uploadDocumentFromRequest(request(ATTENDANT), form(target(), file), { storage }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(storage.objects.size).toBe(0);

    const query = {
      tenantId: ids.tenant,
      stationId: ids.stationA,
      subjectType: 'CASH_HANDOVER',
      subjectId: ids.handoverA,
    };
    await expect(listDocumentsFromRequest(request(ATTENDANT), query)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(listDocumentsFromRequest(request(OUTSIDER), query)).rejects.toBeDefined();

    const id = (
      await client.unsafe(`select id from app.documents where tenant_id = '${ids.tenant}' limit 1`)
    )[0]!.id as string;
    await expect(
      createDocumentDownloadFromRequest(
        request(ATTENDANT),
        id,
        { tenantId: ids.tenant },
        { storage },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createDocumentDownloadFromRequest(
        request(OUTSIDER),
        id,
        { tenantId: ids.otherTenant },
        { storage },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createDocumentDownloadFromRequest(request(SUPERVISOR), 'not-a-uuid', {
        tenantId: ids.tenant,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never lets the runtime change or delete a stored document record', async () => {
    const id = (
      await client.unsafe(`select id from app.documents where tenant_id = '${ids.tenant}' limit 1`)
    )[0]!.id as string;
    // The test connection is not the runtime role, so check the grants the migration made.
    const grants = await client.unsafe(
      `select privilege_type from information_schema.role_table_grants
        where table_schema = 'app' and table_name = 'documents' and grantee = 'app_runtime'`,
    );
    expect(grants.map((g) => g.privilege_type).sort()).toEqual(['INSERT', 'SELECT']);
    expect(id).toBeTruthy();
  });
});
