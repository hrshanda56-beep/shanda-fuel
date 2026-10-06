import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from 'better-auth/crypto';
import { createQa1ScenarioContext } from '../../tests/integration/qa1/fixture';
import { createApprovedSale } from '../../tests/integration/qa1/commands';
import { closeDatabase } from '../../src/platform/db/client';
import { isCompleteOwnerDemoFixture } from './owner-demo-fixture';

const databaseUrl = process.env.DATABASE_URL;
const appEnv = process.env.APP_ENV ?? 'local';
const demoPassword = process.env.DEMO_PASSWORD;
const resetExisting = process.env.DEMO_RESET === '1';
const demoDatabaseName = 'shanda_fuel_demo';
const demoTenantSlug = 'tei-oils-owner-demo';
const demoEmail = 'demo-owner@tei-oils.example.test';

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!['local', 'test', 'demo'].includes(appEnv)) {
  throw new Error('The owner-demo seed requires APP_ENV=local, APP_ENV=test, or APP_ENV=demo');
}
if (!demoPassword || demoPassword.length < 12) {
  throw new Error(
    'DEMO_PASSWORD must be supplied through hidden local/demo input and be at least 12 characters',
  );
}

const database = new URL(databaseUrl);
const databaseHost = database.hostname.toLowerCase();
const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ''));
if (appEnv === 'demo' && databaseName !== demoDatabaseName) {
  throw new Error('Hosted owner-demo seed requires the approved demo database name');
}
if (
  ['local', 'test'].includes(appEnv) &&
  !['localhost', '127.0.0.1', '::1'].includes(databaseHost)
) {
  throw new Error('Local/test owner-demo seed refuses non-loopback database hosts');
}

function localBusinessDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(new Date());
}

function nextBusinessDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

async function main() {
  const businessDate = localBusinessDate();
  const nextDate = nextBusinessDate(businessDate);
  const opening = `${businessDate}T05:00:00.000Z`;
  const segmentOpen = `${businessDate}T06:00:00.000Z`;
  const segmentClose = `${businessDate}T08:00:00.000Z`;
  const close = `${nextDate}T05:00:00.000Z`;
  const sql = postgres(databaseUrl, { max: 4 });

  try {
    const existing = (await sql`
      select
        t.id as tenant_id,
        le.id as legal_entity_id,
        u.id as user_id,
        min(s.id::text) filter (where s.code = 'BINDURA') as station_id,
        count(s.id) as station_total_count,
        count(*) filter (where s.code in ('BINDURA', 'MARUTA', 'ARCTURUS', 'GAZEBO')) as station_count,
        m.status as membership_status,
        (
          select count(*)
          from auth.account a
          where a.user_id = u.id and a.provider_id = 'credential'
        ) as credential_account_count,
        (
          select count(*)
          from app.membership_role_assignments ra
          where ra.tenant_id = t.id and ra.membership_id = m.id and ra.role_code = 'OWNER'
        ) as owner_scope_count,
        (
          select count(*)
          from app.membership_role_assignments ra
          where ra.tenant_id = t.id and ra.membership_id = m.id and ra.role_code = 'OWNER'
            and ra.scope_type = 'TENANT' and ra.legal_entity_id is null and ra.station_id is null
        ) as owner_tenant_scope_count,
        coalesce((
          select array_agg(s3.code order by s3.code)
          from app.membership_role_assignments ra
          join app.stations s3 on s3.id = ra.station_id
          where ra.tenant_id = t.id and ra.membership_id = m.id and ra.role_code = 'OWNER'
            and ra.scope_type = 'STATION' and ra.legal_entity_id = le.id
        ), ARRAY[]::text[]) as owner_station_codes,
        (
          select count(*)
          from app.reconciliations r
          where r.tenant_id = t.id and r.station_id = (
            select s2.id from app.stations s2
            where s2.tenant_id = t.id and s2.legal_entity_id = le.id and s2.code = 'BINDURA'
            limit 1
          )
            and r.state = 'POSTED'
        ) as posted_sale_count,
        (
          select count(*)
          from app.forecourt_idempotency_records i
          where i.tenant_id = t.id
            and i.command_type = 'CreateProductionReconciliation'
            and i.idempotency_key = 'owner-demo-sale-create-reconciliation'
            and i.status = 'COMPLETED'
        ) as sale_marker_count
      from app.tenants t
      join app.legal_entities le on le.tenant_id = t.id
      join app.memberships m on m.tenant_id = t.id
      join auth."user" u on u.id = m.identity_id
      left join app.stations s on s.tenant_id = t.id and s.legal_entity_id = le.id
      where t.slug = ${demoTenantSlug} and u.email = ${demoEmail}
      group by t.id, le.id, u.id, m.id, m.status
    `) as Array<{
      tenant_id: string;
      legal_entity_id: string;
      user_id: string;
      station_id: string | null;
      station_total_count: string;
      station_count: string;
      membership_status: string;
      credential_account_count: string;
      owner_scope_count: string;
      owner_tenant_scope_count: string;
      owner_station_codes: string[];
      posted_sale_count: string;
      sale_marker_count: string;
    }>;

    const completeExisting = isCompleteOwnerDemoFixture(
      existing.map((row) => ({
        stationId: row.station_id,
        stationTotalCount: row.station_total_count,
        stationCount: row.station_count,
        membershipStatus: row.membership_status,
        credentialAccountCount: row.credential_account_count,
        ownerScopeCount: row.owner_scope_count,
        ownerTenantScopeCount: row.owner_tenant_scope_count,
        ownerStationCodes: row.owner_station_codes,
        postedSaleCount: row.posted_sale_count,
        saleMarkerCount: row.sale_marker_count,
      })),
    );

    if (existing.length > 0 && !completeExisting) {
      throw new Error(
        'Existing owner-demo fixture is incomplete; refusing to create a duplicate. Repair or reset it explicitly.',
      );
    }

    if (completeExisting) {
      if (resetExisting) {
        const passwordHash = await hashPassword(demoPassword);
        const updated = await sql`
          update auth.account
          set password = ${passwordHash}
          where user_id = ${existing[0].user_id} and provider_id = 'credential'
        `;
        if (updated.count !== 1) {
          throw new Error(
            'Owner-demo password reset did not update exactly one credential account',
          );
        }
      }
      console.log(
        JSON.stringify({
          tenantId: existing[0].tenant_id,
          legalEntityId: existing[0].legal_entity_id,
          stationId: existing[0].station_id,
          email: demoEmail,
          businessDate,
          idempotent: true,
          dashboardPath: `/?tenantId=${existing[0].tenant_id}&legalEntityId=${existing[0].legal_entity_id}`,
        }),
      );
      return;
    }

    const ctx = await createQa1ScenarioContext(sql, 'owner-demo');
    const arcturusId = randomUUID();
    const gazeboId = randomUUID();
    const passwordHash = await hashPassword(demoPassword);
    const userId = ctx.actors.admin.actorId;

    await sql.unsafe(`
        update app.tenants set name = 'T.E.I Oils', slug = '${demoTenantSlug}' where id = '${ctx.tenantId}';
        update app.legal_entities set legal_name = 'Triumph Energy' where id = '${ctx.legalEntityId}';
        update app.products set code = 'DEMO-DIESEL', name = 'Synthetic Diesel' where id = '${ctx.productId}';
        update app.tanks set code = 'DEMO-TANK' where id = '${ctx.tankId}';
        update app.stations set
          code = case id when '${ctx.stationId}' then 'BINDURA' else 'MARUTA' end,
          name = case id when '${ctx.stationId}' then 'Bindura' else 'Maruta' end
        where tenant_id = '${ctx.tenantId}' and id in ('${ctx.stationId}', '${ctx.outsideStationId}');
        update app.station_business_days set business_date = '${businessDate}' where id = '${ctx.businessDayId}';
        insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone)
          values
            ('${arcturusId}', '${ctx.tenantId}', '${ctx.legalEntityId}', 'ARCTURUS', 'Arcturus', 'ACTIVE', 'Africa/Harare'),
            ('${gazeboId}', '${ctx.tenantId}', '${ctx.legalEntityId}', 'GAZEBO', 'Gazebo', 'ACTIVE', 'Africa/Harare');
        delete from app.membership_role_assignments
          where tenant_id = '${ctx.tenantId}' and membership_id = '${ctx.actors.admin.membershipId}';
        insert into app.membership_role_assignments
          (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values
          ('${ctx.tenantId}', '${ctx.actors.admin.membershipId}', 'OWNER', 'TENANT', null, null),
          ('${ctx.tenantId}', '${ctx.actors.admin.membershipId}', 'OWNER', 'STATION', '${ctx.legalEntityId}', '${ctx.stationId}'),
          ('${ctx.tenantId}', '${ctx.actors.admin.membershipId}', 'OWNER', 'STATION', '${ctx.legalEntityId}', '${ctx.outsideStationId}'),
          ('${ctx.tenantId}', '${ctx.actors.admin.membershipId}', 'OWNER', 'STATION', '${ctx.legalEntityId}', '${arcturusId}'),
          ('${ctx.tenantId}', '${ctx.actors.admin.membershipId}', 'OWNER', 'STATION', '${ctx.legalEntityId}', '${gazeboId}');
      `);

    await sql.unsafe(`
        update auth."user"
          set name = 'Synthetic Owner Demo', email = '${demoEmail}'
          where id = '${userId}';
        insert into auth.account (id, account_id, provider_id, user_id, password)
          values ('${userId}', '${userId}', 'credential', '${userId}', '${passwordHash}')
          on conflict (provider_id, account_id) do update set password = excluded.password;
      `);

    const sale = await createApprovedSale(sql, ctx, 'owner-demo-sale', {
      saleLitres: '250.000',
      payments: [
        { method: 'CASH', amount: '500.0000' },
        { method: 'POS', amount: '125.0000', reference: 'DEMO-POS-001' },
      ],
      segmentBoundaryTimes: [segmentOpen, segmentClose],
      openingEffectiveAt: opening,
      plannedStartAt: opening,
      plannedEndAt: close,
      completeShiftAfter: true,
    });

    console.log(
      JSON.stringify({
        tenantId: ctx.tenantId,
        legalEntityId: ctx.legalEntityId,
        stationId: ctx.stationId,
        email: demoEmail,
        businessDate,
        saleId: sale.reconciliationId,
        idempotent: false,
        dashboardPath: `/?tenantId=${ctx.tenantId}&legalEntityId=${ctx.legalEntityId}`,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
    await closeDatabase();
  }
}

void main();
