import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { unitPrice } from '../../platform/domain/primitives';
import { authorize } from '../../platform/security/permissions';
import {
  executeInventoryCommand,
  requestHash,
  resolveInventoryCommandContext,
  type InventoryCommandContext,
} from '../inventory/application';
import { assertProductBelongsToTenant } from '../inventory/persistence';
import { checkMeterWorkingSinceDate } from './meter-working-since';
import { createProductPayload, setProductKindPayload } from './product-contract';

/**
 * Milestone A owner self-service setup commands. These are the only setup
 * commands that had no existing named command: product, pump, nozzle (with its
 * meter) and the creation of a DRAFT selling price. Tanks, shift templates and
 * the price approval flow keep using their existing commands.
 *
 * They run through the shared inventory command executor so they inherit
 * tenant-context RLS, the idempotency ledger, permission checks and the signed
 * append-only audit event. Idempotency keys are namespaced `Inventory.Setup.*`.
 */

const uuid = z.string().uuid();
const authority = z.object({ tenantId: uuid, stationId: uuid });

export const SETUP_COMMAND_TYPES = [
  'CreateProduct',
  'RenameProduct',
  'SetProductUnit',
  'SetProductStatus',
  'DeleteProduct',
  'SetProductKind',
  'CreatePump',
  'CreateNozzle',
  'CreateCashLocation',
  'UpdatePump',
  'UpdateNozzle',
  'SetMeterWorkingSince',
  'DraftPriceChange',
  'UpdateSupplier',
  'SetResponsibleSupervisor',
  'SetAlertSettings',
  'RecordBankBalance',
] as const;
export type SetupCommandType = (typeof SETUP_COMMAND_TYPES)[number];

export function assertSetupCommandType(value: unknown): SetupCommandType {
  if (!SETUP_COMMAND_TYPES.includes(value as SetupCommandType)) {
    throw new AppError('VALIDATION_FAILED', 'A supported setup commandType is required');
  }
  return value as SetupCommandType;
}

const productRef = authority.extend({ productId: uuid });
const renameProductPayload = productRef.extend({ name: z.string().trim().min(1).max(120) });
const setProductUnitPayload = productRef.extend({ unit: z.enum(['LITRES', 'KILOGRAMS']) });
const setProductStatusPayload = productRef.extend({ status: z.enum(['ACTIVE', 'INACTIVE']) });
const createCashLocationPayload = authority.extend({
  name: z.string().trim().min(1).max(80),
  locationType: z.enum(['STATION_TILL', 'STATION_SAFE']),
});
const createPumpPayload = authority.extend({
  number: z.string().trim().min(1).max(16),
  name: z.string().trim().max(80).nullish(),
});
const stationDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const createNozzlePayload = authority.extend({
  pumpId: uuid,
  number: z.string().trim().min(1).max(16),
  productId: uuid,
  meterSerialNumber: z.string().trim().min(1).max(80),
  /** The station date the meter was fitted. Omit when it is being fitted now. */
  meterWorkingSinceDate: stationDate.optional(),
});
const setMeterWorkingSincePayload = authority.extend({
  nozzleId: uuid,
  /** The station date the meter was fitted. It starts at the beginning of that day, station time. */
  meterWorkingSinceDate: stationDate,
});
const updatePumpPayload = authority.extend({
  pumpId: uuid,
  number: z.string().trim().min(1).max(16),
  name: z.string().trim().max(80).nullish(),
});
const updateNozzlePayload = authority.extend({
  nozzleId: uuid,
  number: z.string().trim().min(1).max(16),
});
const draftPricePayload = authority.extend({
  productId: uuid,
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,6})?$/, 'A decimal price is required'),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'A 3-letter currency code is required'),
  effectiveFrom: z.string().datetime({ offset: true }),
});

const updateSupplierPayload = authority
  .extend({
    supplierId: uuid,
    expectedVersion: z.number().int().nonnegative(),
    legalName: z.string().trim().min(1).max(240).optional(),
    registrationReference: z.string().trim().max(120).nullish(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine(
    (v) =>
      v.legalName !== undefined || v.registrationReference !== undefined || v.status !== undefined,
    { message: 'At least one supplier field must change' },
  );

const setResponsibleSupervisorPayload = authority.extend({
  /** `null` clears the assignment. */
  membershipId: uuid.nullable(),
});

const setAlertSettingsPayload = authority.extend({
  /** Omit when no settings have been saved yet; required to change saved ones. */
  expectedVersion: z.number().int().nonnegative().optional(),
  dueSoonDays: z.number().int().min(1).max(60),
  posSettlementLagDays: z.number().int().min(0).max(30),
  reportGraceDays: z.number().int().min(0).max(14),
  cashShortageMinimum: z.string().regex(/^\d+(?:\.\d{1,4})?$/),
});

const recordBankBalancePayload = authority.extend({
  bankAccountId: uuid,
  /** The balance on the bank statement, as of the date given. */
  balance: z
    .string()
    .trim()
    .regex(/^-?\d+(?:\.\d{1,4})?$/, 'A balance such as 1250.50 is required'),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
});

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === '23505' || causeCode === '23505';
}

function keyOf(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  return key;
}

function contextFor(request: Request, payload: { tenantId: string; stationId: string }) {
  return resolveInventoryCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
  });
}

type Payload<T extends z.ZodType> = z.infer<T>;

/**
 * Turns a station date into the start of that day in the station's own timezone, after checking it
 * is a sensible "meter working since" date (real, not in the future, not more than a year back).
 * Returns the instant as text for use as a timestamptz.
 */
async function resolveMeterWorkingSince(
  transaction: Parameters<Parameters<typeof executeInventoryCommand>[0]['execute']>[0],
  context: InventoryCommandContext,
  date: string,
): Promise<string> {
  const rows = await transaction.execute<{ starts_at: string; today: string }>(sql`
    select ((${date}::date)::timestamp at time zone s.timezone)::text as starts_at,
      (now() at time zone s.timezone)::date::text as today
    from app.stations s
    where s.tenant_id = ${context.tenantId} and s.id = ${context.stationId}
  `);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'The station was not found');
  const problem = checkMeterWorkingSinceDate(date, row.today);
  if (problem) throw new AppError('VALIDATION_FAILED', problem);
  return row.starts_at;
}

export function createProductCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof createProductPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.CreateProduct',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.PRODUCT_CREATED',
      subjectType: 'Product',
      subjectId: (result) => (result as { productId: string }).productId,
    },
    execute: async (transaction) => {
      const productId = randomUUID();
      const blendPercent = payload.kind === 'BLEND' ? (payload.blendPercent ?? null) : null;
      try {
        await transaction.execute(sql`
          insert into app.products (id, tenant_id, code, name, unit, status, kind, blend_percent)
          values (${productId}, ${context.tenantId}, ${payload.code}, ${payload.name}, ${payload.unit},
                  'ACTIVE', ${payload.kind ?? null}, ${blendPercent})
        `);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CONFLICT', 'A product with this code already exists');
        }
        throw error;
      }
      return {
        productId,
        code: payload.code,
        name: payload.name,
        kind: payload.kind ?? null,
        blendPercent,
        unit: payload.unit,
      };
    },
  });
}

export function setProductKindCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof setProductKindPayload>,
  key: string,
) {
  const blendPercent = payload.kind === 'BLEND' ? (payload.blendPercent ?? null) : null;
  return executeInventoryCommand({
    context,
    commandType: 'Setup.SetProductKind',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.PRODUCT_KIND_SET',
      subjectType: 'Product',
      subjectId: payload.productId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{
          kind: string | null;
          blend_percent: number | null;
        }>(sql`
          select kind, blend_percent from app.products
          where tenant_id = ${context.tenantId} and id = ${payload.productId}
        `);
        const row = rows[0];
        return row ? { kind: row.kind, blendPercent: row.blend_percent } : null;
      },
    },
    execute: async (transaction) => {
      // Only the kind and blend percentage change: never the name or code.
      const updated = await transaction.execute<{ id: string }>(sql`
        update app.products
        set kind = ${payload.kind}, blend_percent = ${blendPercent}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${payload.productId}
        returning id
      `);
      if (updated.length === 0) throw new AppError('NOT_FOUND', 'The fuel type was not found');
      return { productId: payload.productId, kind: payload.kind, blendPercent };
    },
  });
}

function isForeignKeyViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === '23503' || causeCode === '23503';
}

/**
 * Changes how a fuel is measured. Quantities already recorded would silently change meaning
 * (500 litres would become 500 kilograms), so this is allowed only while the fuel has no deliveries,
 * meter readings, stock movements, tank dips, opening balances, purchase orders, supplier bills,
 * cost records, customer fuel balances or selling prices.
 */
export function setProductUnitCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof setProductUnitPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.SetProductUnit',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.PRODUCT_UNIT_CHANGED',
      subjectType: 'Product',
      subjectId: payload.productId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{ unit: string }>(sql`
          select unit from app.products
          where tenant_id = ${context.tenantId} and id = ${payload.productId}
        `);
        return rows[0] ? { unit: rows[0].unit } : undefined;
      },
    },
    execute: async (transaction) => {
      // Lock the fuel first: a delivery or meter reading being saved at the same moment needs a share
      // lock on this row, so it waits for this change and then sees the new unit.
      await transaction.execute(sql`
        select id from app.products
        where tenant_id = ${context.tenantId} and id = ${payload.productId}
        for update
      `);
      const used = await transaction.execute<{ used: boolean }>(sql`
        select (
          exists (select 1 from app.fuel_deliveries where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.meter_segments where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.inventory_movements where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.reconciliation_meter_readings where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.opening_balance_lines where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.purchase_order_lines where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.supplier_document_lines where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.inventory_cost_events where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.customer_fuel_authorizations where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.customer_ledger_entries where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.sale_recognition_movements where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (select 1 from app.selling_prices where tenant_id = ${context.tenantId} and product_id = ${payload.productId})
          or exists (
            select 1 from app.tank_dips d join app.tanks t on t.id = d.tank_id and t.tenant_id = d.tenant_id
            where d.tenant_id = ${context.tenantId} and t.product_id = ${payload.productId}
          )
        ) as used
      `);
      const current = await transaction.execute<{ unit: string }>(sql`
        select unit from app.products
        where tenant_id = ${context.tenantId} and id = ${payload.productId}
      `);
      if (!current[0]) throw new AppError('NOT_FOUND', 'The fuel was not found');
      if (current[0].unit === payload.unit)
        return { productId: payload.productId, unit: payload.unit };
      if (used[0]?.used) {
        throw new AppError(
          'CONFLICT',
          'This fuel already has deliveries or sales recorded in its current unit, so the unit can no longer be changed.',
        );
      }
      await transaction.execute(sql`
        update app.products set unit = ${payload.unit}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${payload.productId}
      `);
      return { productId: payload.productId, unit: payload.unit };
    },
  });
}

/** Fuels are shared by every station of the company, so a rename shows everywhere. */
export function renameProductCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof renameProductPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.RenameProduct',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.PRODUCT_RENAMED',
      subjectType: 'Product',
      subjectId: payload.productId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{ name: string }>(sql`
          select name from app.products
          where tenant_id = ${context.tenantId} and id = ${payload.productId}
        `);
        return rows[0] ? { name: rows[0].name } : undefined;
      },
    },
    execute: async (transaction) => {
      const updated = await transaction.execute<{ id: string }>(sql`
        update app.products set name = ${payload.name}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${payload.productId}
        returning id
      `);
      if (updated.length !== 1) throw new AppError('NOT_FOUND', 'The fuel was not found');
      return { productId: payload.productId, name: payload.name };
    },
  });
}

/**
 * Hides a fuel from setup and new entries (INACTIVE) or brings it back. A fuel that still has an
 * active tank or nozzle cannot be hidden, so nothing that is in use disappears from under a shift.
 */
export function setProductStatusCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof setProductStatusPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.SetProductStatus',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.PRODUCT_STATUS_CHANGED',
      subjectType: 'Product',
      subjectId: payload.productId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{ status: string }>(sql`
          select status from app.products
          where tenant_id = ${context.tenantId} and id = ${payload.productId}
        `);
        return rows[0] ? { status: rows[0].status } : undefined;
      },
    },
    execute: async (transaction) => {
      if (payload.status === 'INACTIVE') {
        const inUse = await transaction.execute<{ id: string }>(sql`
          select id from app.tanks
          where tenant_id = ${context.tenantId} and product_id = ${payload.productId}
            and status = 'ACTIVE'
          union all
          select id from app.nozzles
          where tenant_id = ${context.tenantId} and product_id = ${payload.productId}
            and status = 'ACTIVE'
          limit 1
        `);
        if (inUse.length > 0) {
          throw new AppError(
            'CONFLICT',
            'This fuel still has tanks or nozzles in use. Retire those first.',
          );
        }
      }
      const updated = await transaction.execute<{ id: string }>(sql`
        update app.products set status = ${payload.status}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${payload.productId}
        returning id
      `);
      if (updated.length !== 1) throw new AppError('NOT_FOUND', 'The fuel was not found');
      return { productId: payload.productId, status: payload.status };
    },
  });
}

/**
 * Removes a fuel that was never used. Anything that refers to it (a tank, a nozzle, a price, a
 * delivery, a sale) blocks the removal, because those records must keep their fuel.
 */
export function deleteProductCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof productRef>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.DeleteProduct',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.PRODUCT_DELETED',
      subjectType: 'Product',
      subjectId: payload.productId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{ code: string; name: string }>(sql`
          select code, name from app.products
          where tenant_id = ${context.tenantId} and id = ${payload.productId}
        `);
        return rows[0] ? { code: rows[0].code, name: rows[0].name } : undefined;
      },
    },
    execute: async (transaction) => {
      let deleted: { id: string }[];
      try {
        deleted = await transaction.execute<{ id: string }>(sql`
          delete from app.products
          where tenant_id = ${context.tenantId} and id = ${payload.productId}
          returning id
        `);
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new AppError(
            'CONFLICT',
            'This fuel is already in use, so it cannot be deleted. Hide it instead.',
          );
        }
        throw error;
      }
      if (deleted.length !== 1) throw new AppError('NOT_FOUND', 'The fuel was not found');
      return { productId: payload.productId };
    },
  });
}

export function createCashLocationCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof createCashLocationPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.CreateCashLocation',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.CASH_LOCATION_CREATED',
      subjectType: 'CashLocation',
      subjectId: (result) => (result as { locationId: string }).locationId,
    },
    execute: async (transaction) => {
      const locationId = randomUUID();
      const base =
        payload.name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 24) || 'CASH';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = attempt === 0 ? base : `${base}-${attempt + 1}`;
        const existing = await transaction.execute<{ id: string }>(sql`
          select id from app.cash_locations
          where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and code = ${code}
        `);
        if (existing[0]) continue;
        await transaction.execute(sql`
          insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type, currency, status, version)
          values (${locationId}, ${context.tenantId}, ${context.stationId}, ${code}, ${payload.name},
                  ${payload.locationType}, 'USD', 'ACTIVE', 0)
        `);
        return { locationId, code, name: payload.name };
      }
      throw new AppError('CONFLICT', 'A cash place with this name already exists');
    },
  });
}

export function createPumpCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof createPumpPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.CreatePump',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.PUMP_CREATED',
      subjectType: 'Pump',
      subjectId: (result) => (result as { pumpId: string }).pumpId,
    },
    execute: async (transaction) => {
      const pumpId = randomUUID();
      try {
        await transaction.execute(sql`
          insert into app.pumps (id, tenant_id, station_id, number, name, status)
          values (${pumpId}, ${context.tenantId}, ${context.stationId},
            ${payload.number}, ${payload.name ?? null}, 'ACTIVE')
        `);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CONFLICT', 'A pump with this number already exists at the station');
        }
        throw error;
      }
      return { pumpId, number: payload.number };
    },
  });
}

/**
 * A nozzle is only useful with a meter, so this creates the nozzle, the meter
 * (identified by its serial number) and the first installation atomically. No
 * opening reading is invented: readings are captured at the first shift
 * boundary by the existing meter commands.
 */
export function createNozzleCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof createNozzlePayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.CreateNozzle',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.NOZZLE_CREATED',
      subjectType: 'Nozzle',
      subjectId: (result) => (result as { nozzleId: string }).nozzleId,
    },
    execute: async (transaction) => {
      await assertProductBelongsToTenant(transaction, context.tenantId, payload.productId);
      const pumps = await transaction.execute<{ id: string }>(sql`
        select id from app.pumps
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and id = ${payload.pumpId} and status = 'ACTIVE'
        for update
      `);
      if (pumps.length !== 1) {
        throw new AppError('NOT_FOUND', 'The pump was not found at this station');
      }
      // The date the person gave for when the meter started working, if any. Without one, a nozzle
      // added while a shift is open is counted from the start of that shift (below).
      const statedSince = payload.meterWorkingSinceDate
        ? await resolveMeterWorkingSince(transaction, context, payload.meterWorkingSinceDate)
        : null;
      const nozzleId = randomUUID();
      const meterId = randomUUID();
      const installationId = randomUUID();
      let recordedAt = '';
      let countedFrom = '';
      let wasBackdated = false;
      try {
        await transaction.execute(sql`
          insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
          values (${nozzleId}, ${context.tenantId}, ${context.stationId}, ${payload.pumpId},
            ${payload.number}, ${payload.productId}, 'ACTIVE')
        `);
        await transaction.execute(sql`
          insert into app.meters (id, tenant_id, serial_number, status)
          values (${meterId}, ${context.tenantId}, ${payload.meterSerialNumber}, 'ACTIVE')
        `);
        // A nozzle added while a shift is open is counted from the start of the earliest open
        // shift, so that shift can still be closed with a reading for it, unless the person said
        // when the meter started working. created_at keeps the true time; effective_from holds the
        // counted-from time; the reason says why it was backdated.
        const openShifts = await transaction.execute<{ opened_at: Date | string }>(sql`
          select opened_at from app.shifts
          where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
            and state = 'OPEN' and opened_at is not null
          order by opened_at asc limit 1
        `);
        const backdatedTo =
          statedSince === null && openShifts[0]?.opened_at
            ? new Date(openShifts[0].opened_at).toISOString()
            : null;
        const reason = backdatedTo
          ? `Added while a shift was open; counted from the start of that shift (${backdatedTo}).`
          : null;
        const inserted = await transaction.execute<{
          effective_from: Date | string;
          created_at: Date | string;
        }>(sql`
          insert into app.meter_installations
            (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by, replacement_reason)
          values (${installationId}, ${context.tenantId}, ${context.stationId}, ${nozzleId},
            ${meterId}, coalesce(${statedSince}::timestamptz, ${backdatedTo}::timestamptz, now()),
            ${context.authority.membership.membershipId}, ${reason})
          returning effective_from, created_at
        `);
        recordedAt = new Date(inserted[0]!.created_at).toISOString();
        countedFrom = new Date(inserted[0]!.effective_from).toISOString();
        wasBackdated = backdatedTo !== null;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError(
            'CONFLICT',
            'This nozzle number or meter serial number is already in use',
          );
        }
        throw error;
      }
      return {
        nozzleId,
        meterId,
        installationId,
        pumpId: payload.pumpId,
        number: payload.number,
        meterWorkingSince: countedFrom,
        recordedAt,
        countedFrom,
        wasBackdated,
      };
    },
  });
}

/**
 * Sets when a nozzle's meter was really fitted ("Meter working since"), so a nozzle added after a
 * shift opened can still be closed into that shift. It only moves the start EARLIER, and only
 * while nothing has been recorded against the meter: it must be the nozzle's one and only meter,
 * with no readings, sealed pump totals or meter problems linked to it. Once any exist the date is
 * part of the sales record and can no longer be changed here.
 */
export function setMeterWorkingSinceCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof setMeterWorkingSincePayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.SetMeterWorkingSince',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.METER_WORKING_SINCE_SET',
      subjectType: 'Nozzle',
      subjectId: payload.nozzleId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{ effective_from: string }>(sql`
          select effective_from::text from app.meter_installations
          where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
            and nozzle_id = ${payload.nozzleId}
          order by effective_from limit 1
        `);
        return { meterWorkingSince: rows[0]?.effective_from ?? null };
      },
    },
    execute: async (transaction) => {
      const nozzles = await transaction.execute<{ id: string }>(sql`
        select id from app.nozzles
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and id = ${payload.nozzleId}
        for update
      `);
      if (nozzles.length !== 1) {
        throw new AppError('NOT_FOUND', 'The nozzle was not found at this station');
      }
      const installations = await transaction.execute<{
        id: string;
        effective_from: string;
        effective_to: string | null;
      }>(sql`
        select id, effective_from::text, effective_to::text from app.meter_installations
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and nozzle_id = ${payload.nozzleId}
        for update
      `);
      const only = installations[0];
      if (installations.length !== 1 || !only || only.effective_to !== null) {
        throw new AppError(
          'CONFLICT',
          'This nozzle has had its meter changed, so the date it started working can no longer be edited',
        );
      }
      const used = await transaction.execute<{ n: number }>(sql`
        select (
          (select count(*) from app.meter_boundaries
             where tenant_id = ${context.tenantId} and meter_installation_id = ${only.id}) +
          (select count(*) from app.meter_segments
             where tenant_id = ${context.tenantId} and meter_installation_id = ${only.id}) +
          (select count(*) from app.meter_exceptions
             where tenant_id = ${context.tenantId} and meter_installation_id = ${only.id})
        )::int as n
      `);
      if (Number(used[0]?.n ?? 0) > 0) {
        throw new AppError(
          'CONFLICT',
          'Readings have already been recorded for this meter, so the date it started working can no longer be edited',
        );
      }
      const startsAt = await resolveMeterWorkingSince(
        transaction,
        context,
        payload.meterWorkingSinceDate,
      );
      const earlier = await transaction.execute<{ ok: boolean }>(sql`
        select ${startsAt}::timestamptz <= ${only.effective_from}::timestamptz as ok
      `);
      if (!earlier[0]?.ok) {
        throw new AppError(
          'VALIDATION_FAILED',
          'The date can only be moved earlier than the one already set',
        );
      }
      await transaction.execute(sql`
        update app.meter_installations
        set effective_from = ${startsAt}::timestamptz
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and id = ${only.id} and effective_to is null
      `);
      return {
        nozzleId: payload.nozzleId,
        installationId: only.id,
        meterWorkingSince: startsAt,
      };
    },
  });
}

/**
 * Renames a pump (its number and optional name). The pump's nozzles, meters and past readings are
 * untouched; they follow the pump by id.
 */
export function updatePumpCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof updatePumpPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.UpdatePump',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.PUMP_UPDATED',
      subjectType: 'Pump',
      subjectId: payload.pumpId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{ number: string; name: string | null }>(sql`
          select number, name from app.pumps
          where tenant_id = ${context.tenantId} and id = ${payload.pumpId}
        `);
        return rows[0] ? { number: rows[0].number, name: rows[0].name } : undefined;
      },
    },
    execute: async (transaction) => {
      let updated: { id: string }[];
      try {
        updated = await transaction.execute<{ id: string }>(sql`
          update app.pumps set number = ${payload.number}, name = ${payload.name ?? null}
          where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
            and id = ${payload.pumpId} and status = 'ACTIVE'
          returning id
        `);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CONFLICT', 'A pump with this number already exists at the station');
        }
        throw error;
      }
      if (updated.length !== 1) {
        throw new AppError('NOT_FOUND', 'The pump was not found at this station');
      }
      return { pumpId: payload.pumpId, number: payload.number };
    },
  });
}

/**
 * Renumbers a nozzle. The fuel it sells and its meter are not editable here: sales and readings
 * are recorded against them, so a different fuel or meter is a new nozzle (or a meter
 * replacement through the existing meter commands).
 */
export function updateNozzleCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof updateNozzlePayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.UpdateNozzle',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.NOZZLE_UPDATED',
      subjectType: 'Nozzle',
      subjectId: payload.nozzleId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{ number: string }>(sql`
          select number from app.nozzles
          where tenant_id = ${context.tenantId} and id = ${payload.nozzleId}
        `);
        return rows[0] ? { number: rows[0].number } : undefined;
      },
    },
    execute: async (transaction) => {
      let updated: { id: string }[];
      try {
        updated = await transaction.execute<{ id: string }>(sql`
          update app.nozzles set number = ${payload.number}
          where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
            and id = ${payload.nozzleId} and status = 'ACTIVE'
          returning id
        `);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CONFLICT', 'This pump already has a nozzle with this number');
        }
        throw error;
      }
      if (updated.length !== 1) {
        throw new AppError('NOT_FOUND', 'The nozzle was not found at this station');
      }
      return { nozzleId: payload.nozzleId, number: payload.number };
    },
  });
}

/**
 * Creates the DRAFT selling price that the existing RequestPriceChange ->
 * ApprovePriceChange -> PreparePriceActivation -> ActivatePriceChange flow then
 * moves forward. It never makes a price effective by itself.
 */
export function draftPriceChangeCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof draftPricePayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.DraftPriceChange',
    permissionCode: 'price.change.request',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.PRICE_DRAFTED',
      subjectType: 'SellingPrice',
      subjectId: (result) => (result as { priceId: string }).priceId,
    },
    execute: async (transaction) => {
      await assertProductBelongsToTenant(transaction, context.tenantId, payload.productId);
      const price = unitPrice(payload.unitPrice);
      if (!price.value.gt(0)) {
        throw new AppError('VALIDATION_FAILED', 'The selling price must be greater than zero');
      }
      const priceId = randomUUID();
      await transaction.execute(sql`
        insert into app.selling_prices
          (id, tenant_id, station_id, product_id, effective_from, unit_price, currency,
           state, requested_by, version)
        values (${priceId}, ${context.tenantId}, ${context.stationId}, ${payload.productId},
          ${payload.effectiveFrom}::timestamptz, ${price.toString()},
          ${payload.currency.toUpperCase()}, 'DRAFT',
          ${context.authority.membership.membershipId}, 0)
      `);
      return {
        priceId,
        productId: payload.productId,
        unitPrice: price.toString(),
        currency: payload.currency.toUpperCase(),
        state: 'DRAFT' as const,
        version: 0,
      };
    },
  });
}

export async function createProductFromRequest(request: Request, input: unknown) {
  const payload = createProductPayload.parse(input);
  return createProductCommand(await contextFor(request, payload), payload, keyOf(request));
}
export async function setProductUnitFromRequest(request: Request, input: unknown) {
  const payload = setProductUnitPayload.parse(input);
  return setProductUnitCommand(await contextFor(request, payload), payload, keyOf(request));
}
export async function renameProductFromRequest(request: Request, input: unknown) {
  const payload = renameProductPayload.parse(input);
  return renameProductCommand(await contextFor(request, payload), payload, keyOf(request));
}

export async function setProductStatusFromRequest(request: Request, input: unknown) {
  const payload = setProductStatusPayload.parse(input);
  return setProductStatusCommand(await contextFor(request, payload), payload, keyOf(request));
}

export async function deleteProductFromRequest(request: Request, input: unknown) {
  const payload = productRef.parse(input);
  return deleteProductCommand(await contextFor(request, payload), payload, keyOf(request));
}

export async function createCashLocationFromRequest(request: Request, input: unknown) {
  const payload = createCashLocationPayload.parse(input);
  return createCashLocationCommand(await contextFor(request, payload), payload, keyOf(request));
}

export async function setProductKindFromRequest(request: Request, input: unknown) {
  const payload = setProductKindPayload.parse(input);
  return setProductKindCommand(await contextFor(request, payload), payload, keyOf(request));
}
export async function createPumpFromRequest(request: Request, input: unknown) {
  const payload = createPumpPayload.parse(input);
  return createPumpCommand(await contextFor(request, payload), payload, keyOf(request));
}
export async function createNozzleFromRequest(request: Request, input: unknown) {
  const payload = createNozzlePayload.parse(input);
  return createNozzleCommand(await contextFor(request, payload), payload, keyOf(request));
}
export async function updatePumpFromRequest(request: Request, input: unknown) {
  const payload = updatePumpPayload.parse(input);
  return updatePumpCommand(await contextFor(request, payload), payload, keyOf(request));
}

export async function updateNozzleFromRequest(request: Request, input: unknown) {
  const payload = updateNozzlePayload.parse(input);
  return updateNozzleCommand(await contextFor(request, payload), payload, keyOf(request));
}

export async function setMeterWorkingSinceFromRequest(request: Request, input: unknown) {
  const payload = setMeterWorkingSincePayload.parse(input);
  return setMeterWorkingSinceCommand(await contextFor(request, payload), payload, keyOf(request));
}
export async function draftPriceChangeFromRequest(request: Request, input: unknown) {
  const payload = draftPricePayload.parse(input);
  return draftPriceChangeCommand(await contextFor(request, payload), payload, keyOf(request));
}

/**
 * Edit a supplier's name/registration reference or (de)activate it. Supplier
 * history is never deleted: deactivation only stops the supplier being offered
 * for new work. Optimistic `expectedVersion` prevents lost updates.
 */
export function updateSupplierCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof updateSupplierPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.UpdateSupplier',
    permissionCode: 'supplier.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: payload.status !== undefined ? 'SUPPLIER.STATUS_CHANGED' : 'SUPPLIER.UPDATED',
      subjectType: 'Supplier',
      subjectId: payload.supplierId,
    },
    execute: async (transaction) => {
      const rows = await transaction.execute<{
        legal_name: string;
        registration_reference: string | null;
        status: string;
        version: number;
      }>(sql`
        select legal_name, registration_reference, status, version from app.suppliers
        where tenant_id = ${context.tenantId} and id = ${payload.supplierId}
        for update
      `);
      const current = rows[0];
      if (!current) throw new AppError('NOT_FOUND', 'The supplier was not found');
      if (Number(current.version) !== payload.expectedVersion) {
        throw new AppError('CONFLICT', 'The supplier was changed by someone else. Reload it.');
      }
      const legalName = payload.legalName ?? current.legal_name;
      const registrationReference =
        payload.registrationReference === undefined
          ? current.registration_reference
          : payload.registrationReference?.trim() || null;
      const status = payload.status ?? current.status;
      await transaction.execute(sql`
        update app.suppliers
        set legal_name = ${legalName}, registration_reference = ${registrationReference},
          status = ${status}, version = version + 1, updated_at = now(),
          updated_by = ${context.authority.membership.membershipId}
        where tenant_id = ${context.tenantId} and id = ${payload.supplierId}
          and version = ${payload.expectedVersion}
      `);
      return {
        supplierId: payload.supplierId,
        legalName,
        registrationReference,
        status,
        version: payload.expectedVersion + 1,
      };
    },
  });
}

export async function updateSupplierFromRequest(request: Request, input: unknown) {
  const payload = updateSupplierPayload.parse(input);
  return updateSupplierCommand(await contextFor(request, payload), payload, keyOf(request));
}

/**
 * Names the supervisor responsible for a station. Only an active member who holds
 * the Supervisor role at this very station can be chosen, so the assignment can
 * never grant access; it records accountability for sign-off and cash handover.
 */
export function setResponsibleSupervisorCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof setResponsibleSupervisorPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.SetResponsibleSupervisor',
    permissionCode: 'station.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.RESPONSIBLE_SUPERVISOR_SET',
      subjectType: 'Station',
      subjectId: () => context.stationId,
    },
    execute: async (transaction) => {
      if (payload.membershipId) {
        const eligible = await transaction.execute<{ id: string }>(sql`
          select membership.id from app.member_directory(${context.tenantId}::uuid) membership
          join app.membership_role_assignments assignment
            on assignment.tenant_id = ${context.tenantId} and assignment.membership_id = membership.id
          where membership.id = ${payload.membershipId}::uuid
            and membership.status = 'ACTIVE'
            and assignment.role_code = 'SUPERVISOR' and assignment.scope_type = 'STATION'
            and assignment.station_id = ${context.stationId}
            and (assignment.expires_at is null or assignment.expires_at > now())
          limit 1
        `);
        if (!eligible[0]) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Choose an active supervisor who works at this station',
          );
        }
      }
      await transaction.execute(sql`
        update app.stations
        set responsible_supervisor_membership_id = ${payload.membershipId}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${context.stationId}
      `);
      return { stationId: context.stationId, membershipId: payload.membershipId };
    },
  });
}

export async function setResponsibleSupervisorFromRequest(request: Request, input: unknown) {
  const payload = setResponsibleSupervisorPayload.parse(input);
  return setResponsibleSupervisorCommand(
    await contextFor(request, payload),
    payload,
    keyOf(request),
  );
}

/**
 * Saves when reminders start (supplier invoices due soon, late card payments, late daily reports,
 * the smallest cash shortage worth flagging). They are organisation-wide, so the person needs to
 * manage the organisation, not only the station they happen to have selected.
 */
export function setAlertSettingsCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof setAlertSettingsPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.SetAlertSettings',
    permissionCode: 'tenant.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.ALERT_SETTINGS_SET',
      subjectType: 'AlertSettings',
      subjectId: () => context.tenantId,
    },
    execute: async (transaction) => {
      authorize({
        actor: context.authority.authorization,
        permissionCode: 'tenant.manage',
        requestedScope: { tenantId: context.tenantId, scopeType: 'TENANT' },
      });
      const membershipId = context.authority.membership.membershipId;
      const existing = await transaction.execute<{ version: number | string }>(sql`
        select version from app.alert_settings where tenant_id = ${context.tenantId} for update
      `);
      if (!existing[0]) {
        if (payload.expectedVersion !== undefined && payload.expectedVersion !== 0) {
          throw new AppError('CONFLICT', 'The settings changed. Refresh and try again.');
        }
        await transaction.execute(sql`
          insert into app.alert_settings (
            tenant_id, due_soon_days, pos_settlement_lag_days, report_grace_days,
            cash_shortage_minimum, version, updated_by
          ) values (
            ${context.tenantId}, ${payload.dueSoonDays}, ${payload.posSettlementLagDays},
            ${payload.reportGraceDays}, ${payload.cashShortageMinimum}, 0, ${membershipId}
          )
        `);
        return { version: 0 };
      }
      if (
        payload.expectedVersion === undefined ||
        payload.expectedVersion !== Number(existing[0].version)
      ) {
        throw new AppError(
          'CONFLICT',
          'Someone else changed these settings. Refresh and try again.',
        );
      }
      const updated = await transaction.execute<{ version: number | string }>(sql`
        update app.alert_settings
        set due_soon_days = ${payload.dueSoonDays},
            pos_settlement_lag_days = ${payload.posSettlementLagDays},
            report_grace_days = ${payload.reportGraceDays},
            cash_shortage_minimum = ${payload.cashShortageMinimum},
            version = version + 1,
            updated_by = ${membershipId},
            updated_at = now()
        where tenant_id = ${context.tenantId}
        returning version
      `);
      return { version: Number(updated[0]!.version) };
    },
  });
}

export async function setAlertSettingsFromRequest(request: Request, input: unknown) {
  const payload = setAlertSettingsPayload.parse(input);
  return setAlertSettingsCommand(await contextFor(request, payload), payload, keyOf(request));
}

/**
 * Types in the balance the bank statement shows for one account. It never changes the deposits
 * recorded in the app: the financial position uses the typed balance for the bank and falls back to
 * recorded deposits only for accounts that have none. Lines are never edited; a correction is a
 * newer line.
 */
export function recordBankBalanceCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof recordBankBalancePayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.RecordBankBalance',
    permissionCode: 'cash.deposit.confirm',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.BANK_BALANCE_RECORDED',
      subjectType: 'BankAccount',
      subjectId: () => payload.bankAccountId,
    },
    execute: async (transaction) => {
      const [account] = await transaction.execute<{ id: string }>(sql`
        select id from app.bank_accounts
        where tenant_id = ${context.tenantId} and id = ${payload.bankAccountId} and status = 'ACTIVE'
      `);
      if (!account) throw new AppError('NOT_FOUND', 'That bank account was not found');
      const [latest] = await transaction.execute<{ as_of_date: string }>(sql`
        select as_of_date::text as as_of_date from app.bank_balance_statements
        where tenant_id = ${context.tenantId} and bank_account_id = ${payload.bankAccountId}
        order by as_of_date desc, entered_at desc limit 1
      `);
      if (latest && payload.asOfDate < latest.as_of_date) {
        throw new AppError(
          'CONFLICT',
          `A balance for ${latest.as_of_date} is already entered. Enter one for that date or later.`,
        );
      }
      const [row] = await transaction.execute<{ id: string }>(sql`
        insert into app.bank_balance_statements
          (tenant_id, bank_account_id, as_of_date, balance, note, entered_by)
        values (${context.tenantId}, ${payload.bankAccountId}, ${payload.asOfDate},
          ${payload.balance}, ${payload.note ?? null}, ${context.authority.membership.membershipId})
        returning id
      `);
      return { id: row!.id };
    },
  });
}

export async function recordBankBalanceFromRequest(request: Request, input: unknown) {
  const payload = recordBankBalancePayload.parse(input);
  return recordBankBalanceCommand(await contextFor(request, payload), payload, keyOf(request));
}
