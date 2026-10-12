export type SetupProduct = Readonly<{ id: string; code: string; name: string; status: string }>;
export type SetupTank = Readonly<{
  id: string;
  code: string;
  productId: string;
  capacityLitres: string;
  reorderLevelLitres: string | null;
  acceptableVarianceLitres: string | null;
  status: string;
}>;
export type SetupPump = Readonly<{
  id: string;
  number: string;
  name: string | null;
  status: string;
}>;
export type SetupNozzle = Readonly<{
  id: string;
  pumpId: string;
  number: string;
  productId: string;
  status: string;
  meterSerialNumber: string | null;
}>;
export type SetupShiftTemplate = Readonly<{
  id: string;
  code: string;
  name: string;
  startTime: string | null;
  durationMinutes: number;
  active: boolean;
  version: number;
}>;
export type SetupPrice = Readonly<{
  id: string;
  productId: string;
  unitPrice: string;
  currency: string;
  state: string;
  effectiveFrom: string;
  version: number;
}>;
export type SetupSupplier = Readonly<{
  id: string;
  code: string;
  legalName: string;
  registrationReference: string | null;
  status: string;
  version: number;
}>;

export type SetupBlocker = Readonly<{ code: string; message: string }>;

export type SetupCapabilities = Readonly<{
  products: boolean;
  tanks: boolean;
  forecourt: boolean;
  shiftTemplates: boolean;
  priceRequest: boolean;
  priceApprove: boolean;
  priceActivate: boolean;
  suppliers: boolean;
}>;

/** A `null` section means the caller may not read it; `[]` means "Not entered". */
export type SetupOverview = Readonly<{
  tenantId: string;
  stationId: string;
  legalEntityId: string;
  stationStatus: string;
  capabilities: SetupCapabilities;
  products: readonly SetupProduct[] | null;
  tanks: readonly SetupTank[] | null;
  pumps: readonly SetupPump[] | null;
  nozzles: readonly SetupNozzle[] | null;
  shiftTemplates: readonly SetupShiftTemplate[] | null;
  prices: readonly SetupPrice[] | null;
  suppliers: readonly SetupSupplier[] | null;
  blockers: readonly SetupBlocker[];
}>;

export type SetupStationOption = Readonly<{
  id: string;
  code: string;
  name: string;
  status: string;
}>;
