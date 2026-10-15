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
}>;

export type SettingsContext = Readonly<{
  status: 'ready' | 'unavailable';
  organisation?: SettingsOrganisation;
  legalEntities: readonly SettingsLegalEntity[];
  selectedStation: SettingsStation | null;
}>;

export type SettingsView = Readonly<{
  account: SettingsAccount;
  context: SettingsContext;
  staff?: StaffOverview;
  /** Set when the actor may see their own account but not the organisation. */
  accountOnly?: boolean;
}>;

export type SettingsContextResolution = ContextResolution;
