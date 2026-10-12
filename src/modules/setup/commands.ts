import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { unitPrice } from '../../platform/domain/primitives';
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
  'ActivateInitialPrice',
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
      try {
        await transaction.execute(sql`
          insert into app.selling_prices
            (id, tenant_id, station_id, product_id, effective_from, unit_price, currency,
             state, requested_by, version)
          values (${priceId}, ${context.tenantId}, ${context.stationId}, ${payload.productId},
            ${payload.effectiveFrom}::timestamptz, ${price.toString()},
            ${payload.currency.toUpperCase()}, 'DRAFT',
            ${context.authority.membership.membershipId}, 0)
        `);
      } catch (error) {
        // selling_prices_effective_no_overlap: one non-cancelled price per product
        // and period. Surface it plainly instead of as a server error.
        const code = (error as { code?: string })?.code;
        const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
        if (code === '23P01' || causeCode === '23P01') {
          throw new AppError(
            'CONFLICT',
            'This product already has a price, or a price change in progress, covering that period. Changing a price that is in use needs meter readings and is not available here yet.',
          );
        }
        throw error;
      }
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

const activateInitialPricePayload = authority.extend({
  priceId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

/**
 * Activates the FIRST approved price of a product at a station. The normal
 * ActivatePriceChange needs a sealed PRICE_CHANGE meter boundary per nozzle,
 * which exists to split already-metered sales between the old and new price.
 * When the product has never been sold at this station (no meter boundary on
 * any of its nozzles, no earlier price) there is nothing to split, so the
 * transition chain APPROVED -> PENDING_STATION_ACTIVATION ->
 * BOUNDARIES_IN_PROGRESS -> ACTIVE is completed in one transaction. Any
 * later price change must use the boundary flow. See ADR-018.
 */
export function activateInitialPriceCommand(
  context: InventoryCommandContext,
  payload: Payload<typeof activateInitialPricePayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'Setup.ActivateInitialPrice',
    permissionCode: 'price.change.activate',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.INITIAL_PRICE_ACTIVATED',
      subjectType: 'SellingPrice',
      subjectId: payload.priceId,
    },
    execute: async (transaction) => {
      const rows = await transaction.execute<{
        product_id: string;
        state: string;
        version: number;
      }>(sql`
        select product_id, state, version from app.selling_prices
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and id = ${payload.priceId}
        for update
      `);
      const price = rows[0];
      if (!price) throw new AppError('NOT_FOUND', 'Selling price was not found');
      if (Number(price.version) !== payload.expectedVersion) {
        throw new AppError('CONFLICT', 'The price was changed by someone else. Reload it.');
      }
      if (price.state !== 'APPROVED') {
        throw new AppError('CONFLICT', `An initial price must be APPROVED, not ${price.state}`);
      }
      const history = await transaction.execute<{ n: number }>(sql`
        select (
          (select count(*) from app.selling_prices
            where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
              and product_id = ${price.product_id} and state in ('ACTIVE')) +
          (select count(*) from app.meter_boundaries b
            join app.nozzles n on n.tenant_id = b.tenant_id and n.station_id = b.station_id
              and n.id = b.nozzle_id
            where b.tenant_id = ${context.tenantId} and b.station_id = ${context.stationId}
              and n.product_id = ${price.product_id})
        )::int as n
      `);
      if (Number(history[0]?.n ?? 0) > 0) {
        throw new AppError(
          'CONFLICT',
          'This product already has a price or meter history. Use the normal price change with meter readings.',
        );
      }
      for (const [from, to] of [
        ['APPROVED', 'PENDING_STATION_ACTIVATION'],
        ['PENDING_STATION_ACTIVATION', 'BOUNDARIES_IN_PROGRESS'],
        ['BOUNDARIES_IN_PROGRESS', 'ACTIVE'],
      ] as const) {
        await transaction.execute(sql`
          update app.selling_prices
          set state = ${to}, version = version + 1,
            activated_at = case when ${to} = 'ACTIVE' then now() else activated_at end
          where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
            and id = ${payload.priceId} and state = ${from}
        `);
      }
      return {
        priceId: payload.priceId,
        state: 'ACTIVE' as const,
        version: payload.expectedVersion + 3,
      };
    },
  });
}

export async function activateInitialPriceFromRequest(request: Request, input: unknown) {
  const payload = activateInitialPricePayload.parse(input);
  return activateInitialPriceCommand(await contextFor(request, payload), payload, keyOf(request));
}
