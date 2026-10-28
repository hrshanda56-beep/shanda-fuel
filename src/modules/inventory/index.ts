export {
  INVENTORY_MOVEMENT_TYPES,
  assertWithinTankCapacity,
  calculateDeliveryShortageExcess,
  calculateTankStockVariance,
  deriveExpectedTankStock,
  requireAdjustmentReason,
  validateDeliveryDipWindow,
  validateDeliveryAllocations,
  validateMovementQuantity,
} from './domain';
export type { InventoryMovementType, StockMovement } from './domain';
export {
  createDeliveryFromRequest,
  createTankFromRequest,
  setTankVarianceLimitsFromRequest,
  confirmDeliveryFromRequest,
  correctDeliverySupplierFromRequest,
  deactivateTankFromRequest,
  approveInventoryCostRevaluationFromRequest,
  postInventoryAdjustmentFromRequest,
  postInventoryCostRevaluationFromRequest,
  recordOpeningInventoryCostFromRequest,
  recordOpeningBalanceFromRequest,
  recordReceiptCostFromRequest,
  recordTankDipFromRequest,
  voidTankDipFromRequest,
  setTankCalibrationFromRequest,
  requestInventoryCostRevaluationFromRequest,
} from './commands';
export { queryDeliverySuppliers, queryInventoryStock } from './queries';
export type { DeliverySupplierOption } from './queries';
export {
  getExpectedTankStock,
  getPhysicalTankStock,
  getStationProductStock,
  getTankVariance,
} from './persistence';
export type { StockPosition, TankRecord } from './persistence';
