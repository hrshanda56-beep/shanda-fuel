import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { authorize, isPermissionGranted } from '../../platform/security/permissions';
import { resolveForecourtCommandContext, type ForecourtCommandContext } from './application';
import { loadForecourtStation } from './persistence';
import type { PriceChangeData } from './price-change-state';

const uuid = z.string().uuid();

export const priceChangeQuery = z.object({ tenantId: uuid, stationId: uuid });

type PriceChangeInput = z.infer<typeof priceChangeQuery>;
type Transaction = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

const PRICE_PERMISSIONS = {
  request: 'price.change.request',
  approve: 'price.change.approve',
  prepare: 'price.change.prepare',
  boundary: 'price.change.boundary',
  activate: 'price.change.activate',
} as const;

/**
 * Everything the "Change a price" screen needs for one station: each fuel with its price in use,
 * any change already under way, the pumps that must be read, and the person and shift the readings
 * are recorded against. Tenant, legal entity and station come from the trusted A1 context.
 */
export async function getPriceChangeFromRequest(
  request: Request,
  input: PriceChangeInput,
): Promise<PriceChangeData> {
  const context = await resolveForecourtCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
    loadStation: loadForecourtStation,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'station.view',
    requestedScope: context.scope,
  });
  const can = (permissionCode: (typeof PRICE_PERMISSIONS)[keyof typeof PRICE_PERMISSIONS]) =>
    isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: context.scope,
    });
  const capabilities = {
    request: can(PRICE_PERMISSIONS.request),
    approve: can(PRICE_PERMISSIONS.approve),
    prepare: can(PRICE_PERMISSIONS.prepare),
    boundary: can(PRICE_PERMISSIONS.boundary),
    activate: can(PRICE_PERMISSIONS.activate),
  };
  if (!Object.values(capabilities).some(Boolean)) {
    throw new AppError('FORBIDDEN', 'Changing prices is not available to this account');
  }
  return withTenantTransaction(context.authority.transaction, (transaction) =>
    loadPriceChange(transaction, context, input, capabilities),
  );
}

async function loadPriceChange(
  transaction: Transaction,
  context: ForecourtCommandContext,
  input: PriceChangeInput,
  capabilities: PriceChangeData['capabilities'],
): Promise<PriceChangeData> {
  const stationRows = await transaction.execute<{ id: string; name: string }>(sql`
    select id, name from app.stations
    where tenant_id = ${context.tenantId} and id = ${input.stationId}
  `);
  const station = stationRows[0];
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');

  const shiftRows = await transaction.execute<{
    id: string;
    businessDayId: string;
    label: string | null;
    version: number | string;
  }>(sql`
    select s.id, s.business_day_id as "businessDayId", t.name as label, s.version
    from app.shifts s
    join app.station_business_days d
      on d.tenant_id = s.tenant_id and d.station_id = s.station_id and d.id = s.business_day_id
    left join app.shift_templates t
      on t.tenant_id = s.tenant_id and t.station_id = s.station_id and t.id = s.shift_template_id
    where s.tenant_id = ${context.tenantId} and s.station_id = ${input.stationId}
      and s.state = 'OPEN' and d.state = 'OPEN'
    order by s.planned_start_at desc, s.id
    limit 1
  `);
  const shift = shiftRows[0];

  const attendants = await transaction.execute<{ id: string; name: string }>(sql`
    select m.id, u.name
    from app.memberships m
    join app.users u on u.id = m.identity_id
    join app.membership_role_assignments a
      on a.tenant_id = m.tenant_id and a.membership_id = m.id
    where m.tenant_id = ${context.tenantId}
      and m.status = 'ACTIVE'
      and a.scope_type = 'STATION'
      and a.station_id = ${input.stationId}
      and a.role_code = 'ATTENDANT'
      and (a.expires_at is null or a.expires_at > now())
    order by u.name, m.id
  `);

  const products = await transaction.execute<{
    id: string;
    name: string;
    currentPrice: string | null;
  }>(sql`
    select p.id, p.name,
           (select sp.unit_price::text from app.selling_prices sp
             where sp.tenant_id = p.tenant_id and sp.station_id = ${input.stationId}
               and sp.product_id = p.id and sp.state = 'ACTIVE'
             order by sp.effective_from desc, sp.id desc limit 1) as "currentPrice"
    from app.products p
    where p.tenant_id = ${context.tenantId}
      and exists (
        select 1 from app.nozzles n
        where n.tenant_id = p.tenant_id and n.station_id = ${input.stationId}
          and n.product_id = p.id and n.status = 'ACTIVE'
      )
    order by p.name, p.id
  `);

  const changes = await transaction.execute<{
    id: string;
    productId: string;
    unitPrice: string;
    state: string;
    version: number | string;
    requestedByMe: boolean;
  }>(sql`
    select distinct on (product_id)
           id, product_id as "productId", unit_price::text as "unitPrice", state, version,
           (requested_by = ${context.authority.membership.membershipId}) as "requestedByMe"
    from app.selling_prices
    where tenant_id = ${context.tenantId} and station_id = ${input.stationId}
      and state in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED',
                    'PENDING_STATION_ACTIVATION', 'BOUNDARIES_IN_PROGRESS')
    order by product_id, effective_from desc, id desc
  `);

  const nozzles = await transaction.execute<{
    nozzleId: string;
    productId: string;
    pumpNumber: string;
    nozzleNumber: string;
    meterInstallationId: string | null;
    lastReading: string | null;
    doneForPriceId: string | null;
  }>(sql`
    select n.id as "nozzleId", n.product_id as "productId", p.number as "pumpNumber",
           n.number as "nozzleNumber", installation.id as "meterInstallationId",
           previous.reading_value::text as "lastReading", done.price_change_id as "doneForPriceId"
    from app.nozzles n
    join app.pumps p
      on p.tenant_id = n.tenant_id and p.station_id = n.station_id and p.id = n.pump_id
    left join lateral (
      select mi.id from app.meter_installations mi
      where mi.tenant_id = n.tenant_id and mi.station_id = n.station_id
        and mi.nozzle_id = n.id and mi.effective_to is null
      order by mi.effective_from desc, mi.id desc
      limit 1
    ) installation on true
    left join lateral (
      select b.reading_value from app.meter_boundaries b
      where b.tenant_id = n.tenant_id and b.station_id = n.station_id
        and b.nozzle_id = n.id and b.reading_status = 'AVAILABLE'
      order by b.effective_at desc, b.id desc
      limit 1
    ) previous on true
    left join lateral (
      select b.price_change_id from app.meter_boundaries b
      where b.tenant_id = n.tenant_id and b.station_id = n.station_id
        and b.nozzle_id = n.id and b.reason = 'PRICE_CHANGE' and b.reading_status = 'AVAILABLE'
        and b.price_change_id in (
          select sp.id from app.selling_prices sp
          where sp.tenant_id = n.tenant_id and sp.station_id = n.station_id
            and sp.product_id = n.product_id
            and sp.state in ('PENDING_STATION_ACTIVATION', 'BOUNDARIES_IN_PROGRESS')
        )
      limit 1
    ) done on true
    where n.tenant_id = ${context.tenantId} and n.station_id = ${input.stationId}
      and n.status = 'ACTIVE'
    order by p.number, n.number, n.id
  `);

  return {
    tenantId: context.tenantId,
    station: { id: station.id, name: station.name },
    capabilities,
    shift: shift
      ? {
          id: shift.id,
          businessDayId: shift.businessDayId,
          label: shift.label,
          version: Number(shift.version),
        }
      : null,
    attendants: attendants.map((row) => ({ id: row.id, name: row.name })),
    products: products.map((product) => {
      const change = changes.find((row) => row.productId === product.id);
      return {
        productId: product.id,
        name: product.name,
        currentPrice: product.currentPrice,
        change: change
          ? {
              priceId: change.id,
              unitPrice: change.unitPrice,
              state: change.state,
              version: Number(change.version),
              requestedByMe: change.requestedByMe,
            }
          : null,
        nozzles: nozzles
          .filter((row) => row.productId === product.id)
          .map((row) => ({
            nozzleId: row.nozzleId,
            label: `Pump ${row.pumpNumber}, nozzle ${row.nozzleNumber}`,
            meterInstallationId: row.meterInstallationId,
            lastReading: row.lastReading,
            done: change !== undefined && row.doneForPriceId === change.id,
          })),
      };
    }),
  };
}
