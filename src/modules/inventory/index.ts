export {
  INVENTORY_MOVEMENT_TYPES,
  assertWithinTankCapacity,
  calculateDeliveryShortageExcess,
  calculateTankStockVariance,
  deriveExpectedTankStock,
  requireAdjustmentReason,
  validateDeliveryAllocations,
  validateMovementQuantity,
} from './domain';
export type { InventoryMovementType, StockMovement } from './domain';
export {
  createDeliveryFromRequest,
  createTankFromRequest,
  confirmDeliveryFromRequest,
  deactivateTankFromRequest,
  postInventoryAdjustmentFromRequest,
  recordOpeningInventoryCostFromRequest,
  recordOpeningBalanceFromRequest,
  recordReceiptCostFromRequest,
  recordTankDipFromRequest,
} from './commands';
export { queryInventoryStock } from './queries';
export {
  getExpectedTankStock,
  getPhysicalTankStock,
  getStationProductStock,
  getTankVariance,
} from './persistence';
export type { StockPosition, TankRecord } from './persistence';
