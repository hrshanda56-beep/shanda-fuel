import { POST } from '../../src/app/api/expenses/commands/route';
import { seedClerkSession, clerkHeaders, fixtureSession } from './auth-session-fixtures';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { beforeAll, afterAll, it, expect } from 'vitest';
const tenant = randomUUID(),
  entity = randomUUID(),
  station = randomUUID(),
  category = randomUUID(),
  expense = randomUUID();
const people = ['SUPERVISOR', 'ATTENDANT'].map((role) => ({
  role,
  id: randomUUID(),
  membership: randomUUID(),
  token: randomUUID(),
}));
let db: Sql, runtime: Sql;
const scoped = async <T>(actor: number, run: (tx: Sql) => Promise<T>): Promise<T> =>
  runtime.begin(async (tx) => {
    await tx`select set_config('app.tenant_id',${tenant},true),set_config('app.station_id',${station},true),set_config('app.actor_id',${people[actor]!.id},true),set_config('app.membership_id',${people[actor]!.membership},true)`;
    return run(tx as unknown as Sql);
  }) as Promise<T>;
beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url || new URL(url).pathname !== '/shanda_unified_expense_test')
    throw Error('Separate local integration database required');
  db = postgres(url, { max: 1, onnotice: () => {} });
  runtime = postgres(process.env.FINANCE_RUNTIME_DATABASE_URL!, { max: 2, onnotice: () => {} });
  await db`insert into app.tenants(id,name,slug) values(${tenant},'Unified expenses',${tenant})`;
  await db`insert into app.legal_entities(id,tenant_id,legal_name) values(${entity},${tenant},'Unified expenses')`;
  await db`insert into app.stations(id,tenant_id,legal_entity_id,code,name,timezone,status) values(${station},${tenant},${entity},${station},'Unified expenses','Africa/Harare','ACTIVE')`;
  for (const p of people) {
    await db`insert into app.users(id,name) values(${p.id},${p.role})`;
    await db`insert into app.memberships(id,tenant_id,identity_id,status) values(${p.membership},${tenant},${p.id},'ACTIVE')`;
    await db`insert into app.membership_role_assignments(tenant_id,membership_id,role_code,scope_type,legal_entity_id,station_id) values(${tenant},${p.membership},${p.role},'STATION',${entity},${station})`;
  }
  for (const p of people) {
    const session = randomUUID();
    await seedClerkSession(db, session, p.token, p.id);
    fixtureSession(session).tenantId = tenant;
  }
  await db`insert into app.expense_categories(id,tenant_id,code,name,classification,created_by) values(${category},${tenant},'REPAIR','Repairs','OPERATING',${people[0]!.membership})`;
  await scoped(
    0,
    (tx) =>
      tx`insert into app.expenses(id,tenant_id,legal_entity_id,station_id,category_id,expense_date,description,amount,submitted_by) values(${expense},${tenant},${entity},${station},${category},'2026-10-19','Repair','25',${people[0]!.membership})`,
  );
});
afterAll(async () => {
  await runtime?.end();
  await db?.end();
});
it('creates one immutable version with the existing expense identity', async () => {
  const rows = await scoped(
    0,
    (tx) =>
      tx`select e.id,e.current_version_id,v.amount from app.expenses e join app.expense_versions v on v.tenant_id=e.tenant_id and v.station_id=e.station_id and v.id=e.current_version_id where e.id=${expense}`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.amount).toBe('25.0000');
  await expect(
    db`update app.expense_versions set amount=30 where id=${rows[0]!.current_version_id}`,
  ).rejects.toThrow(/immutable/);
});
it('corrects by appending a version and rejects another correction against the old version', async () => {
  const original = (await db`select current_version_id from app.expenses where id=${expense}`)[0]!
    .current_version_id;
  await expect(
    scoped(
      1,
      (tx) =>
        tx`select app.correct_expense_version(${expense},${original},'30','Repair corrected',null,null,'Receipt typo')`,
    ),
  ).rejects.toThrow();
  const changed = await scoped(
    0,
    (tx) =>
      tx`select app.correct_expense_version(${expense},${original},'30','Repair corrected',null,null,'Receipt typo') as result`,
  );
  expect(changed[0]!.result.versionNumber).toBe(2);
  const versions =
    await db`select amount,previous_version_id from app.expense_versions where expense_id=${expense} order by version_number`;
  expect(versions.map((v) => v.amount)).toEqual(['25.0000', '30.0000']);
  expect(versions[1]!.previous_version_id).toBe(original);
  await expect(
    scoped(
      0,
      (tx) =>
        tx`select app.correct_expense_version(${expense},${original},'35','Changed',null,null,'Stale')`,
    ),
  ).rejects.toThrow(/stale/);
});
it('rejects unreasoned, foreign and reviewed corrections and direct cache tampering', async () => {
  const current = (await db`select current_version_id from app.expenses where id=${expense}`)[0]!
    .current_version_id;
  await expect(
    scoped(
      0,
      (tx) =>
        tx`select app.correct_expense_version(${expense},${current},'35','Changed',null,null,'')`,
    ),
  ).rejects.toThrow();
  await expect(
    scoped(
      0,
      (tx) =>
        tx`select app.correct_expense_version(${randomUUID()},${current},'35','Changed',null,null,'Reason')`,
    ),
  ).rejects.toThrow(/not found/);
  await expect(
    scoped(0, (tx) => tx`update app.expenses set amount=99 where id=${expense}`),
  ).rejects.toThrow(/immutable/);
  await db`insert into app.expense_approvals(id,tenant_id,expense_id,decision,actor_membership_id) values(${randomUUID()},${tenant},${expense},'APPROVED',${people[1]!.membership})`;
  await expect(
    scoped(
      0,
      (tx) =>
        tx`select app.correct_expense_version(${expense},${current},'35','Changed',null,null,'Reason')`,
    ),
  ).rejects.toThrow(/unreviewed/);
});

it('corrects through the authenticated API with audit/idempotency and rejects actor forgery', async () => {
  const id = randomUUID();
  await scoped(
    0,
    (tx) =>
      tx`insert into app.expenses(id,tenant_id,legal_entity_id,station_id,category_id,expense_date,description,amount,submitted_by) values(${id},${tenant},${entity},${station},${category},'2026-10-19','API repair','10',${people[0]!.membership})`,
  );
  const prior = (await db`select current_version_id from app.expenses where id=${id}`)[0]!
    .current_version_id;
  const body = {
    commandType: 'CorrectExpenseFacts',
    tenantId: tenant,
    stationId: station,
    expenseId: id,
    expectedVersion: 0,
    expectedVersionId: prior,
    amount: '12.5000',
    description: 'Correct receipt',
    reason: 'Typo',
  };
  const key = randomUUID();
  const post = (input: unknown, actor = 0, k = key) =>
    POST(
      new Request('http://localhost/api/expenses/commands', {
        method: 'POST',
        headers: {
          ...clerkHeaders(people[actor]!.token),
          'Content-Type': 'application/json',
          'Idempotency-Key': k,
        },
        body: JSON.stringify(input),
      }),
    );
  expect((await post(body, 1)).status).toBe(403);
  expect((await post({ ...body, actorId: people[1]!.membership })).status).toBe(400);
  const saved = await post(body);
  expect(saved.status, await saved.clone().text()).toBe(200);
  const result = await saved.json();
  const replay = await post(body);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect((await post(body, 0, randomUUID())).status).toBe(409);
  expect(await db`select id from app.expense_versions where expense_id=${id}`).toHaveLength(2);
  const audit =
    await db`select id from platform.security_events where tenant_id=${tenant} and event_code='EXPENSE.FACTS_CORRECTED'`;
  expect(audit).toHaveLength(1);
});

it('serializes simultaneous corrections so only one can advance the current version', async () => {
  const id = randomUUID();
  await scoped(
    0,
    (tx) =>
      tx`insert into app.expenses(id,tenant_id,legal_entity_id,station_id,category_id,expense_date,description,amount,submitted_by) values(${id},${tenant},${entity},${station},${category},'2026-10-19','Concurrent repair','10',${people[0]!.membership})`,
  );
  const prior = (await db`select current_version_id from app.expenses where id=${id}`)[0]!
    .current_version_id;
  const results = await Promise.allSettled(
    ['12', '13'].map((amount) =>
      scoped(
        0,
        (tx) =>
          tx`select app.correct_expense_version(${id},${prior},${amount},'Correction',null,null,'Receipt')`,
      ),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const versions =
    await db`select version_number from app.expense_versions where expense_id=${id} order by version_number`;
  expect(versions.map((v) => v.version_number)).toEqual([1, 2]);
});
