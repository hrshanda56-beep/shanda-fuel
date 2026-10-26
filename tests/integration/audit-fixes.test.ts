import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as settingsPost } from '../../src/app/api/settings/commands/route';
import { POST as supplierPost } from '../../src/app/api/suppliers/commands/route';
import { POST as customerPost } from '../../src/app/api/customers/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the audit-fix integration tests.');

const run = randomUUID().slice(0, 8);
const id = () => randomUUID();
const ids = {
  tenant: id(),
  otherTenant: id(),
  legal: id(),
  otherLegal: id(),
  station: id(),
  otherStation: id(),
  owner: id(),
  attendant: id(),
  otherOwner: id(),
  ownerMembership: id(),
  attendantMembership: id(),
  otherOwnerMembership: id(),
  ownerSession: id(),
  attendantSession: id(),
  unverifiedSession: id(),
  otherOwnerSession: id(),
  unverifiedUser: id(),
  unverifiedMembership: id(),
};
const tokens = {
  owner: `fix-owner-${run}`,
  attendant: `fix-attendant-${run}`,
  unverified: `fix-unverified-${run}`,
  otherOwner: `fix-other-owner-${run}`,
};
type Who = keyof typeof tokens;

let client: Sql;

async function post(
  handler: (request: Request) => Promise<Response>,
  who: Who,
  key: string,
  body: Record<string, unknown>,
) {
  const response = await handler(
    new Request('http://127.0.0.1:3000/api/x', {
      method: 'POST',
      headers: {
        ...clerkHeaders(tokens[who]),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe('Audit fixes (PostgreSQL)', { timeout: 60_000 }, () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-fixes-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-fixes-secret';
    client = postgres(databaseUrl, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Fixes Tenant', 'fixes-${run}'),
        ('${ids.otherTenant}', 'Fixes Other Tenant', 'fixes-other-${run}');
      insert into app.users (id, name, email) values
        ('${ids.owner}', 'Fixes Owner', 'fixes-owner-${run}@example.test'),
        ('${ids.attendant}', 'Fixes Attendant', 'fixes-att-${run}@example.test'),
        ('${ids.unverifiedUser}', 'Fixes Unverified Owner', 'fixes-unv-${run}@example.test'),
        ('${ids.otherOwner}', 'Fixes Other Owner', 'fixes-oo-${run}@example.test');
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.ownerMembership}', '${ids.tenant}', '${ids.owner}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendant}', 'ACTIVE'),
        ('${ids.unverifiedMembership}', '${ids.tenant}', '${ids.unverifiedUser}', 'ACTIVE'),
        ('${ids.otherOwnerMembership}', '${ids.otherTenant}', '${ids.otherOwner}', 'ACTIVE');
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Fixes Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'Fixes Other Legal');
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'FX${run}', 'Fixes Station', 'ACTIVE'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'FO${run}', 'Other Station', 'ACTIVE');
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.ownerMembership}', 'OWNER', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.unverifiedMembership}', 'OWNER', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.otherTenant}', '${ids.otherOwnerMembership}', 'OWNER', 'TENANT', null, null);
    `);
    await seedClerkSession(client, ids.ownerSession, tokens.owner, ids.owner, true);
    await seedClerkSession(client, ids.attendantSession, tokens.attendant, ids.attendant, true);
    await seedClerkSession(
      client,
      ids.unverifiedSession,
      tokens.unverified,
      ids.unverifiedUser,
      true,
    );
    await seedClerkSession(client, ids.otherOwnerSession, tokens.otherOwner, ids.otherOwner, true);
    await seedActiveStepUp(client, ids.ownerSession, ids.tenant);
    await seedActiveStepUp(client, ids.attendantSession, ids.tenant);
    await seedActiveStepUp(client, ids.otherOwnerSession, ids.otherTenant);
    // The unverified owner deliberately has no step-up.
  });

  afterAll(async () => {
    await client?.end();
  });

  const state: Record<string, string> = {};

  describe('stations and companies', () => {
    it('lets an owner add a company and a station that starts in setup, with an audit event', async () => {
      const company = await post(settingsPost, 'owner', `co-${run}`, {
        commandType: 'CreateLegalEntity',
        tenantId: ids.tenant,
        legalName: 'Triumph Energy',
        registrationReference: 'REG-1',
      });
      expect(company.status).toBe(201);
      state.company = company.body.legalEntityId;

      const station = await post(settingsPost, 'owner', `st-${run}`, {
        commandType: 'CreateStation',
        tenantId: ids.tenant,
        legalEntityId: state.company,
        code: `bnd${run}`,
        name: 'Bindura',
        timezone: 'Africa/Harare',
      });
      expect(station.status).toBe(201);
      state.station = station.body.stationId;
      const [row] = await client`
        select status, code, timezone from app.stations where id = ${state.station!}
      `;
      expect(row).toMatchObject({
        status: 'ONBOARDING',
        code: `BND${run}`.toUpperCase(),
        timezone: 'Africa/Harare',
      });
      const audit = await client`
        select event_code from platform.security_events
        where tenant_id = ${ids.tenant} and details->>'subjectId' = ${state.station!}
      `;
      expect(audit.map((event) => event.event_code)).toEqual(['STATION.CREATED']);
    });

    it('replays the same request without creating a second station', async () => {
      const body = {
        commandType: 'CreateStation',
        tenantId: ids.tenant,
        legalEntityId: state.company,
        code: `bnd${run}`,
        name: 'Bindura',
        timezone: 'Africa/Harare',
      };
      const again = await post(settingsPost, 'owner', `st-${run}`, body);
      expect(again.status).toBe(201);
      expect(again.body.stationId).toBe(state.station);
      const [count] = await client`
        select count(*)::int as n from app.stations where tenant_id = ${ids.tenant} and code = ${`BND${run}`.toUpperCase()}
      `;
      expect(count?.n).toBe(1);
    });

    it('refuses a duplicate code, a bad time zone and a company from another organisation', async () => {
      const duplicate = await post(settingsPost, 'owner', `st2-${run}`, {
        commandType: 'CreateStation',
        tenantId: ids.tenant,
        legalEntityId: state.company,
        code: `BND${run}`,
        name: 'Another',
        timezone: 'Africa/Harare',
      });
      expect(duplicate.status).toBe(409);
      const badZone = await post(settingsPost, 'owner', `st3-${run}`, {
        commandType: 'CreateStation',
        tenantId: ids.tenant,
        legalEntityId: state.company,
        code: `ZZ${run}`,
        name: 'Zone',
        timezone: 'Mars/Olympus',
      });
      expect(badZone.status).toBe(400);
      const foreignCompany = await post(settingsPost, 'owner', `st4-${run}`, {
        commandType: 'CreateStation',
        tenantId: ids.tenant,
        legalEntityId: ids.otherLegal,
        code: `FC${run}`,
        name: 'Foreign',
        timezone: 'Africa/Harare',
      });
      expect(foreignCompany.status).toBe(404);
    });

    it('edits names and time zone but never the code', async () => {
      const station = await post(settingsPost, 'owner', `up-${run}`, {
        commandType: 'UpdateStation',
        tenantId: ids.tenant,
        stationId: state.station,
        name: 'Bindura Central',
        timezone: 'Africa/Johannesburg',
      });
      expect(station.status).toBe(201);
      const company = await post(settingsPost, 'owner', `upc-${run}`, {
        commandType: 'UpdateLegalEntity',
        tenantId: ids.tenant,
        legalEntityId: state.company,
        legalName: 'Triumph Energy (Pvt) Ltd',
      });
      expect(company.status).toBe(201);
      const [row] = await client`
        select name, code, timezone from app.stations where id = ${state.station!}
      `;
      expect(row).toMatchObject({
        name: 'Bindura Central',
        code: `BND${run}`.toUpperCase(),
        timezone: 'Africa/Johannesburg',
      });
    });

    it('needs a fresh identity check, a permitted role and the right organisation', async () => {
      const body = (code: string) => ({
        commandType: 'CreateStation',
        tenantId: ids.tenant,
        legalEntityId: state.company,
        code,
        name: 'Denied',
        timezone: 'Africa/Harare',
      });
      const noStepUp = await post(settingsPost, 'unverified', `d1-${run}`, body(`D1${run}`));
      expect(noStepUp.status).toBe(403);
      const attendant = await post(settingsPost, 'attendant', `d2-${run}`, body(`D2${run}`));
      expect(attendant.status).toBe(403);
      const otherOrg = await post(settingsPost, 'otherOwner', `d3-${run}`, body(`D3${run}`));
      expect([403, 404]).toContain(otherOrg.status);
      const created = await client`
        select 1 from app.stations where code in (${`D1${run}`}, ${`D2${run}`}, ${`D3${run}`})
      `;
      expect(created).toEqual([]);
    });
  });

  describe('suppliers', () => {
    it('stores contact, usual credit days and a credit limit when the supplier is added', async () => {
      const created = await post(supplierPost, 'owner', `sup-${run}`, {
        commandType: 'CreateSupplier',
        tenantId: ids.tenant,
        legalEntityId: ids.legal,
        code: `SUP${run}`,
        legalName: 'Puma Energy',
        contactName: 'Tendai',
        contactPhone: '+263 77 000 0000',
        contactEmail: 'tendai@example.test',
        defaultCreditDays: 30,
        creditLimit: '5000',
      });
      expect(created.status).toBe(201);
      state.supplier = created.body.supplierId;
      const [row] = await client`
        select contact_name, contact_phone, contact_email, default_credit_days, credit_limit::text as credit_limit, version
        from app.suppliers where id = ${state.supplier!}
      `;
      expect(row).toMatchObject({
        contact_name: 'Tendai',
        contact_phone: '+263 77 000 0000',
        contact_email: 'tendai@example.test',
        default_credit_days: 30,
        credit_limit: '5000.0000',
      });
    });

    it('updates only the fields sent, clears with null, and refuses a stale version', async () => {
      const update = await post(supplierPost, 'owner', `supu-${run}`, {
        commandType: 'UpdateSupplierDetails',
        tenantId: ids.tenant,
        legalEntityId: ids.legal,
        supplierId: state.supplier,
        expectedVersion: 0,
        contactPhone: '+263 71 111 1111',
        defaultCreditDays: null,
      });
      expect(update.status).toBe(200);
      const [row] = await client`
        select contact_name, contact_phone, default_credit_days, version
        from app.suppliers where id = ${state.supplier!}
      `;
      expect(row).toMatchObject({
        contact_name: 'Tendai',
        contact_phone: '+263 71 111 1111',
        default_credit_days: null,
        version: 1,
      });
      const stale = await post(supplierPost, 'owner', `supu2-${run}`, {
        commandType: 'UpdateSupplierDetails',
        tenantId: ids.tenant,
        legalEntityId: ids.legal,
        supplierId: state.supplier,
        expectedVersion: 0,
        contactName: 'Someone else',
      });
      expect(stale.status).toBe(409);
    });

    it('rejects a credit period outside 0 to 365 days', async () => {
      const bad = await post(supplierPost, 'owner', `supbad-${run}`, {
        commandType: 'CreateSupplier',
        tenantId: ids.tenant,
        legalEntityId: ids.legal,
        code: `BAD${run}`,
        legalName: 'Bad Terms',
        defaultCreditDays: 400,
      });
      expect(bad.status).toBe(400);
    });
  });

  describe('customers', () => {
    it('creates a customer with a phone number and a staff benefit account in one flow', async () => {
      const customer = await post(customerPost, 'owner', `cu-${run}`, {
        commandType: 'CreateCustomer',
        tenantId: ids.tenant,
        accountReference: `ROSINA-${run}`,
        displayName: 'Rosina',
        contactMetadata: { phone: '+263 77 222 2222' },
        legalEntityId: ids.legal,
      });
      expect(customer.status).toBe(201);
      const account = await post(customerPost, 'owner', `cua-${run}`, {
        commandType: 'CreateCustomerAccount',
        tenantId: ids.tenant,
        customerId: customer.body.customerId,
        accountType: 'CREDIT',
        currency: 'USD',
        creditLimit: '60',
        staffBenefit: { staffName: 'Rosina' },
      });
      expect(account.status).toBe(201);
      const [terms] = await client`
        select staff_name from app.customer_staff_benefit_terms where tenant_id = ${ids.tenant}
      `;
      expect(terms?.staff_name).toBe('Rosina');
    });
  });
});
