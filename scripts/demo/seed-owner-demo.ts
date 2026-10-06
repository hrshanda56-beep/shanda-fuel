import postgres from 'postgres';
import { hashPassword } from 'better-auth/crypto';
import { createQa1ScenarioContext } from '../../tests/integration/qa1/fixture';
import { createApprovedSale } from '../../tests/integration/qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
const appEnv = process.env.APP_ENV ?? 'local';
const demoPassword = process.env.DEMO_PASSWORD;

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!['local', 'test'].includes(appEnv)) {
  throw new Error('The owner-demo seed is local-only; use APP_ENV=local or APP_ENV=test');
}
if (!demoPassword || demoPassword.length < 12) {
  throw new Error(
    'DEMO_PASSWORD must be supplied through hidden local input and be at least 12 characters',
  );
}

const databaseHost = new URL(databaseUrl).hostname.toLowerCase();
if (!['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
  throw new Error('The owner-demo seed refuses non-loopback database hosts');
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
    const ctx = await createQa1ScenarioContext(sql, 'owner-demo');
    await sql.unsafe(`
      update app.tenants set name = 'T.E.I Oils', slug = 'tei-oils-demo-${ctx.runId.slice(0, 8)}' where id = '${ctx.tenantId}';
      update app.legal_entities set legal_name = 'Triumph Energy' where id = '${ctx.legalEntityId}';
      update app.products set code = 'DEMO-DIESEL', name = 'Synthetic Diesel' where id = '${ctx.productId}';
      update app.tanks set code = 'DEMO-TANK' where id = '${ctx.tankId}';
      update app.stations set
        code = case id when '${ctx.stationId}' then 'BINDURA' else 'MARUTA' end,
        name = case id when '${ctx.stationId}' then 'Bindura' else 'Maruta' end
      where tenant_id = '${ctx.tenantId}' and id in ('${ctx.stationId}', '${ctx.outsideStationId}');
      update app.station_business_days set business_date = '${businessDate}' where id = '${ctx.businessDayId}';
    `);

    const passwordHash = await hashPassword(demoPassword);
    const userId = ctx.actors.admin.actorId;
    await sql.unsafe(`
      update auth."user"
        set name = 'Synthetic Owner Demo', email = 'demo-owner@tei-oils.example.test'
        where id = '${userId}';
      insert into auth.account (id, account_id, provider_id, user_id, password)
        values ('${userId}', '${userId}', 'credential', '${userId}', '${passwordHash}')
        on conflict (provider_id, account_id) do update set password = excluded.password;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone)
        values
          (gen_random_uuid(), '${ctx.tenantId}', '${ctx.legalEntityId}', 'ARCTURUS', 'Arcturus', 'ACTIVE', 'Africa/Harare'),
          (gen_random_uuid(), '${ctx.tenantId}', '${ctx.legalEntityId}', 'GAZEBO', 'Gazebo', 'ACTIVE', 'Africa/Harare');
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
        email: 'demo-owner@tei-oils.example.test',
        businessDate,
        saleId: sale.reconciliationId,
        dashboardPath: `/?tenantId=${ctx.tenantId}&legalEntityId=${ctx.legalEntityId}`,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
