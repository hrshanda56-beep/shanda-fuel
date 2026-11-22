import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { ownerMayApproveOwn } from '../../platform/security/separation-of-duties';
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
  LOSS_SETTLEMENT_METHODS,
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
  expectedAmount: z.string().trim().nullish(),
  recoveredAmount: z.string().trim().nullish(),
  settlementMethod: z.enum(LOSS_SETTLEMENT_METHODS).nullish(),
  currency: z.string().trim().length(3).nullish(),
  note: z.string().trim().max(500).nullish(),
});

const lossClaimReviewPayload = authorityPayload.extend({
  decision: z.enum(['APPROVED', 'REJECTED']),
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
 * Records who is held responsible for a delivery's loss, the amount expected back and what came of
 * the claim. The owner decides each case; the system only keeps the answer. It works on a confirmed
 * delivery too, because a claim is followed up after the fuel is already in the tank. Every change
 * waits for an administrator or owner to approve it (a different person from the one recording),
 * and an approved settlement or write-off is final. Nothing is posted to any ledger (DEC-055).
 */
export function recordDeliveryLossClaimCommand(
  context: InventoryCommandContext,
  payload: z.infer<typeof lossClaimPayload>,
  key: string,
) {
  const expected = payload.expectedAmount?.trim() || null;
  const recovered = payload.recoveredAmount?.trim() || null;
  const method = payload.settlementMethod ?? null;
  const typedCurrency = payload.currency?.toUpperCase() ?? null;
  const problem = checkLossRecovery({
    liableParty: payload.liableParty,
    status: payload.status,
    expectedAmount: expected,
    recoveredAmount: recovered,
    settlementMethod: method,
    currency: typedCurrency,
  });
  if (problem) throw new AppError('VALIDATION_FAILED', problem);
  return executeInventoryCommand({
    context,
    commandType: 'RecordDeliveryLossClaim',
    permissionCode: 'delivery.loss.record',
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
      const existing = (
        await transaction.execute<{
          status: string;
          approval_status: string;
          expected_amount: string | null;
          currency: string | null;
        }>(sql`
          select status, approval_status, expected_amount::text as expected_amount, currency
          from app.fuel_delivery_loss_claims
          where tenant_id = ${context.tenantId} and delivery_id = ${delivery.id}
          for update
        `)
      )[0];
      if (
        existing &&
        existing.approval_status === 'APPROVED' &&
        (existing.status === 'SETTLED' || existing.status === 'WRITTEN_OFF')
      ) {
        throw new AppError(
          'CONFLICT',
          'This claim was settled and approved, so it is closed and cannot be changed.',
        );
      }
      const none = payload.status === 'NONE';
      const expectedAmount = none ? null : (expected ?? existing?.expected_amount ?? null);
      const recoveredAmount = payload.status === 'SETTLED' ? recovered : null;
      const settlementMethod = payload.status === 'SETTLED' ? method : null;
      const currency =
        expectedAmount || recoveredAmount ? (typedCurrency ?? existing?.currency ?? null) : null;
      if ((expectedAmount || recoveredAmount) && !currency) {
        throw new AppError('VALIDATION_FAILED', 'Choose the currency of the amount.');
      }
      await transaction.execute(sql`
        insert into app.fuel_delivery_loss_claims
          (tenant_id, station_id, delivery_id, liable_party, status, expected_amount, recovered_amount,
           settlement_method, currency, note, approval_status, approved_by, approved_at, approval_note, updated_by)
        values (${context.tenantId}, ${context.stationId}, ${delivery.id}, ${payload.liableParty},
          ${payload.status}, ${expectedAmount}, ${recoveredAmount}, ${settlementMethod}, ${currency},
          ${payload.note || null}, ${none ? 'NOT_NEEDED' : 'PENDING'}, null, null, null,
          ${context.authority.membership.membershipId})
        on conflict (tenant_id, delivery_id) do update set
          liable_party = excluded.liable_party, status = excluded.status,
          expected_amount = excluded.expected_amount, recovered_amount = excluded.recovered_amount,
          settlement_method = excluded.settlement_method, currency = excluded.currency,
          note = excluded.note, approval_status = excluded.approval_status,
          approved_by = null, approved_at = null, approval_note = null,
          updated_by = excluded.updated_by, updated_at = now()
      `);
      return {
        deliveryId: delivery.id,
        liableParty: payload.liableParty,
        status: payload.status,
        approvalStatus: none ? 'NOT_NEEDED' : 'PENDING',
      };
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

/**
 * An administrator or owner approves or sends back a claim (or its settlement). The person who
 * recorded the last change cannot approve it, so a second person always looks at it.
 */
export function reviewDeliveryLossClaimCommand(
  context: InventoryCommandContext,
  payload: z.infer<typeof lossClaimReviewPayload>,
  key: string,
) {
  const note = payload.note?.trim() || null;
  if (payload.decision === 'REJECTED' && !note) {
    throw new AppError('VALIDATION_FAILED', 'Say why the claim is being sent back.');
  }
  return executeInventoryCommand({
    context,
    commandType: 'ReviewDeliveryLossClaim',
    permissionCode: 'delivery.loss.approve',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode:
        payload.decision === 'APPROVED'
          ? 'INVENTORY.DELIVERY_LOSS_CLAIM_APPROVED'
          : 'INVENTORY.DELIVERY_LOSS_CLAIM_SENT_BACK',
      subjectType: 'FuelDelivery',
      subjectId: payload.deliveryId,
    },
    execute: async (transaction) => {
      const claim = (
        await transaction.execute<{
          id: string;
          approval_status: string;
          updated_by: string;
          status: string;
          settlement_method: string | null;
          recovered_amount: string | null;
          currency: string | null;
        }>(sql`
          select id, approval_status, updated_by, status, settlement_method,
                 recovered_amount::text as recovered_amount, currency
          from app.fuel_delivery_loss_claims
          where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
            and delivery_id = ${payload.deliveryId}
          for update
        `)
      )[0];
      if (!claim) throw new AppError('NOT_FOUND', 'No claim was recorded for this delivery.');
      if (claim.approval_status !== 'PENDING') {
        throw new AppError('CONFLICT', 'This claim is not waiting for approval.');
      }
      const me = context.authority.membership.membershipId;
      if (
        claim.updated_by === me &&
        !(await ownerMayApproveOwn(transaction, {
          tenantId: context.tenantId,
          stationId: context.stationId,
          membershipId: me,
        }))
      ) {
        throw new AppError(
          'FORBIDDEN',
          'You recorded this claim, so someone else must approve it.',
        );
      }
      await transaction.execute(sql`
        update app.fuel_delivery_loss_claims
        set approval_status = ${payload.decision}, approved_by = ${me}, approved_at = now(),
            approval_note = ${note}
        where tenant_id = ${context.tenantId} and delivery_id = ${payload.deliveryId}
      `);
      let posted: 'SUPPLIER_ACCOUNT' | null = null;
      if (payload.decision === 'APPROVED' && claim.status === 'SETTLED') {
        posted = await postLossRecoveryToSupplierAccount(transaction, context, {
          claim,
          deliveryId: payload.deliveryId,
          actorMembershipId: me,
        });
      }
      return { deliveryId: payload.deliveryId, approvalStatus: payload.decision, posted };
    },
  });
}

/**
 * DEC-055: a loss paid back by taking it off a bill, or off what is owed to the supplier, lowers
 * what we owe that company, so it goes onto their account as a credit (USD only for now). Cash paid
 * back is not posted here, and a write-off to expense is still waiting for Finance.
 */
async function postLossRecoveryToSupplierAccount(
  transaction: Parameters<Parameters<typeof executeInventoryCommand>[0]['execute']>[0],
  context: InventoryCommandContext,
  input: {
    claim: {
      id: string;
      settlement_method: string | null;
      recovered_amount: string | null;
      currency: string | null;
    };
    deliveryId: string;
    actorMembershipId: string;
  },
): Promise<'SUPPLIER_ACCOUNT' | null> {
  const { claim } = input;
  if (
    claim.settlement_method !== 'TRANSPORT_BILL' &&
    claim.settlement_method !== 'SUPPLIER_BALANCE'
  ) {
    return null;
  }
  if (claim.currency !== 'USD') {
    throw new AppError(
      'VALIDATION_FAILED',
      'Only US dollar claims can be taken off an account for now. Settle this one another way.',
    );
  }
  const delivery = (
    await transaction.execute<{
      supplier_id: string | null;
      transporter_supplier_id: string | null;
      business_date: string;
    }>(sql`
      select d.supplier_id, d.transporter_supplier_id,
             to_char(now() at time zone s.timezone, 'YYYY-MM-DD') as business_date
      from app.fuel_deliveries d
      join app.stations s on s.tenant_id = d.tenant_id and s.id = d.station_id
      where d.tenant_id = ${context.tenantId} and d.station_id = ${context.stationId}
        and d.id = ${input.deliveryId}
    `)
  )[0];
  const supplierId =
    claim.settlement_method === 'TRANSPORT_BILL'
      ? delivery?.transporter_supplier_id
      : delivery?.supplier_id;
  if (!delivery || !supplierId || !claim.recovered_amount) {
    throw new AppError(
      'VALIDATION_FAILED',
      claim.settlement_method === 'TRANSPORT_BILL'
        ? 'This delivery has no transport company, so there is no transport bill to take it off.'
        : 'This delivery has no supplier to take it off.',
    );
  }
  await transaction.execute(sql`
    insert into app.supplier_account_movements (
      id, tenant_id, legal_entity_id, supplier_id, movement_type, amount, currency,
      source_type, source_id, effective_date, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${supplierId},
      'CREDIT_NOTE', ${claim.recovered_amount}, 'USD', 'DELIVERY_LOSS_CLAIM', ${claim.id},
      ${delivery.business_date}, ${input.actorMembershipId}
    )
  `);
  return 'SUPPLIER_ACCOUNT';
}

export async function reviewDeliveryLossClaimFromRequest(request: Request, input: unknown) {
  const payload = lossClaimReviewPayload.parse(input);
  return reviewDeliveryLossClaimCommand(
    await contextFor(request, payload),
    payload,
    requireIdempotency(request),
  );
}
