/**
 * Setup readiness and payment-setup contracts.
 *
 * Counts here come only from tenant-scoped reads. A count of zero means "no
 * record was entered"; the UI renders that as "Not entered", never as 0.
 */

export type ReadinessAreaCode = 'PRICES' | 'TANKS' | 'PUMPS' | 'SHIFTS' | 'PAYMENTS' | 'STAFF';

export type ReadinessStatus = 'READY' | 'PARTIAL' | 'NOT_ENTERED';

/** Raw counts read for one station. Only counts, never money or litres. */
export type StationSetupFacts = Readonly<{
  stationId: string;
  stationCode: string;
  stationName: string;
  legalEntityId: string;
  /** Active products defined for the organisation. */
  activeProducts: number;
  /** Active products with a currently effective ACTIVE price at this station. */
  pricedProducts: number;
  activeTanks: number;
  /** Active tanks with no acceptable-variance tolerance entered. */
  tanksMissingTolerance: number;
  activePumps: number;
  activeNozzles: number;
  /** Active pumps with no active nozzle. */
  pumpsWithoutNozzle: number;
  activeShiftTemplates: number;
  providerAccounts: number;
  bankAccounts: number;
  /** Active people holding a station-scoped role at this station. */
  assignedStaff: number;
}>;

export type ReadinessArea = Readonly<{
  code: ReadinessAreaCode;
  label: string;
  status: ReadinessStatus;
  /** Plain-language detail; never contains a fabricated number. */
  detail: string;
  /** What is blocked while this area is not ready. */
  blocks: string;
}>;

export type StationReadiness = Readonly<{
  stationId: string;
  stationCode: string;
  stationName: string;
  legalEntityId: string;
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

export type SetupOverview =
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'error' }>
  | Readonly<{
      status: 'ready';
      tenantId: string;
      /** May open the readiness panel. */
      canViewReadiness: boolean;
      /** May read providers, provider accounts and bank accounts. */
      canViewPayments: boolean;
      /** May create providers and provider accounts (provider.manage). */
      canManagePayments: boolean;
      stations: readonly StationReadiness[];
      stationOptions: readonly SetupStationOption[];
      providers: readonly PaymentProviderRow[];
      providerAccounts: readonly ProviderAccountRow[];
      bankAccounts: readonly BankAccountRow[];
    }>;
