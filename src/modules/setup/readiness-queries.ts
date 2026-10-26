import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenantTransaction } from '../../platform/db/transaction';
import { isPermissionGranted } from '../../platform/security/permissions';
import type { ContextResolution } from '../context';
import { resolveCurrentContext } from '../context/server';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/server';

import type {
  BankAccountRow,
  PaymentProviderRow,
  ProviderAccountRow,
  SetupOverview,
  SetupStationOption,
  StationSetupFacts,
} from './contracts';
import { computeStationReadiness } from './readiness';

type SetupTransaction = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

export type SetupDependencies = Readonly<{
  resolveContext?: (request: Request) => Promise<ContextResolution>;
  resolveAuthority?: (input: {
    request: Request;
    requestedTenantId: string;
    now?: Date;
  }) => Promise<TenantExecutionContext>;
  now?: Date;
}>;

type FactRow = {
  station_id: string;
  station_code: string;
  station_name: string;
  legal_entity_id: string;
  legal_entity_name: string;
  station_status: string;
  active_products: number | string;
  priced_products: number | string;
  active_tanks: number | string;
  tanks_missing_tolerance: number | string;
  tanks_missing_opening_stock: number | string;
  tanks_missing_opening_cost: number | string;
  active_pumps: number | string;
  active_nozzles: number | string;
  pumps_without_nozzle: number | string;
  active_shift_templates: number | string;
  provider_accounts: number | string;
  bank_accounts: number | string;
  assigned_staff: number | string;
};

const count = (value: number | string): number => Number(value);

/**
 * Read every setup fact for all active stations in the current tenant. The
 * statement is read-only; tenant isolation comes from the transaction's
 * fail-closed tenant GUC (RLS) plus an explicit tenant predicate.
 */
export async function readStationSetupFacts(
  transaction: SetupTransaction,
): Promise<StationSetupFacts[]> {
  const rows = await transaction.execute<FactRow>(sql`
    select
      s.id as station_id,
      s.code as station_code,
      s.name as station_name,
      s.legal_entity_id,
      (select le.legal_name from app.legal_entities le
        where le.tenant_id = s.tenant_id and le.id = s.legal_entity_id) as legal_entity_name,
      s.status as station_status,
      (select count(*) from app.products p
        where p.tenant_id = s.tenant_id and p.status = 'ACTIVE') as active_products,
      (select count(distinct sp.product_id)
         from app.selling_prices sp
         join app.products p on p.tenant_id = sp.tenant_id and p.id = sp.product_id
        where sp.tenant_id = s.tenant_id and sp.station_id = s.id
          and p.status = 'ACTIVE' and sp.state = 'ACTIVE'
          and sp.effective_from <= now()
          and (sp.effective_to is null or sp.effective_to > now())) as priced_products,
      (select count(*) from app.tanks t
        where t.tenant_id = s.tenant_id and t.station_id = s.id and t.status = 'ACTIVE')
        as active_tanks,
      (select count(*) from app.tanks t
        where t.tenant_id = s.tenant_id and t.station_id = s.id and t.status = 'ACTIVE'
          and t.acceptable_variance_litres is null) as tanks_missing_tolerance,
      (select count(*) from app.tanks t
        where t.tenant_id = s.tenant_id and t.station_id = s.id and t.status = 'ACTIVE'
          and not exists (
            select 1 from app.inventory_movements m
             where m.tenant_id = t.tenant_id and m.station_id = t.station_id
               and m.tank_id = t.id and m.movement_type = 'OPENING_BALANCE'
          )) as tanks_missing_opening_stock,
      (select count(*) from app.tanks t
        where t.tenant_id = s.tenant_id and t.station_id = s.id and t.status = 'ACTIVE'
          and exists (
            select 1 from app.inventory_movements m
             where m.tenant_id = t.tenant_id and m.station_id = t.station_id
               and m.tank_id = t.id and m.movement_type = 'OPENING_BALANCE'
          )
          and not exists (
            select 1 from app.inventory_cost_events e
             where e.tenant_id = t.tenant_id and e.station_id = t.station_id
               and e.tank_id = t.id and e.event_type = 'OPENING_COST'
          )) as tanks_missing_opening_cost,
      (select count(*) from app.pumps pu
        where pu.tenant_id = s.tenant_id and pu.station_id = s.id and pu.status = 'ACTIVE')
        as active_pumps,
      (select count(*) from app.nozzles n
        where n.tenant_id = s.tenant_id and n.station_id = s.id and n.status = 'ACTIVE')
        as active_nozzles,
      (select count(*) from app.pumps pu
        where pu.tenant_id = s.tenant_id and pu.station_id = s.id and pu.status = 'ACTIVE'
          and not exists (
            select 1 from app.nozzles n
             where n.tenant_id = pu.tenant_id and n.pump_id = pu.id and n.status = 'ACTIVE'
          )) as pumps_without_nozzle,
      (select count(*) from app.shift_templates st
        where st.tenant_id = s.tenant_id and st.station_id = s.id and st.active)
        as active_shift_templates,
      (select count(*) from app.provider_accounts pa
         join app.payment_providers pp on pp.tenant_id = pa.tenant_id and pp.id = pa.provider_id
        where pa.tenant_id = s.tenant_id and pa.status = 'ACTIVE' and pp.status = 'ACTIVE'
          and (pa.station_id = s.id
               or (pa.station_id is null
                   and (pa.legal_entity_id is null or pa.legal_entity_id = s.legal_entity_id))))
        as provider_accounts,
      (select count(*) from app.bank_accounts ba
        where ba.tenant_id = s.tenant_id and ba.legal_entity_id = s.legal_entity_id
          and ba.status = 'ACTIVE') as bank_accounts,
      (select count(distinct m.id)
         from app.membership_role_assignments a
         join app.memberships m on m.tenant_id = a.tenant_id and m.id = a.membership_id
        where a.tenant_id = s.tenant_id and a.scope_type = 'STATION' and a.station_id = s.id
          and (a.expires_at is null or a.expires_at > now())
          and m.status = 'ACTIVE' and m.disabled_at is null
          and m.suspended_at is null and m.locked_at is null) as assigned_staff
    from app.stations s
    where s.tenant_id = current_setting('app.tenant_id')::uuid
      and s.status in ('ACTIVE', 'ONBOARDING')
    order by s.code
  `);
  return rows.map((row) => ({
    stationId: row.station_id,
    stationCode: row.station_code,
    stationName: row.station_name,
    legalEntityId: row.legal_entity_id,
    legalEntityName: row.legal_entity_name,
    stationStatus: row.station_status === 'ONBOARDING' ? 'ONBOARDING' : 'ACTIVE',
    activeProducts: count(row.active_products),
    pricedProducts: count(row.priced_products),
    activeTanks: count(row.active_tanks),
    tanksMissingTolerance: count(row.tanks_missing_tolerance),
    tanksMissingOpeningStock: count(row.tanks_missing_opening_stock),
    tanksMissingOpeningCost: count(row.tanks_missing_opening_cost),
    activePumps: count(row.active_pumps),
    activeNozzles: count(row.active_nozzles),
    pumpsWithoutNozzle: count(row.pumps_without_nozzle),
    activeShiftTemplates: count(row.active_shift_templates),
    providerAccounts: count(row.provider_accounts),
    bankAccounts: count(row.bank_accounts),
    assignedStaff: count(row.assigned_staff),
  }));
}

export async function readPaymentSetup(transaction: SetupTransaction): Promise<{
  providers: PaymentProviderRow[];
  providerAccounts: ProviderAccountRow[];
  bankAccounts: BankAccountRow[];
}> {
  const providers = await transaction.execute<{
    id: string;
    code: string;
    name: string;
    provider_type: PaymentProviderRow['providerType'];
    status: PaymentProviderRow['status'];
  }>(sql`
    select id, code, name, provider_type, status
    from app.payment_providers
    where tenant_id = current_setting('app.tenant_id')::uuid
    order by name, code
  `);
  const accounts = await transaction.execute<{
    id: string;
    provider_id: string;
    provider_name: string;
    station_id: string | null;
    legal_entity_id: string | null;
    account_reference: string;
    display_name: string;
    currency: string;
    status: ProviderAccountRow['status'];
    fee_percent: string | null;
    fee_fixed: string | null;
  }>(sql`
    select pa.id, pa.provider_id, pp.name as provider_name, pa.station_id, pa.legal_entity_id,
           pa.account_reference, pa.display_name, pa.currency, pa.status,
           pa.fee_percent::text as fee_percent, pa.fee_fixed::text as fee_fixed
    from app.provider_accounts pa
    join app.payment_providers pp on pp.tenant_id = pa.tenant_id and pp.id = pa.provider_id
    where pa.tenant_id = current_setting('app.tenant_id')::uuid
    order by pp.name, pa.display_name
  `);
  const banks = await transaction.execute<{
    id: string;
    legal_entity_id: string;
    name: string;
    bank_name: string;
    account_reference_masked: string;
    currency: string;
    status: BankAccountRow['status'];
  }>(sql`
    select id, legal_entity_id, name, bank_name, account_reference_masked, currency, status
    from app.bank_accounts
    where tenant_id = current_setting('app.tenant_id')::uuid
    order by bank_name, name
  `);
  return {
    providers: providers.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      providerType: row.provider_type,
      status: row.status,
    })),
    providerAccounts: accounts.map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      providerName: row.provider_name,
      stationId: row.station_id,
      legalEntityId: row.legal_entity_id,
      accountReference: row.account_reference,
      displayName: row.display_name,
      currency: row.currency,
      status: row.status,
      feePercent: row.fee_percent,
      feeFixed: row.fee_fixed,
    })),
    bankAccounts: banks.map((row) => ({
      id: row.id,
      legalEntityId: row.legal_entity_id,
      name: row.name,
      bankName: row.bank_name,
      accountReferenceMasked: row.account_reference_masked,
      currency: row.currency,
      status: row.status,
    })),
  };
}

/** Pure permission projection, exported for tests. */
export function resolveSetupAccess(authority: TenantExecutionContext, now?: Date) {
  const requestedScope = { tenantId: authority.membership.tenantId, scopeType: 'TENANT' as const };
  const grant = (permissionCode: Parameters<typeof isPermissionGranted>[0]['permissionCode']) =>
    isPermissionGranted({ actor: authority.authorization, permissionCode, requestedScope, now });
  const canManagePayments = grant('provider.manage');
  return {
    canManagePayments,
    canViewReadiness: grant('station.manage') || canManagePayments,
    canViewPayments: canManagePayments || grant('provider.view'),
    canViewAudit: grant('audit.view'),
    canManageAlerts: grant('tenant.manage'),
    canManageStations: grant('station.manage'),
    canManageCompanies: grant('legal_entity.manage'),
  };
}

/**
 * Resolve the setup overview for Settings. Authorization failures yield
 * `unavailable` (the Settings tabs are simply not offered); infrastructure
 * failures are surfaced by the caller as an explicit error state.
 */
export async function resolveSetupOverview(
  request: Request,
  dependencies: SetupDependencies = {},
): Promise<SetupOverview> {
  const url = new URL(request.url);
  const requestedTenantId =
    url.searchParams.get('tenantId') ?? url.searchParams.get('organisationId');
  let tenantId: string;
  let authority: TenantExecutionContext;
  if (requestedTenantId) {
    tenantId = requestedTenantId;
    authority = await (dependencies.resolveAuthority ?? resolveTenantExecutionContext)({
      request,
      requestedTenantId: tenantId,
      now: dependencies.now,
    });
  } else {
    const resolution = await (dependencies.resolveContext ?? resolveCurrentContext)(request);
    if (!resolution.current) return { status: 'unavailable' };
    tenantId = resolution.current.organisationId;
    authority = await (dependencies.resolveAuthority ?? resolveTenantExecutionContext)({
      request,
      requestedTenantId: tenantId,
      now: dependencies.now,
    });
  }
  const access = resolveSetupAccess(authority, dependencies.now);
  if (!access.canViewReadiness && !access.canViewPayments) return { status: 'unavailable' };

  const { facts, payments } = await withTenantTransaction(authority.transaction, async (tx) => ({
    facts: access.canViewReadiness ? await readStationSetupFacts(tx) : [],
    payments: access.canViewPayments
      ? await readPaymentSetup(tx)
      : { providers: [], providerAccounts: [], bankAccounts: [] },
  }));

  const visible = facts.filter((station) =>
    isPermissionGranted({
      actor: authority.authorization,
      permissionCode: 'station.view',
      requestedScope: {
        tenantId,
        scopeType: 'STATION',
        legalEntityId: station.legalEntityId,
        stationId: station.stationId,
      },
      now: dependencies.now,
    }),
  );
  const stationOptions: SetupStationOption[] = visible.map((station) => ({
    id: station.stationId,
    code: station.stationCode,
    name: station.stationName,
    legalEntityId: station.legalEntityId,
    ...(station.legalEntityName ? { legalEntityName: station.legalEntityName } : {}),
  }));
  return {
    status: 'ready',
    tenantId,
    canViewReadiness: access.canViewReadiness,
    canViewPayments: access.canViewPayments,
    canManagePayments: access.canManagePayments,
    stations: visible.map(computeStationReadiness),
    stationOptions,
    ...payments,
  };
}
