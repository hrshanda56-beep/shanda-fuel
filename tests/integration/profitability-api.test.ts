import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { GET as profitabilityGet } from '../../src/app/api/reports/profitability/route';
import { clerkHeaders, seedClerkSession } from './auth-session-fixtures';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the profitability API integration tests.');
}

// Unique per run so the suite can be re-run against the same database.
const run = randomBytes(4).toString('hex');
const uid = (n: number) => `${run}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ids = {
  tenant: uid(1),
  otherTenant: uid(2),
  legal: uid(3),
  otherLegal: uid(4),
  stationA: uid(5),
  stationB: uid(6),
  otherStation: uid(7),
  product: uid(8),
  otherProduct: uid(9),
  financeUser: uid(11),
  financeMembership: uid(12),
  financeSession: uid(13),
  stationBUser: uid(14),
  stationBMembership: uid(15),
  stationBSession: uid(16),
  attendantUser: uid(17),
  attendantMembership: uid(18),
  attendantSession: uid(19),
  otherUser: uid(20),
  otherMembership: uid(21),
  otherSession: uid(22),
};
const tokens = {
  finance: `profit-finance-token-${run}`,
  stationB: `profit-station-b-token-${run}`,
  attendant: `profit-attendant-token-${run}`,
  other: `profit-other-tenant-token-${run}`,
};

type SaleSeed = {
  key: number;
  tenantId: string;
  legalId: string;
  stationId: string;
  businessDate: string;
  revenue: string;
  /** null leaves the sale without validated A12 cost evidence. */
  cogs: string | null;
  revaluation?: string;
  expense?: string;
};

function saleSql(sale: SaleSeed): string {
  const productId = sale.tenantId === ids.otherTenant ? ids.otherProduct : ids.product;
  const base = 1000 + sale.key * 40;
  const [recon, rev, seg, mov, bridge, revenue, evt, attr, day, shift, tank, nozzle, inst, ob, cb] =
    Array.from({ length: 15 }, (_, i) => uid(base + i));
  const rline = uid(base + 20);
  const revalId = uid(base + 21);
  const revalEvt = uid(base + 22);
  const at = `${sale.businessDate}T07:00:00Z`;
  const membership = ids.financeMembership;
  let out = `
    insert into app.reconciliations (id, tenant_id, station_id, business_day_id, state, version)
      values ('${recon}', '${sale.tenantId}', '${sale.stationId}', '${day}', 'POSTED', 0);
    insert into app.reconciliation_revisions
      (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales,
       variance, currency, variance_classification, declarations, source_segment_ids, source_shift_ids,
       posted_by, posted_at)
      values ('${rev}', '${sale.tenantId}', '${sale.stationId}', '${recon}', 1, 'POSTED', ${sale.revenue},
       ${sale.revenue}, 0.0000, 'USD', 'INFORMATIONAL', '[]'::jsonb, '["${seg}"]'::jsonb, '["${shift}"]'::jsonb,
       '${membership}', '${at}');
    insert into app.meter_segments
      (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
       opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading,
       closing_reading, litres, unit_price, expected_sale_value, currency, boundary_reason,
       segment_start_at, segment_end_at, sealed_at, state, version)
      values ('${seg}', '${sale.tenantId}', '${sale.stationId}', '${nozzle}', '${inst}', '${day}', '${shift}',
       '${ob}', '${cb}', '${productId}', '${membership}', '${membership}', 0.000, 1.000, 1.000,
       10.000000, 10.0000, 'USD', 'PROFIT TEST', '${sale.businessDate}T06:00:00Z', '${at}', '${at}', 'SEALED', 1);
    insert into app.reconciliation_meter_reading_segments
      (id, tenant_id, station_id, reconciliation_id, revision_id, reconciliation_meter_reading_id,
       meter_segment_id, allocated_litres)
      values ('${bridge}', '${sale.tenantId}', '${sale.stationId}', '${recon}', '${rev}', '${uid(base + 23)}', '${seg}', 1.000);
    insert into app.inventory_movements
      (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at,
       business_date, source_type, source_id, actor_membership_id, posted_at)
      values ('${mov}', '${sale.tenantId}', '${sale.stationId}', '${tank}', '${productId}', 'SALE', -1.000,
       '${at}', '${sale.businessDate}', 'METER_SEGMENT_SALE', '${seg}', '${membership}', '${at}');
    insert into app.sale_recognition_movements
      (id, tenant_id, legal_entity_id, station_id, business_date, product_id, tank_id, nozzle_id, shift_id,
       meter_segment_id, inventory_sale_movement_id, reconciliation_id, reconciliation_revision_id,
       reconciliation_meter_reading_id, quantity_litres, reconciliation_value, recognized_revenue_amount,
       currency, effective_at, source_id, actor_membership_id, request_id, replay_fingerprint)
      values ('${revenue}', '${sale.tenantId}', '${sale.legalId}', '${sale.stationId}', '${sale.businessDate}',
       '${productId}', '${tank}', '${nozzle}', '${shift}', '${seg}', '${mov}', '${recon}', '${rev}',
       '${uid(base + 23)}', 1.000, ${sale.revenue}, ${sale.revenue}, 'USD', '${at}', '${seg}',
       '${membership}', '${uid(base + 24)}', 'profit-revenue-${sale.key}');
  `;
  if (sale.cogs !== null) {
    out += `
    insert into app.inventory_cost_events
      (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at,
       business_date, amount, currency, actor_membership_id)
      values ('${evt}', '${sale.tenantId}', '${sale.stationId}', '${tank}', '${productId}', 'SALE_COGS',
       'METER_SEGMENT_SALE', '${seg}', '${at}', '${sale.businessDate}', -${sale.cogs}, 'USD', '${membership}');
    insert into app.inventory_sale_cost_attributions
      (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id,
       sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis,
       replay_fingerprint, sale_cost_event_id, effective_at, business_date)
      values ('${attr}', '${sale.tenantId}', '${sale.stationId}', '${tank}', '${productId}', '${mov}', '${seg}',
       1.000, ${sale.cogs}, ${sale.cogs}, 'VALUED', 'PRE_SALE_WAC', 'profit-attr-${sale.key}', '${evt}', '${at}',
       '${sale.businessDate}');
    `;
  }
  if (sale.cogs !== null && sale.revaluation) {
    const delta = sale.revaluation;
    out += `
    insert into app.inventory_cost_revaluations
      (id, tenant_id, station_id, tank_id, product_id, reason, status, source_type, source_id, amount,
       currency, effective_at, business_date, requested_by, requested_at, approved_by, approved_at,
       posted_by, posted_at, replay_fingerprint)
      values ('${revalId}', '${sale.tenantId}', '${sale.stationId}', '${tank}', '${productId}',
       'profit test late cost', 'POSTED', 'PROFIT_TEST', '${uid(base + 25)}', ${delta.replace('-', '')}, 'USD',
       '${at}', '${sale.businessDate}', '${membership}', '${at}', '${membership}', '${at}', '${membership}',
       '${at}', 'profit-reval-${sale.key}');
    insert into app.inventory_cost_events
      (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at,
       business_date, amount, currency, actor_membership_id)
      values ('${revalEvt}', '${sale.tenantId}', '${sale.stationId}', '${tank}', '${productId}',
       'COGS_REVALUATION', 'INVENTORY_COST_REVALUATION_LINE', '${rline}', '${at}', '${sale.businessDate}',
       ${delta}, 'USD', '${membership}');
    insert into app.inventory_cost_revaluation_lines
      (id, tenant_id, station_id, tank_id, product_id, revaluation_id, sale_movement_id, sale_attribution_id,
       original_pre_sale_wac, recomputed_pre_sale_wac, original_cogs, prior_restated_cogs, recomputed_cogs,
       cogs_delta, currency, sale_effective_at, cogs_revaluation_event_id, replay_fingerprint)
      values ('${rline}', '${sale.tenantId}', '${sale.stationId}', '${tank}', '${productId}', '${revalId}',
       '${mov}', '${attr}', ${sale.cogs}, ${sale.cogs}, ${sale.cogs}, ${sale.cogs},
       ${sale.cogs}::numeric + (${delta}), ${delta}, 'USD', '${at}', '${revalEvt}', 'profit-line-${sale.key}');
    `;
  }
  if (sale.expense) {
    out += `
    insert into app.reconciliation_expenses
      (id, tenant_id, station_id, reconciliation_id, category, description, amount, payment_method, entered_by)
      values ('${uid(base + 26)}', '${sale.tenantId}', '${sale.stationId}', '${recon}', 'PROFIT_TEST',
       'Expense that must never be netted into COGS', ${sale.expense}, 'CASH', '${membership}');
    `;
  }
  return out;
}

async function get(token: string | null, query: string) {
  return profitabilityGet(
    new Request(`http://127.0.0.1:3000/api/reports/profitability?${query}`, {
      headers: token ? { ...clerkHeaders(token) } : {},
    }),
  );
}

describe('profitability read API (PostgreSQL)', () => {
  let client: Sql;

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    client = postgres(databaseUrl!, { max: 2, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Profit Tenant', 'profit-tenant-${run}'),
        ('${ids.otherTenant}', 'Profit Other Tenant', 'profit-other-tenant-${run}');
      insert into app.users (id, name, email) values
        ('${ids.financeUser}', 'Profit Finance', 'profit-finance-${run}@example.test'),
        ('${ids.stationBUser}', 'Profit Station B Finance', 'profit-station-b-${run}@example.test'),
        ('${ids.attendantUser}', 'Profit Attendant', 'profit-attendant-${run}@example.test'),
        ('${ids.otherUser}', 'Profit Other Finance', 'profit-other-${run}@example.test');
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.financeMembership}', '${ids.tenant}', '${ids.financeUser}', 'ACTIVE'),
        ('${ids.stationBMembership}', '${ids.tenant}', '${ids.stationBUser}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendantUser}', 'ACTIVE'),
        ('${ids.otherMembership}', '${ids.otherTenant}', '${ids.otherUser}', 'ACTIVE');
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Profit Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'Profit Other Legal');
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.stationA}', '${ids.tenant}', '${ids.legal}', 'PA${run}', 'Profit Station A', 'ACTIVE'),
        ('${ids.stationB}', '${ids.tenant}', '${ids.legal}', 'PB${run}', 'Profit Station B', 'ACTIVE'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'PO${run}', 'Profit Other Station', 'ACTIVE');
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.financeMembership}', 'FINANCE', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.stationBMembership}', 'FINANCE', 'STATION', '${ids.legal}', '${ids.stationB}'),
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.stationA}'),
        ('${ids.otherTenant}', '${ids.otherMembership}', 'FINANCE', 'TENANT', null, null);
      insert into app.products (id, tenant_id, code, name, status)
        values ('${ids.product}', '${ids.tenant}', 'PMS-${run}', 'Profit Petrol', 'ACTIVE'),
          ('${ids.otherProduct}', '${ids.otherTenant}', 'PMS-${run}', 'Profit Other Petrol', 'ACTIVE');
    `);
    await seedClerkSession(client, ids.financeSession, tokens.finance, ids.financeUser, true);
    await seedClerkSession(client, ids.stationBSession, tokens.stationB, ids.stationBUser, true);
    await seedClerkSession(client, ids.attendantSession, tokens.attendant, ids.attendantUser, true);
    await seedClerkSession(client, ids.otherSession, tokens.other, ids.otherUser, true);

    const sales: SaleSeed[] = [
      // Complete valued sale with a posted late-cost revaluation and a large expense.
      {
        key: 1,
        tenantId: ids.tenant,
        legalId: ids.legal,
        stationId: ids.stationA,
        businessDate: '2026-10-01',
        revenue: '123.4567',
        cogs: '80.1234',
        revaluation: '1.2500',
        expense: '999.0000',
      },
      // Station B, same day.
      {
        key: 2,
        tenantId: ids.tenant,
        legalId: ids.legal,
        stationId: ids.stationB,
        businessDate: '2026-10-01',
        revenue: '10.0000',
        cogs: '6.0000',
      },
      // One valued and one unvalued sale: costing must be UNVALUED, no partial margin.
      {
        key: 3,
        tenantId: ids.tenant,
        legalId: ids.legal,
        stationId: ids.stationA,
        businessDate: '2026-10-02',
        revenue: '50.0000',
        cogs: '30.0000',
      },
      {
        key: 4,
        tenantId: ids.tenant,
        legalId: ids.legal,
        stationId: ids.stationA,
        businessDate: '2026-10-02',
        revenue: '25.5000',
        cogs: null,
      },
      // Another tenant's sale on the same day must never leak.
      {
        key: 5,
        tenantId: ids.otherTenant,
        legalId: ids.otherLegal,
        stationId: ids.otherStation,
        businessDate: '2026-10-01',
        revenue: '9999.0000',
        cogs: '1.0000',
      },
    ];
    await client.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = 'replica'`);
      for (const sale of sales) await tx.unsafe(saleSql(sale));
    });
  });

  afterAll(async () => client?.end());

  it('returns exact revenue, restated COGS and gross margin without netting expenses', async () => {
    const response = await get(
      tokens.finance,
      `tenantId=${ids.tenant}&stationIds=${ids.stationA}&fromDate=2026-10-01&toDate=2026-10-01`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as Record<string, any>;
    expect(body.report).toBe('PROFITABILITY');
    expect(body.revenue).toMatchObject({
      revenueStatus: 'POSTED',
      recognizedRevenue: '123.4567',
      saleCount: 1,
    });
    expect(body.costing).toMatchObject({
      costingStatus: 'COMPLETE',
      originalCogs: '80.1234',
      revaluationDelta: '1.2500',
      restatedCogs: '81.3734',
    });
    expect(body.grossMargin).toBe('42.0833');
    expect(body.grossMarginStatus).toBe('COMPLETE');
    expect(body.fuelProfit).toEqual([
      expect.objectContaining({
        productId: ids.product,
        productCode: `PMS-${run}`,
        revenue: '123.4567',
        cost: '81.3734',
        profit: '42.0833',
        status: 'COMPLETE',
      }),
    ]);
    expect(body.expensesIncluded).toBe(false);
    expect(JSON.stringify(body)).not.toContain('999.0000');
    expect(body.dateBasis.revenue).toContain('REV1');
  });

  it('sums several authorised stations exactly and excludes other tenants', async () => {
    const response = await get(
      tokens.finance,
      `tenantId=${ids.tenant}&fromDate=2026-10-01&toDate=2026-10-01`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.revenue.recognizedRevenue).toBe('133.4567');
    expect(body.costing.restatedCogs).toBe('87.3734');
    expect(body.grossMargin).toBe('46.0833');
    expect(JSON.stringify(body)).not.toContain('9999.0000');
  });

  it('surfaces UNVALUED costing and withholds a partial margin', async () => {
    const response = await get(
      tokens.finance,
      `tenantId=${ids.tenant}&fromDate=2026-10-02&toDate=2026-10-02`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.revenue.recognizedRevenue).toBe('75.5000');
    expect(body.costing).toMatchObject({
      costingStatus: 'UNVALUED',
      restatedCogs: null,
      saleCount: 2,
      valuedSaleCount: 1,
      unvaluedSaleCount: 1,
    });
    expect(body.grossMargin).toBeNull();
    expect(body.grossMarginStatus).toBe('COSTING_UNVALUED');
  });

  it('reports NO_SALES and a null margin for an empty window', async () => {
    const response = await get(
      tokens.finance,
      `tenantId=${ids.tenant}&fromDate=2026-10-05&toDate=2026-10-06`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.revenue).toMatchObject({
      revenueStatus: 'NO_SALES',
      recognizedRevenue: '0.0000',
      saleCount: 0,
    });
    expect(body.costing.costingStatus).toBe('NO_SALES');
    expect(body.grossMargin).toBeNull();
    expect(body.grossMarginStatus).toBe('NOT_APPLICABLE');
  });

  it('isolates the other tenant to its own data', async () => {
    const response = await get(
      tokens.other,
      `tenantId=${ids.otherTenant}&fromDate=2026-10-01&toDate=2026-10-01`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.revenue.recognizedRevenue).toBe('9999.0000');
    expect(body.grossMargin).toBe('9998.0000');
  });

  it('denies cross-tenant access in both directions', async () => {
    expect(
      (
        await get(
          tokens.finance,
          `tenantId=${ids.otherTenant}&fromDate=2026-10-01&toDate=2026-10-01`,
        )
      ).status,
    ).toBe(403);
    expect(
      (await get(tokens.other, `tenantId=${ids.tenant}&fromDate=2026-10-01&toDate=2026-10-01`))
        .status,
    ).toBe(403);
    // Another tenant's station id is not discoverable through this tenant.
    expect(
      (
        await get(
          tokens.finance,
          `tenantId=${ids.tenant}&stationIds=${ids.otherStation}&fromDate=2026-10-01&toDate=2026-10-01`,
        )
      ).status,
    ).toBe(404);
  });

  it('denies a role without report.view and out-of-scope stations', async () => {
    expect(
      (
        await get(
          tokens.attendant,
          `tenantId=${ids.tenant}&stationIds=${ids.stationA}&fromDate=2026-10-01&toDate=2026-10-01`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await get(
          tokens.stationB,
          `tenantId=${ids.tenant}&stationIds=${ids.stationA}&fromDate=2026-10-01&toDate=2026-10-01`,
        )
      ).status,
    ).toBe(403);
    // One denied station rejects the whole request.
    expect(
      (
        await get(
          tokens.stationB,
          `tenantId=${ids.tenant}&stationIds=${ids.stationA},${ids.stationB}&fromDate=2026-10-01&toDate=2026-10-01`,
        )
      ).status,
    ).toBe(403);
    const allowed = await get(
      tokens.stationB,
      `tenantId=${ids.tenant}&stationIds=${ids.stationB}&fromDate=2026-10-01&toDate=2026-10-01`,
    );
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as Record<string, any>).grossMargin).toBe('4.0000');
  });

  it('requires authentication and validates the query', async () => {
    expect(
      (await get(null, `tenantId=${ids.tenant}&fromDate=2026-10-01&toDate=2026-10-01`)).status,
    ).toBe(401);
    expect(
      (await get(tokens.finance, `tenantId=${ids.tenant}&fromDate=2026-10-03&toDate=2026-10-01`))
        .status,
    ).toBe(400);
    expect(
      (await get(tokens.finance, `tenantId=${ids.tenant}&fromDate=10/01/2026&toDate=2026-10-01`))
        .status,
    ).toBe(400);
    expect((await get(tokens.finance, `tenantId=not-a-uuid&fromDate=2026-10-01`)).status).toBe(400);
  });
});
