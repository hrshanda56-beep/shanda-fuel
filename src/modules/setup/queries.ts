import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { authorize, type PermissionCode } from '../../platform/security/permissions';
import { resolveInventoryCommandContext } from '../inventory/application';
import { computeSetupBlockers } from './blockers';
import type { ConfigurationSetupOverview } from './contracts';

const input = z.object({ tenantId: z.string().uuid(), stationId: z.string().uuid() });

/**
 * Station setup read model for the owner self-service screens. Every section
 * is returned only when the caller holds its read permission (otherwise
 * `null`, never an empty list), so "Not entered" and "not allowed" are never
 * confused. Values are exactly what is stored; nothing is defaulted.
 */
export async function getSetupOverview(args: {
  request: Request;
  tenantId: string;
  stationId: string;
}): Promise<ConfigurationSetupOverview> {
  const parsed = input.parse(args);
  const context = await resolveInventoryCommandContext({
    request: args.request,
    requestedTenantId: parsed.tenantId,
    stationId: parsed.stationId,
  });
  const can = (permissionCode: PermissionCode): boolean => {
    try {
      authorize({
        actor: context.authority.authorization,
        permissionCode,
        requestedScope: context.scope,
      });
      return true;
    } catch (error) {
      if (error instanceof AppError && error.code === 'FORBIDDEN') return false;
      throw error;
    }
  };
  const capabilities = {
    products: can('station.manage'),
    tanks: can('inventory.tank.manage'),
    forecourt: can('station.manage'),
    shiftTemplates: can('shift.template.manage'),
    priceRequest: can('price.change.request'),
    priceApprove: can('price.change.approve'),
    priceActivate: can('price.change.activate'),
    suppliers: can('supplier.manage'),
  };
  const view = {
    stationView: can('station.view'),
    inventory: can('inventory.view'),
    shift: can('shift.view'),
    price: can('price.view'),
    supplier: can('supplier.view'),
  };
  if (!view.stationView && !view.inventory && !view.shift && !view.price && !view.supplier) {
    throw new AppError('FORBIDDEN', 'You do not have access to setup for this station');
  }
  const { tenantId, stationId } = context;

  return withTenantTransaction(context.authority.transaction, async (tx) => {
    const products = view.stationView
      ? await tx.execute<{ id: string; code: string; name: string; status: string }>(sql`
          select id, code, name, status from app.products
          where tenant_id = ${tenantId} order by code`)
      : null;
    const tanks = view.inventory
      ? await tx.execute<{
          id: string;
          code: string;
          product_id: string;
          capacity_litres: string;
          reorder_level_litres: string | null;
          acceptable_variance_litres: string | null;
          status: string;
        }>(sql`
          select id, code, product_id, capacity_litres::text, reorder_level_litres::text,
            acceptable_variance_litres::text, status
          from app.tanks where tenant_id = ${tenantId} and station_id = ${stationId}
          order by code`)
      : null;
    const pumps = view.stationView
      ? await tx.execute<{ id: string; number: string; name: string | null; status: string }>(sql`
          select id, number, name, status from app.pumps
          where tenant_id = ${tenantId} and station_id = ${stationId} order by number`)
      : null;
    const nozzles = view.stationView
      ? await tx.execute<{
          id: string;
          pump_id: string;
          number: string;
          product_id: string;
          status: string;
          meter_serial_number: string | null;
        }>(sql`
          select n.id, n.pump_id, n.number, n.product_id, n.status,
            (select m.serial_number from app.meter_installations i
               join app.meters m on m.tenant_id = i.tenant_id and m.id = i.meter_id
              where i.tenant_id = n.tenant_id and i.station_id = n.station_id
                and i.nozzle_id = n.id and i.effective_to is null
              order by i.effective_from desc limit 1) as meter_serial_number
          from app.nozzles n
          where n.tenant_id = ${tenantId} and n.station_id = ${stationId}
          order by n.number`)
      : null;
    const shiftTemplates = view.shift
      ? await tx.execute<{
          id: string;
          code: string;
          name: string;
          start_time: string | null;
          duration_minutes: number;
          active: boolean;
          version: number;
        }>(sql`
          select id, code, name, start_time::text, duration_minutes, active, version
          from app.shift_templates
          where tenant_id = ${tenantId} and station_id = ${stationId} order by code`)
      : null;
    const prices = view.price
      ? await tx.execute<{
          id: string;
          product_id: string;
          unit_price: string;
          currency: string;
          state: string;
          effective_from: Date | string;
          version: number;
        }>(sql`
          select id, product_id, unit_price::text, currency, state, effective_from, version
          from app.selling_prices
          where tenant_id = ${tenantId} and station_id = ${stationId}
          order by effective_from desc, created_at desc limit 200`)
      : null;
    const suppliers = view.supplier
      ? await tx.execute<{
          id: string;
          code: string;
          legal_name: string;
          registration_reference: string | null;
          status: string;
          version: number;
        }>(sql`
          select id, code, legal_name, registration_reference, status, version
          from app.suppliers where tenant_id = ${tenantId} order by code`)
      : null;
    const supervisors = view.stationView
      ? await tx.execute<{ membership_id: string; name: string }>(sql`
          select membership.id as membership_id,
            coalesce(nullif(identity.name, ''), identity.email) as name
          from app.membership_role_assignments assignment
          join app.memberships membership
            on membership.tenant_id = assignment.tenant_id and membership.id = assignment.membership_id
          join app.users identity on identity.id = membership.identity_id
          where assignment.tenant_id = ${tenantId} and assignment.role_code = 'SUPERVISOR'
            and assignment.scope_type = 'STATION' and assignment.station_id = ${stationId}
            and membership.status = 'ACTIVE'
            and (assignment.expires_at is null or assignment.expires_at > now())
          group by membership.id, identity.name, identity.email
          order by 2`)
      : null;
    const station = await tx.execute<{
      status: string;
      responsible_supervisor_membership_id: string | null;
    }>(sql`
      select status, responsible_supervisor_membership_id from app.stations
      where tenant_id = ${tenantId} and id = ${stationId}`);

    const overview: Omit<ConfigurationSetupOverview, 'blockers'> = {
      tenantId,
      stationId,
      stationStatus: station[0]?.status ?? 'UNKNOWN',
      capabilities,
      products:
        products?.map((r) => ({ id: r.id, code: r.code, name: r.name, status: r.status })) ?? null,
      tanks:
        tanks?.map((r) => ({
          id: r.id,
          code: r.code,
          productId: r.product_id,
          capacityLitres: r.capacity_litres,
          reorderLevelLitres: r.reorder_level_litres,
          acceptableVarianceLitres: r.acceptable_variance_litres,
          status: r.status,
        })) ?? null,
      pumps:
        pumps?.map((r) => ({ id: r.id, number: r.number, name: r.name, status: r.status })) ?? null,
      nozzles:
        nozzles?.map((r) => ({
          id: r.id,
          pumpId: r.pump_id,
          number: r.number,
          productId: r.product_id,
          status: r.status,
          meterSerialNumber: r.meter_serial_number,
        })) ?? null,
      shiftTemplates:
        shiftTemplates?.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          startTime: r.start_time ? r.start_time.slice(0, 5) : null,
          durationMinutes: Number(r.duration_minutes),
          active: r.active,
          version: Number(r.version),
        })) ?? null,
      prices:
        prices?.map((r) => ({
          id: r.id,
          productId: r.product_id,
          unitPrice: r.unit_price,
          currency: r.currency,
          state: r.state,
          effectiveFrom:
            r.effective_from instanceof Date
              ? r.effective_from.toISOString()
              : new Date(r.effective_from).toISOString(),
          version: Number(r.version),
        })) ?? null,
      suppliers:
        suppliers?.map((r) => ({
          id: r.id,
          code: r.code,
          legalName: r.legal_name,
          registrationReference: r.registration_reference,
          status: r.status,
          version: Number(r.version),
        })) ?? null,
      supervisors:
        supervisors?.map((r) => ({ membershipId: r.membership_id, name: r.name })) ?? null,
      responsibleSupervisorMembershipId: station[0]?.responsible_supervisor_membership_id ?? null,
    };
    return { ...overview, blockers: computeSetupBlockers(overview) };
  });
}
