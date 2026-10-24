/** Public purchasing module boundary. Server-only persistence stays behind the command/query entry points. */
export {
  PURCHASING_COMMAND_POLICY,
  PURCHASING_COMMAND_TYPES,
  PURCHASING_PERMISSION_CODES,
  type PurchasingCommandType,
} from './contracts';
export {
  PURCHASE_ORDER_RECEIPT_STATUSES,
  PURCHASE_ORDER_STATES,
  type PurchaseOrderReceiptStatus,
  type PurchaseOrderState,
} from './domain';
