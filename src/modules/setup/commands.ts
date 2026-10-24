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
  'CreatePump',
  'CreateNozzle',
  'DraftPriceChange',
  'UpdateSupplier',
  'SetResponsibleSupervisor',
  'SetAlertSettings',
] as const;
export type SetupCommandType = (typeof SETUP_COMMAND_TYPES)[number];

export function assertSetupCommandType(value: unknown): SetupCommandType {
  if (!SETUP_COMMAND_TYPES.includes(value as SetupCommandType)) {
    throw new AppError('VALIDATION_FAILED', 'A supported setup commandType is required');
  }
  return value as SetupCommandType;
}

const createProductPayload = authority.extend({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
});
const createPumpPayload = authority.extend({
  number: z.string().trim().min(1).max(16),
  name: z.string().trim().max(80).nullish(),
});
const createNozzlePayload = authority.extend({
  pumpId: uuid,
  number: z.string().trim().min(1).max(16),
  productId: uuid,
  meterSerialNumber: z.string().trim().min(1).max(80),
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
      try {
        await transaction.execute(sql`
          insert into app.products (id, tenant_id, code, name, status)
          values (${productId}, ${context.tenantId}, ${payload.code}, ${payload.name}, 'ACTIVE')
        `);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CONFLICT', 'A product with this code already exists');
        }
        throw error;
      }
      return { productId, code: payload.code, name: payload.name };
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
      const nozzleId = randomUUID();
      const meterId = randomUUID();
      const installationId = randomUUID();
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
        await transaction.execute(sql`
          insert into app.meter_installations
            (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
          values (${installationId}, ${context.tenantId}, ${context.stationId}, ${nozzleId},
            ${meterId}, now(), ${context.authority.membership.membershipId})
        `);
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
      };
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
export async function createPumpFromRequest(request: Request, input: unknown) {
  const payload = createPumpPayload.parse(input);
  return createPumpCommand(await contextFor(request, payload), payload, keyOf(request));
}
export async function createNozzleFromRequest(request: Request, input: unknown) {
  const payload = createNozzlePayload.parse(input);
  return createNozzleCommand(await contextFor(request, payload), payload, keyOf(request));
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
          select membership.id from app.memberships membership
          join app.membership_role_assignments assignment
            on assignment.tenant_id = membership.tenant_id and assignment.membership_id = membership.id
          where membership.tenant_id = ${context.tenantId} and membership.id = ${payload.membershipId}
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
