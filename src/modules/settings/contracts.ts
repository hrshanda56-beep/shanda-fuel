import type { ContextResolution } from '../context';
import type { StaffOverview, StationStaffMember } from '../staff';

export type SettingsAccount = Readonly<{
  name: string;
  email: string | null;
}>;

export type SettingsOrganisation = Readonly<{
  id: string;
  name: string;
}>;

export type SettingsLegalEntity = Readonly<{
  id: string;
  name: string;
}>;

export type SettingsStation = Readonly<{
  id: string;
  code: string;
  name: string;
  timezone: string;
  /** ONBOARDING while the station is still being set up. */
  status?: 'ACTIVE' | 'ONBOARDING';
}>;

export type SettingsContext = Readonly<{
  status: 'ready' | 'unavailable';
  organisation?: SettingsOrganisation;
  legalEntities: readonly SettingsLegalEntity[];
  selectedStation: SettingsStation | null;
  stations?: readonly SettingsStation[];
}>;

/**
 * What a station-level reader (a supervisor) gets in place of the organisation Settings: their
 * own station's staff list and activity log, read only.
 */
export type SettingsStationView = Readonly<{
  stationId: string;
  stationName: string;
  canViewStaff: boolean;
  canViewActivity: boolean;
  staff: readonly StationStaffMember[];
}>;

export type SettingsView = Readonly<{
  account: SettingsAccount;
  context: SettingsContext;
  /** Present instead of the organisation tabs when the person only reads one station. */
  stationView?: SettingsStationView;
  staff?: StaffOverview;
  access?: Readonly<{
    canViewReadiness: boolean;
    canViewPayments: boolean;
    canViewAudit?: boolean;
    canManageAlerts?: boolean;
    canManageStations?: boolean;
    canManageCompanies?: boolean;
  }>;
}>;

export type SettingsContextResolution = ContextResolution;
