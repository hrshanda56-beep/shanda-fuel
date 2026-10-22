export type TankRow = {
  stationId: string;
  tankId: string;
  tankCode: string;
  productId: string;
  productCode: string;
  productName: string;
  capacityLitres: string;
  reorderLevelLitres: string | null;
  acceptableVarianceLitres?: string | null;
  expectedLitres: string;
  physicalLitres: string | null;
  varianceLitres: string | null;
};

export type InventoryReport = {
  filters: { toDate: string };
  inventory: { rows: readonly TankRow[] };
};
