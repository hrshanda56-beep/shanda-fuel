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

export type SetupSupervisor = Readonly<{ membershipId: string; name: string }>;

export type SetupBlocker = Readonly<{ code: string; message: string }>;

export type ReadinessAreaCode = 'PRICES' | 'TANKS' | 'PUMPS' | 'SHIFTS' | 'PAYMENTS' | 'STAFF';
export type ReadinessStatus = 'READY' | 'PARTIAL' | 'NOT_ENTERED';
export type StationSetupFacts = Readonly<{
  stationId: string;
  stationCode: string;
  stationName: string;
  legalEntityId: string;
  /** ONBOARDING until the station is activated; absent means live. */
  stationStatus?: 'ACTIVE' | 'ONBOARDING';
  activeProducts: number;
  pricedProducts: number;
  activeTanks: number;
  tanksMissingTolerance: number;
  /** Active tanks with no opening quantity recorded yet. */
  tanksMissingOpeningStock: number;
  /** Active tanks with an opening quantity but no opening cost, so the stock is unvalued. */
  tanksMissingOpeningCost: number;
  activePumps: number;
  activeNozzles: number;
  pumpsWithoutNozzle: number;
  activeShiftTemplates: number;
  providerAccounts: number;
  bankAccounts: number;
  assignedStaff: number;
}>;
export type ReadinessArea = Readonly<{
  code: ReadinessAreaCode;
  label: string;
  status: ReadinessStatus;
  detail: string;
  blocks: string;
}>;
/** One thing that must be done before a station can go live, and the Settings tab that fixes it. */
export type ActivationMissing = Readonly<{
  code: ReadinessAreaCode;
  label: string;
  detail: string;
  tab: 'setup' | 'payments' | 'staff';
}>;
export type StationReadiness = Readonly<{
  stationId: string;
  stationCode: string;
  stationName: string;
  legalEntityId: string;
  stationStatus: 'ACTIVE' | 'ONBOARDING';
  /** What still stops this station going live. Opening stock is entered after go-live. */
  missing: readonly ActivationMissing[];
  /** True when the station is still being set up and nothing is missing. */
  canActivate: boolean;
  areas: readonly ReadinessArea[];
  ready: boolean;
  blockedSummary: string | null;
}>;
export type PaymentProviderRow = Readonly<{
  id: string;
  code: string;
  name: string;
  providerType: 'CARD_ACQUIRER' | 'POS' | 'MOBILE_MONEY' | 'OTHER_ELECTRONIC';
  status: 'ACTIVE' | 'INACTIVE';
}>;
export type ProviderAccountRow = Readonly<{
  id: string;
  providerId: string;
  providerName: string;
  stationId: string | null;
  legalEntityId: string | null;
  accountReference: string;
  displayName: string;
  currency: string;
  status: 'ACTIVE' | 'INACTIVE';
}>;
export type BankAccountRow = Readonly<{
  id: string;
  legalEntityId: string;
  name: string;
  bankName: string;
  accountReferenceMasked: string;
  currency: string;
  status: 'ACTIVE' | 'INACTIVE';
}>;
export type SetupStationOption = Readonly<{
  id: string;
  code: string;
  name: string;
  legalEntityId: string;
}>;

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
export type ConfigurationSetupOverview = Readonly<{
  tenantId: string;
  stationId: string;
  stationStatus: string;
  capabilities: SetupCapabilities;
  products: readonly SetupProduct[] | null;
  tanks: readonly SetupTank[] | null;
  pumps: readonly SetupPump[] | null;
  nozzles: readonly SetupNozzle[] | null;
  shiftTemplates: readonly SetupShiftTemplate[] | null;
  prices: readonly SetupPrice[] | null;
  suppliers: readonly SetupSupplier[] | null;
  /** Active supervisors assigned to this station; the responsible one is chosen from them. */
  supervisors: readonly SetupSupervisor[] | null;
  responsibleSupervisorMembershipId: string | null;
  blockers: readonly SetupBlocker[];
}>;

export type SetupOverview =
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'error' }>
  | Readonly<{
      status: 'ready';
      tenantId: string;
      canViewReadiness: boolean;
      canViewPayments: boolean;
      canManagePayments: boolean;
      stations: readonly StationReadiness[];
      stationOptions: readonly SetupStationOption[];
      providers: readonly PaymentProviderRow[];
      providerAccounts: readonly ProviderAccountRow[];
      bankAccounts: readonly BankAccountRow[];
    }>;
