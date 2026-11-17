import { z } from 'zod';
import { formatLitres } from '../../design-system/formatters';

/**
 * The one question every delivery must answer before it can be confirmed: is there a purchase
 * order for it? Either the delivery is linked to an open order, or one of these reasons says why
 * there is none. This file holds the shared words and rules so the record form, the "one step
 * left" panel and the delivery page all ask it the same way. It has no server or React code.
 */

/** The reasons a delivery can have no purchase order, in the words station staff see. */
export const NO_PO_REASONS = [
  { value: 'EMERGENCY_PURCHASE', label: 'Emergency purchase' },
  { value: 'CASH_PURCHASE', label: 'Bought for cash' },
  { value: 'SUPPLIER_DIRECT', label: 'The supplier delivered without an order' },
  { value: 'PO_NOT_RAISED', label: 'The order was not raised in time' },
  { value: 'OTHER', label: 'Another reason' },
] as const;

export type NoPoReason = (typeof NO_PO_REASONS)[number]['value'];

const REASON_CODES = NO_PO_REASONS.map((item) => item.value) as [NoPoReason, ...NoPoReason[]];

/** The longest note the record keeps for "Another reason". */
export const NO_PO_NOTE_MAX = 300;

export function noPoReasonLabel(reason: string): string {
  return NO_PO_REASONS.find((item) => item.value === reason)?.label ?? 'Recorded without an order';
}

/** The choice for a delivery that is already linked to an order, so there is nothing to ask. */
export const LINKED_CHOICE = 'LINKED';

const LINK_PREFIX = 'PO:';

/** The select value for linking to one line of one order. */
export function linkChoiceValue(purchaseOrderId: string, purchaseOrderLineId: string): string {
  return `${LINK_PREFIX}${purchaseOrderId}:${purchaseOrderLineId}`;
}

export type PurchaseOrderChoice =
  | { kind: 'NONE' }
  | { kind: 'LINKED' }
  | { kind: 'LINK'; purchaseOrderId: string; purchaseOrderLineId: string }
  | { kind: 'REASON'; reason: NoPoReason };

/** Reads what the select holds: nothing yet, an order link, or a reason. */
export function parsePurchaseOrderChoice(value: string): PurchaseOrderChoice {
  if (value === LINKED_CHOICE) return { kind: 'LINKED' };
  if (value.startsWith(LINK_PREFIX)) {
    const [purchaseOrderId, purchaseOrderLineId, ...extra] = value
      .slice(LINK_PREFIX.length)
      .split(':');
    if (purchaseOrderId && purchaseOrderLineId && extra.length === 0) {
      return { kind: 'LINK', purchaseOrderId, purchaseOrderLineId };
    }
    return { kind: 'NONE' };
  }
  const reason = NO_PO_REASONS.find((item) => item.value === value);
  return reason ? { kind: 'REASON', reason: reason.value } : { kind: 'NONE' };
}

/** What is missing from the answer, in plain words, or null when it can be saved. */
export function purchaseOrderChoiceProblem(value: string, note: string): string | null {
  const choice = parsePurchaseOrderChoice(value);
  if (choice.kind === 'NONE') {
    return 'Say whether there is a purchase order for this delivery. Pick an order, or say why there is none.';
  }
  if (choice.kind === 'REASON' && choice.reason === 'OTHER') {
    if (note.trim() === '') return 'Say in a few words why there is no purchase order.';
    if (note.trim().length > NO_PO_NOTE_MAX) {
      return `Keep the reason to ${NO_PO_NOTE_MAX} characters or fewer.`;
    }
  }
  return null;
}

/** The parts of an order the picker needs, as the purchasing list returns them. */
export type LinkableOrder = Readonly<{
  purchaseOrderId: string;
  orderNumber: string;
  state: string;
  supplierId: string;
  lines: readonly Readonly<{
    lineId: string;
    lineNumber: number;
    productId: string;
    productName: string;
    status: string;
    openLitres: string;
  }>[];
}>;

/**
 * The orders a delivery can be linked to: approved, from the same supplier, with an active line
 * for the same fuel. Purchasing refuses anything else, so it is never offered.
 */
export function linkableOrderOptions(
  orders: readonly LinkableOrder[],
  delivery: { supplierId: string; productId: string },
): { value: string; label: string }[] {
  if (!delivery.supplierId || !delivery.productId) return [];
  const options: { value: string; label: string }[] = [];
  for (const order of orders) {
    if (order.state !== 'APPROVED' || order.supplierId !== delivery.supplierId) continue;
    for (const line of order.lines) {
      if (line.status !== 'ACTIVE' || line.productId !== delivery.productId) continue;
      options.push({
        value: linkChoiceValue(order.purchaseOrderId, line.lineId),
        label: `Order ${order.orderNumber} · ${line.productName} · ${formatLitres(line.openLitres)} still open`,
      });
    }
  }
  return options;
}

export type PurchaseOrderStep = {
  url: string;
  body: Record<string, unknown> & { commandType: string };
};

/**
 * The one request that saves the answer for a delivery that exists, or null when there is nothing
 * to save (already linked, or not answered). A reason goes through the delivery command, a link
 * through purchasing's own link command, so permissions and audit stay where they already are.
 */
export function buildPurchaseOrderStep(
  value: string,
  note: string,
  ids: { tenantId: string; stationId: string; deliveryId: string },
): PurchaseOrderStep | null {
  const choice = parsePurchaseOrderChoice(value);
  if (choice.kind === 'REASON') {
    return {
      url: '/api/deliveries/commands',
      body: {
        commandType: 'SetDeliveryNoPurchaseOrderReason',
        ...ids,
        noPoReason: choice.reason,
        noPoNote: choice.reason === 'OTHER' ? note.trim() : null,
      },
    };
  }
  if (choice.kind === 'LINK') {
    return {
      url: '/api/purchasing/commands',
      body: {
        commandType: 'LinkDeliveryToPurchaseOrder',
        ...ids,
        purchaseOrderId: choice.purchaseOrderId,
        purchaseOrderLineId: choice.purchaseOrderLineId,
      },
    };
  }
  return null;
}

const uuid = z.string().uuid();

/** Records why a delivery that is not confirmed yet has no purchase order. */
export const setNoPurchaseOrderReasonSchema = z
  .object({
    tenantId: uuid,
    stationId: uuid,
    deliveryId: uuid,
    noPoReason: z.enum(REASON_CODES),
    noPoNote: z.string().trim().max(NO_PO_NOTE_MAX).nullish(),
  })
  .refine((value) => value.noPoReason !== 'OTHER' || !!value.noPoNote, {
    message: 'Say in a few words why there is no purchase order',
    path: ['noPoNote'],
  });
