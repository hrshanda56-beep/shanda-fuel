import type { ContextResolution } from '../context';
import type { StaffOverview } from '../staff';

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

export type SettingsView = Readonly<{
  account: SettingsAccount;
  context: SettingsContext;
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
