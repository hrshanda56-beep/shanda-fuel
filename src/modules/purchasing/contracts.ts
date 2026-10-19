import { z } from 'zod';
import type { PermissionCode } from '../../platform/security/permissions';

export const PURCHASING_PERMISSION_CODES = [
  'purchase_order.view',
  'purchase_order.create',
  'purchase_order.approve',
  'purchase_order.cancel',
] as const satisfies readonly PermissionCode[];

const uuid = z.string().uuid();
/** Exact decimal strings only: JSON numbers are rejected so no value passes through a float. */
const litres = z
  .string()
  .min(1)
  .max(24)
  .regex(/^\d+(?:\.\d{1,3})?$/, 'An exact litres string with at most 3 decimals is required');
const price = z
  .string()
  .min(1)
  .max(30)
  .regex(/^\d+(?:\.\d{1,8})?$/, 'An exact price string with at most 8 decimals is required');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A YYYY-MM-DD date is required');
const version = z.number().int().nonnegative();
const reason = z.string().trim().min(1).max(500);
const stationBase = z.object({ tenantId: uuid, stationId: uuid });

const newLine = z.object({
  productId: uuid,
  orderedLitres: litres,
  agreedUnitPrice: price.nullable().optional(),
});

/** An existing line keeps its identity (and product); a line without lineId is added. */
const amendLine = newLine.extend({ lineId: uuid.optional() });

export const createPurchaseOrderSchema = stationBase.extend({
  commandType: z.literal('CreatePurchaseOrder'),
  supplierId: uuid,
  /** Generated when omitted. */
  orderNumber: z.string().trim().min(1).max(60).optional(),
  orderDate: date,
  expectedDeliveryDate: date.optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(newLine).min(1).max(50),
});

export const submitPurchaseOrderSchema = stationBase.extend({
  commandType: z.literal('SubmitPurchaseOrder'),
  purchaseOrderId: uuid,
  expectedVersion: version,
});

export const approvePurchaseOrderSchema = stationBase.extend({
  commandType: z.literal('ApprovePurchaseOrder'),
  purchaseOrderId: uuid,
  expectedVersion: version,
});

export const amendPurchaseOrderSchema = stationBase.extend({
  commandType: z.literal('AmendPurchaseOrder'),
  purchaseOrderId: uuid,
  expectedVersion: version,
  reason,
  orderDate: date.optional(),
  /** Omit to keep, null to clear. */
  expectedDeliveryDate: date.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  /** The complete new line set. Existing lines left out are removed (never when linked). */
  lines: z.array(amendLine).min(1).max(50),
});

export const cancelPurchaseOrderSchema = stationBase.extend({
  commandType: z.literal('CancelPurchaseOrder'),
  purchaseOrderId: uuid,
  expectedVersion: version,
  reason,
});

export const closePurchaseOrderSchema = stationBase.extend({
  commandType: z.literal('ClosePurchaseOrder'),
  purchaseOrderId: uuid,
  expectedVersion: version,
  reason,
});

export const linkDeliveryToPurchaseOrderSchema = stationBase.extend({
  commandType: z.literal('LinkDeliveryToPurchaseOrder'),
  purchaseOrderId: uuid,
  purchaseOrderLineId: uuid,
  deliveryId: uuid,
});

export const unlinkDeliveryFromPurchaseOrderSchema = stationBase.extend({
  commandType: z.literal('UnlinkDeliveryFromPurchaseOrder'),
  purchaseOrderId: uuid,
  deliveryId: uuid,
  reason,
});

export const PURCHASING_COMMAND_SCHEMAS = {
  CreatePurchaseOrder: createPurchaseOrderSchema,
  SubmitPurchaseOrder: submitPurchaseOrderSchema,
  ApprovePurchaseOrder: approvePurchaseOrderSchema,
  AmendPurchaseOrder: amendPurchaseOrderSchema,
  CancelPurchaseOrder: cancelPurchaseOrderSchema,
  ClosePurchaseOrder: closePurchaseOrderSchema,
  LinkDeliveryToPurchaseOrder: linkDeliveryToPurchaseOrderSchema,
  UnlinkDeliveryFromPurchaseOrder: unlinkDeliveryFromPurchaseOrderSchema,
} as const;

export type PurchasingCommandType = keyof typeof PURCHASING_COMMAND_SCHEMAS;
export const PURCHASING_COMMAND_TYPES = Object.keys(
  PURCHASING_COMMAND_SCHEMAS,
) as PurchasingCommandType[];

export type PurchasingCommandPolicy = Readonly<{
  permissionCode: PermissionCode;
  requiresExpectedVersion: boolean;
  auditActionCode: string;
}>;

/**
 * No purchase-order command requires step-up: an order has no accounting effect (no ledger,
 * inventory, cash, or bank write), so even cancelling an approved order carries no financial
 * risk. Approval separation of duties is enforced inside ApprovePurchaseOrder.
 */
export const PURCHASING_COMMAND_POLICY: Readonly<
  Record<PurchasingCommandType, PurchasingCommandPolicy>
> = {
  CreatePurchaseOrder: {
    permissionCode: 'purchase_order.create',
    requiresExpectedVersion: false,
    auditActionCode: 'PURCHASE_ORDER.CREATED',
  },
  SubmitPurchaseOrder: {
    permissionCode: 'purchase_order.create',
    requiresExpectedVersion: true,
    auditActionCode: 'PURCHASE_ORDER.SUBMITTED',
  },
  ApprovePurchaseOrder: {
    permissionCode: 'purchase_order.approve',
    requiresExpectedVersion: true,
    auditActionCode: 'PURCHASE_ORDER.APPROVED',
  },
  AmendPurchaseOrder: {
    permissionCode: 'purchase_order.create',
    requiresExpectedVersion: true,
    auditActionCode: 'PURCHASE_ORDER.AMENDED',
  },
  CancelPurchaseOrder: {
    permissionCode: 'purchase_order.cancel',
    requiresExpectedVersion: true,
    auditActionCode: 'PURCHASE_ORDER.CANCELLED',
  },
  ClosePurchaseOrder: {
    permissionCode: 'purchase_order.cancel',
    requiresExpectedVersion: true,
    auditActionCode: 'PURCHASE_ORDER.CLOSED',
  },
  LinkDeliveryToPurchaseOrder: {
    permissionCode: 'purchase_order.create',
    requiresExpectedVersion: false,
    auditActionCode: 'PURCHASE_ORDER.DELIVERY_LINKED',
  },
  UnlinkDeliveryFromPurchaseOrder: {
    permissionCode: 'purchase_order.create',
    requiresExpectedVersion: false,
    auditActionCode: 'PURCHASE_ORDER.DELIVERY_UNLINKED',
  },
};

export type PurchasingCommandInput<T extends PurchasingCommandType> = z.infer<
  (typeof PURCHASING_COMMAND_SCHEMAS)[T]
>;
