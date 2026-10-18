/**
 * Local demo customers: credit, prepaid value and prepaid litres accounts with some top-ups, so the
 * Customers pages have something to show.
 *
 * It drives the real customer commands as the owner created by `pnpm db:seed`, like the Finance
 * demo seed. Run it against the local development database after the DEV1 station and the Diesel
 * product exist (the Finance demo creates both):
 *
 *   DATABASE_URL=... pnpm exec vitest run --config vitest.dev-seed.config.ts customers
 *
 * It refuses to run anywhere except a loopback database with APP_ENV=local. Customers whose
 * reference already exists and that already have their accounts are left alone, so it can be re-run.
 */
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { clerkFixtures } from '../../tests/vitest/clerk-integration';
import { clerkHeaders, seedActiveStepUp } from '../../tests/integration/auth-session-fixtures';
import { POST as customerPost } from '../../src/app/api/customers/commands/route';

const databaseUrl = process.env.DATABASE_URL ?? '';
const loopback = (() => {
  try {
    return ['127.0.0.1', 'localhost', '::1'].includes(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
})();

type Account =
  | { type: 'CREDIT'; limit: string; topUps?: never }
  | { type: 'PREPAID_VALUE'; topUps: ReadonlyArray<{ on: string; amount: string }>; limit?: never }
  | {
      type: 'PREPAID_LITRES';
      topUps: ReadonlyArray<{ on: string; litres: string }>;
      limit?: never;
    };

const customers: ReadonlyArray<{
  reference: string;
  name: string;
  contact?: Record<string, string>;
  suspended?: boolean;
  accounts: ReadonlyArray<Account>;
}> = [
  {
    reference: 'CUST-0001',
    name: 'Matabeleland Haulage',
    contact: { phone: '+263 77 100 0001', email: 'accounts@matabelelandhaulage.example' },
    accounts: [{ type: 'CREDIT', limit: '5000.0000' }],
  },
  {
    reference: 'CUST-0002',
    name: 'Zambezi Safaris',
    contact: { phone: '+263 77 100 0002' },
    accounts: [
      { type: 'CREDIT', limit: '2500.0000' },
      { type: 'PREPAID_VALUE', topUps: [{ on: '2026-10-05', amount: '600.0000' }] },
    ],
  },
  {
    reference: 'CUST-0003',
    name: 'Greenfields Farm Co-op',
    accounts: [
      {
        type: 'PREPAID_LITRES',
        topUps: [
          { on: '2026-09-28', litres: '1500.000' },
          { on: '2026-10-12', litres: '800.000' },
        ],
      },
    ],
  },
  {
    reference: 'CUST-0004',
    name: 'City Council Fleet',
    contact: { phone: '+263 24 200 0004', email: 'fleet@citycouncil.example' },
    accounts: [{ type: 'CREDIT', limit: '12000.0000' }],
  },
  {
    reference: 'CUST-0005',
    name: 'Tendai Moyo Transport',
    accounts: [
      {
        type: 'PREPAID_VALUE',
        topUps: [
          { on: '2026-10-01', amount: '250.0000' },
          { on: '2026-10-09', amount: '120.5000' },
          { on: '2026-10-16', amount: '300.0000' },
        ],
      },
    ],
  },
  {
    reference: 'CUST-0006',
    name: 'Sunrise Bakery',
    suspended: true,
    accounts: [{ type: 'CREDIT', limit: '800.0000' }],
  },
  {
    reference: 'CUST-0007',
    name: 'Highveld Mining Supplies',
    suspended: true,
    accounts: [{ type: 'PREPAID_VALUE', topUps: [{ on: '2026-08-20', amount: '1000.0000' }] }],
  },
  { reference: 'CUST-0008', name: 'Nyasha Mutasa', accounts: [] },
];

describe.skipIf(!loopback)('local demo customers', () => {
  it('seeds the customers demo', async () => {
    if (process.env.APP_ENV !== 'local')
      throw new Error('The demo seed only runs with APP_ENV=local');
    const client: Sql = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      await run(client);
    } finally {
      await client.end();
    }
  });
});

async function run(client: Sql) {
  const [tenant] = await client<
    { id: string }[]
  >`select id from app.tenants where slug='shanda-dev'`;
  if (!tenant) throw new Error('Run the owner seed first');
  const tenantId = tenant.id;
  const [station] = await client<
    { id: string; legal_entity_id: string }[]
  >`select id, legal_entity_id from app.stations where tenant_id=${tenantId} and code='DEV1'`;
  const [product] = await client<
    { id: string }[]
  >`select id from app.products where tenant_id=${tenantId} and code='DIESEL'`;
  if (!station || !product) throw new Error('Run the Finance demo seed first (DEV1 and Diesel)');

  const [owner] = await client<{ provider_user_id: string; user_id: string }[]>`
    select ai.provider_user_id, u.id as user_id
    from app.memberships m
    join app.users u on u.id = m.identity_id
    join app.auth_identities ai on ai.internal_user_id = u.id and ai.provider='CLERK'
    join app.membership_role_assignments a on a.membership_id = m.id
    where m.tenant_id=${tenantId} and a.role_code='OWNER' limit 1`;
  if (!owner) throw new Error('Seed an OWNER user first');

  const sessionId = randomUUID();
  const token = 'demo-customers-owner-token';
  clerkFixtures.sessions.set(token, {
    id: sessionId,
    userId: owner.provider_user_id,
    internalUserId: owner.user_id,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    factorVerificationAge: [0, 0],
    revoked: false,
  });
  await seedActiveStepUp(client, sessionId, tenantId);

  async function call(input: Record<string, unknown>, key: string) {
    const response = await customerPost(
      new Request('http://127.0.0.1:3000/api/customers/commands', {
        method: 'POST',
        headers: {
          ...clerkHeaders(token),
          'content-type': 'application/json',
          'idempotency-key': `demo-customers-${key}`,
        },
        body: JSON.stringify(input),
      }),
    );
    const body = (await response.json()) as Record<string, any>;
    expect(response.status, `${String(input.commandType)}: ${JSON.stringify(body)}`).toBeLessThan(
      300,
    );
    return body;
  }

  for (const customer of customers) {
    const [found] = await client<
      { id: string; status: string; version: number; accounts: string }[]
    >`
      select c.id, c.status, c.version,
        (select count(*) from app.customer_accounts a where a.customer_id = c.id)::text as accounts
      from app.customers c
      where c.tenant_id=${tenantId} and c.account_reference=${customer.reference}`;
    if (found && Number(found.accounts) > 0) {
      if (customer.suspended && found.status === 'ACTIVE') {
        await call(
          {
            commandType: 'DeactivateCustomer',
            tenantId,
            customerId: found.id,
            expectedVersion: found.version,
          },
          `${customer.reference}-deactivate-v${found.version}`,
        );
      }
      continue;
    }

    let customerId = found?.id;
    let version = found?.version ?? 0;
    if (!customerId) {
      const created = await call(
        {
          commandType: 'CreateCustomer',
          tenantId,
          accountReference: customer.reference,
          displayName: customer.name,
          legalEntityId: station.legal_entity_id,
          ...(customer.contact ? { contactMetadata: customer.contact } : {}),
        },
        `${customer.reference}-create`,
      );
      customerId = created.customerId as string;
      version = created.version ?? 0;
    } else if (found!.status !== 'ACTIVE') {
      const activated = await call(
        { commandType: 'ActivateCustomer', tenantId, customerId, expectedVersion: version },
        `${customer.reference}-activate-v${version}`,
      );
      version = activated.version ?? version + 1;
    }
    for (const account of customer.accounts) {
      const opened = await call(
        {
          commandType: 'CreateCustomerAccount',
          tenantId,
          customerId,
          accountType: account.type,
          currency: 'USD',
          stationScope: 'ALL',
          ...(account.type === 'CREDIT' ? { creditLimit: account.limit } : {}),
        },
        `${customer.reference}-${account.type}-account`,
      );
      for (const [index, topUp] of (account.topUps ?? []).entries()) {
        await call(
          {
            commandType: 'RecordPrepaidTopUp',
            tenantId,
            accountId: opened.accountId,
            accountType: account.type,
            ...('amount' in topUp
              ? { amount: { amount: topUp.amount, currency: 'USD' } }
              : { productId: product.id, litres: topUp.litres }),
            source: { sourceType: 'PREPAID_TOPUP', sourceId: randomUUID() },
            occurredAt: `${topUp.on}T09:30:00+02:00`,
            businessDate: topUp.on,
          },
          `${customer.reference}-${account.type}-topup-${index}`,
        );
      }
    }
    // Accounts can only be opened for active customers, so suspend last.
    if (customer.suspended) {
      await call(
        { commandType: 'DeactivateCustomer', tenantId, customerId, expectedVersion: version },
        `${customer.reference}-deactivate-v${version}`,
      );
    }
  }
}
