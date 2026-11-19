import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { fuelDeliveries } from '../../platform/db/schema/a4';
import {
  deliverySettings,
  fuelDeliveryCompartmentSeals,
  fuelDeliveryCompartments,
  fuelDeliveryDriverConfirmations,
  fuelDeliveryWaterTests,
} from '../../platform/db/schema/delivery-detail';
import {
  executeInventoryCommand,
  requestHash,
  resolveInventoryCommandContext,
  type InventoryCommandContext,
} from '../inventory/application';
import { assertProductBelongsToTenant } from '../inventory/persistence';
import {
  checkCompartments,
  checkDriverConfirmation,
  checkWaterTest,
  classifyDeliveryReceipt,
} from './domain';
import { loadDeliveryForUpdate } from './persistence';
import {
  LOSS_LIABLE_PARTIES,
  LOSS_RECOVERY_STATUSES,
  checkLossRecovery,
} from './variance-assessment';
import { setNoPurchaseOrderReasonSchema } from './purchase-order-choice';

const uuid = z.string().uuid();
const litresText = z
  .string()
  .regex(/^\d+(?:\.\d{1,3})?$/, 'The quantity must be a number like 5000 or 5000.5');
const instant = z.string().datetime({ offset: true });
const authorityPayload = z.object({ tenantId: uuid, stationId: uuid, deliveryId: uuid });

const compartmentsPayload = authorityPayload.extend({
  compartments: z
    .array(
      z.object({
        compartmentNumber: z.number().int().min(1).max(30),
        productId: uuid,
        noteLitres: litresText,
        receivedLitres: litresText,
        seals: z
          .array(z.object({ sealNumber: z.string().max(80), intact: z.boolean() }))
          .max(10)
          .default([]),
      }),
    )
    .min(1)
    .max(30),
});

const waterTestPayload = authorityPayload.extend({
  result: z.enum(['PASS', 'FAIL']),
  waterReadingMm: z.string().nullish(),
  notes: z.string().trim().max(500).nullish(),
  testedAt: instant.nullish(),
});

const driverConfirmationPayload = authorityPayload.extend({
  driverName: z.string().max(200),
  confirmed: z.boolean(),
  confirmedAt: instant.nullish(),
  notes: z.string().trim().max(500).nullish(),
});

const lossClaimPayload = authorityPayload.extend({
  liableParty: z.enum(LOSS_LIABLE_PARTIES),
  status: z.enum(LOSS_RECOVERY_STATUSES),
  recoveredAmount: z.string().trim().nullish(),
  currency: z.string().trim().length(3).nullish(),
  note: z.string().trim().max(500).nullish(),
});

const waterTestRequiredPayload = z.object({
  tenantId: uuid,
  stationId: uuid,
  required: z.boolean(),
});

function contextFor(request: Request, payload: { tenantId: string; stationId: string }) {
  return resolveInventoryCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
  });
}

function requireIdempotency(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  return key;
}

function scopeOf(context: InventoryCommandContext, deliveryId: string) {
  return { tenantId: context.tenantId, stationId: context.stationId, deliveryId };
}

/**
 * Replaces the compartment-by-compartment record of a draft delivery. The compartments must add
 * up to the delivery's litres on the note and litres received.
 */
export function recordDeliveryCompartmentsCommand(
  context: InventoryCommandContext,
  payload: z.infer<typeof compartmentsPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'RecordDeliveryCompartments',
    permissionCode: 'inventory.delivery.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_COMPARTMENTS_RECORDED',
      subjectType: 'FuelDelivery',
      subjectId: payload.deliveryId,
    },
    execute: async (transaction) => {
      const delivery = await loadDeliveryForUpdate(
        transaction,
        scopeOf(context, payload.deliveryId),
      );
      if (delivery.status !== 'DRAFT') {
        throw new AppError(
          'CONFLICT',
          'This delivery has already been confirmed or cancelled, so its compartments can no longer be changed.',
        );
      }
      await assertProductBelongsToTenant(transaction, context.tenantId, delivery.productId);
      const checked = checkCompartments({
        deliveryProductId: delivery.productId,
        deliveryNoteLitres: delivery.noteQuantityLitres,
        deliveryReceivedLitres: delivery.actualQuantityLitres,
        compartments: payload.compartments,
      });
      await transaction
        .delete(fuelDeliveryCompartmentSeals)
        .where(
          and(
            eq(fuelDeliveryCompartmentSeals.tenantId, context.tenantId),
            eq(fuelDeliveryCompartmentSeals.deliveryId, delivery.id),
          ),
        );
      await transaction
        .delete(fuelDeliveryCompartments)
        .where(
          and(
            eq(fuelDeliveryCompartments.tenantId, context.tenantId),
            eq(fuelDeliveryCompartments.deliveryId, delivery.id),
          ),
        );
      for (const compartment of checked.compartments) {
        const compartmentId = randomUUID();
        await transaction.insert(fuelDeliveryCompartments).values({
          id: compartmentId,
          tenantId: context.tenantId,
          stationId: context.stationId,
          deliveryId: delivery.id,
          compartmentNumber: compartment.compartmentNumber,
          productId: compartment.productId,
          noteLitres: compartment.noteLitres,
          receivedLitres: compartment.receivedLitres,
        });
        for (const seal of compartment.seals) {
          await transaction.insert(fuelDeliveryCompartmentSeals).values({
            tenantId: context.tenantId,
            stationId: context.stationId,
            deliveryId: delivery.id,
            compartmentId,
            sealNumber: seal.sealNumber,
            intact: seal.intact,
          });
        }
      }
      return {
        deliveryId: delivery.id,
        receipt: classifyDeliveryReceipt(
          delivery.noteQuantityLitres,
          delivery.actualQuantityLitres,
        ),
        compartmentCount: checked.compartments.length,
        shortCompartments: checked.shortCompartments,
        overCompartments: checked.overCompartments,
        brokenSeals: checked.brokenSeals,
        totalNoteLitres: checked.totalNoteLitres,
        totalReceivedLitres: checked.totalReceivedLitres,
      };
    },
  });
}

export async function recordDeliveryCompartmentsFromRequest(request: Request, input: unknown) {
  const payload = compartmentsPayload.parse(input);
  return recordDeliveryCompartmentsCommand(
    await contextFor(request, payload),
    payload,
    requireIdempotency(request),
  );
}

/** Records (or corrects, while the delivery is a draft) the water test of a delivery. */
export function recordDeliveryWaterTestCommand(
  context: InventoryCommandContext,
  payload: z.infer<typeof waterTestPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'RecordDeliveryWaterTest',
    permissionCode: 'inventory.delivery.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_WATER_TEST_RECORDED',
      subjectType: 'FuelDelivery',
      subjectId: payload.deliveryId,
    },
    execute: async (transaction) => {
      const delivery = await loadDeliveryForUpdate(
        transaction,
        scopeOf(context, payload.deliveryId),
      );
      if (delivery.status !== 'DRAFT') {
        throw new AppError(
          'CONFLICT',
          'This delivery has already been confirmed or cancelled, so the water test can no longer be changed.',
        );
      }
      const checked = checkWaterTest({
        result: payload.result,
        waterReadingMm: payload.waterReadingMm ?? null,
      });
      const now = new Date();
      const testedAt = payload.testedAt ? new Date(payload.testedAt) : now;
      if (testedAt.getTime() > now.getTime() + 5 * 60 * 1000) {
        throw new AppError('VALIDATION_FAILED', 'The water test time cannot be in the future');
      }
      const values = {
        result: checked.result,
        waterReadingMm: checked.waterReadingMm,
        notes: payload.notes ?? null,
        testedAt,
        recordedBy: context.authority.membership.membershipId,
        updatedAt: now,
      };
      await transaction
        .insert(fuelDeliveryWaterTests)
        .values({
          tenantId: context.tenantId,
          stationId: context.stationId,
          deliveryId: delivery.id,
          ...values,
        })
        .onConflictDoUpdate({
          target: [fuelDeliveryWaterTests.tenantId, fuelDeliveryWaterTests.deliveryId],
          set: values,
        });
      return {
        deliveryId: delivery.id,
        result: checked.result,
        waterReadingMm: checked.waterReadingMm,
      };
    },
  });
}

export async function recordDeliveryWaterTestFromRequest(request: Request, input: unknown) {
  const payload = waterTestPayload.parse(input);
  return recordDeliveryWaterTestCommand(
    await contextFor(request, payload),
    payload,
    requireIdempotency(request),
  );
}

/**
 * Records what the driver said about the load: their name and whether they confirm it. This is a
 * separate record from the receiving person's own confirmation. No signature is held.
 */
export function recordDeliveryDriverConfirmationCommand(
  context: InventoryCommandContext,
  payload: z.infer<typeof driverConfirmationPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'RecordDeliveryDriverConfirmation',
    permissionCode: 'inventory.delivery.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_DRIVER_CONFIRMED',
      subjectType: 'FuelDelivery',
      subjectId: payload.deliveryId,
    },
    execute: async (transaction) => {
      const delivery = await loadDeliveryForUpdate(
        transaction,
        scopeOf(context, payload.deliveryId),
      );
      if (delivery.status === 'CANCELLED') {
        throw new AppError('CONFLICT', 'This delivery was cancelled, so it cannot be changed.');
      }
      const now = new Date();
      const checked = checkDriverConfirmation({
        driverName: payload.driverName,
        confirmed: payload.confirmed,
        confirmedAt: payload.confirmedAt ?? null,
        now,
      });
      const values = {
        driverName: checked.driverName,
        confirmed: checked.confirmed,
        confirmedAt: checked.confirmedAt,
        notes: payload.notes ?? null,
        recordedBy: context.authority.membership.membershipId,
        updatedAt: now,
      };
      await transaction
        .insert(fuelDeliveryDriverConfirmations)
        .values({
          tenantId: context.tenantId,
          stationId: context.stationId,
          deliveryId: delivery.id,
          ...values,
        })
        .onConflictDoUpdate({
          target: [
            fuelDeliveryDriverConfirmations.tenantId,
            fuelDeliveryDriverConfirmations.deliveryId,
          ],
          set: values,
        });
      return {
        deliveryId: delivery.id,
        driverName: checked.driverName,
        confirmed: checked.confirmed,
        confirmedAt: checked.confirmedAt?.toISOString() ?? null,
      };
    },
  });
}

export async function recordDeliveryDriverConfirmationFromRequest(
  request: Request,
  input: unknown,
) {
  const payload = driverConfirmationPayload.parse(input);
  return recordDeliveryDriverConfirmationCommand(
    await contextFor(request, payload),
    payload,
    requireIdempotency(request),
  );
}

/** Owner switch: when on, ConfirmDelivery needs a water test on record. Default is off. */
export function setWaterTestRequiredCommand(
  context: InventoryCommandContext,
  payload: z.infer<typeof waterTestRequiredPayload>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'SetWaterTestRequired',
    permissionCode: 'tenant.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_WATER_TEST_RULE_SET',
      subjectType: 'DeliverySettings',
      subjectId: context.tenantId,
    },
    execute: async (transaction) => {
      const values = {
        waterTestRequired: payload.required,
        updatedBy: context.authority.membership.membershipId,
        updatedAt: new Date(),
      };
      await transaction
        .insert(deliverySettings)
        .values({ tenantId: context.tenantId, ...values })
        .onConflictDoUpdate({ target: deliverySettings.tenantId, set: values });
      return { waterTestRequired: payload.required };
    },
  });
}

export async function setWaterTestRequiredFromRequest(request: Request, input: unknown) {
  const payload = waterTestRequiredPayload.parse(input);
  return setWaterTestRequiredCommand(
    await contextFor(request, payload),
    payload,
    requireIdempotency(request),
  );
}

/**
 * Records why a delivery that is not confirmed yet has no purchase order. Confirming a delivery
 * needs either a purchase-order link or this reason, so this is how the answer is given after the
 * delivery was saved (including deliveries that go into several tanks, which the edit form cannot
 * change).
 */
export function setDeliveryNoPurchaseOrderReasonCommand(
  context: InventoryCommandContext,
  payload: z.infer<typeof setNoPurchaseOrderReasonSchema>,
  key: string,
) {
  return executeInventoryCommand({
    context,
    commandType: 'SetDeliveryNoPurchaseOrderReason',
    permissionCode: 'inventory.delivery.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_NO_PO_REASON_SET',
      subjectType: 'FuelDelivery',
      subjectId: payload.deliveryId,
    },
    execute: async (transaction) => {
      const delivery = await loadDeliveryForUpdate(
        transaction,
        scopeOf(context, payload.deliveryId),
      );
      if (delivery.status !== 'DRAFT') {
        throw new AppError(
          'CONFLICT',
          'This delivery has already been confirmed or cancelled, so the purchase order answer can no longer be changed.',
        );
      }
      const noPoNote = payload.noPoNote || null;
      await transaction
        .update(fuelDeliveries)
        .set({ noPoReason: payload.noPoReason, noPoNote })
        .where(
          and(
            eq(fuelDeliveries.tenantId, context.tenantId),
            eq(fuelDeliveries.stationId, context.stationId),
            eq(fuelDeliveries.id, delivery.id),
          ),
        );
      return { deliveryId: delivery.id, noPoReason: payload.noPoReason, noPoNote };
    },
  });
}

export async function setDeliveryNoPurchaseOrderReasonFromRequest(
  request: Request,
  input: unknown,
) {
  const payload = setNoPurchaseOrderReasonSchema.parse(input);
  return setDeliveryNoPurchaseOrderReasonCommand(
    await contextFor(request, payload),
    payload,
    requireIdempotency(request),
  );
}

/**
 * Records who is held responsible for a delivery's loss and what came of the claim. The owner
 * decides each case; the system only keeps the answer. It works on a confirmed delivery too,
 * because a claim is followed up after the fuel is already in the tank. Nothing is posted to
 * any ledger.
 */
export function recordDeliveryLossClaimCommand(
  context: InventoryCommandContext,
  payload: z.infer<typeof lossClaimPayload>,
  key: string,
) {
  const amount = payload.recoveredAmount?.trim() || null;
  const problem = checkLossRecovery({
    liableParty: payload.liableParty,
    status: payload.status,
    amount,
  });
  if (problem) throw new AppError('VALIDATION_FAILED', problem);
  const currency = payload.status === 'SETTLED' ? (payload.currency?.toUpperCase() ?? null) : null;
  if (payload.status === 'SETTLED' && !currency) {
    throw new AppError('VALIDATION_FAILED', 'Choose the currency of the amount recovered.');
  }
  return executeInventoryCommand({
    context,
    commandType: 'RecordDeliveryLossClaim',
    permissionCode: 'supplier.delivery.link',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_LOSS_CLAIM_RECORDED',
      subjectType: 'FuelDelivery',
      subjectId: payload.deliveryId,
    },
    execute: async (transaction) => {
      const delivery = await loadDeliveryForUpdate(
        transaction,
        scopeOf(context, payload.deliveryId),
      );
      if (delivery.status === 'CANCELLED') {
        throw new AppError('CONFLICT', 'This delivery was cancelled, so it cannot have a claim.');
      }
      const lost = await transaction.execute<{ short: boolean }>(sql`
        select (actual_quantity_litres < note_quantity_litres or variance_cause is not null) as short
        from app.fuel_deliveries
        where tenant_id = ${context.tenantId} and id = ${delivery.id}
      `);
      if (!lost[0]?.short) {
        throw new AppError(
          'CONFLICT',
          'Fuel received matched the delivery note, so there is no loss to claim for.',
        );
      }
      await transaction.execute(sql`
        insert into app.fuel_delivery_loss_claims
          (tenant_id, station_id, delivery_id, liable_party, status, recovered_amount, currency, note, updated_by)
        values (${context.tenantId}, ${context.stationId}, ${delivery.id}, ${payload.liableParty},
          ${payload.status}, ${amount}, ${currency}, ${payload.note || null}, ${context.authority.membership.membershipId})
        on conflict (tenant_id, delivery_id) do update set
          liable_party = excluded.liable_party, status = excluded.status,
          recovered_amount = excluded.recovered_amount, currency = excluded.currency,
          note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
      `);
      return { deliveryId: delivery.id, liableParty: payload.liableParty, status: payload.status };
    },
  });
}

export async function recordDeliveryLossClaimFromRequest(request: Request, input: unknown) {
  const payload = lossClaimPayload.parse(input);
  return recordDeliveryLossClaimCommand(
    await contextFor(request, payload),
    payload,
    requireIdempotency(request),
  );
}
