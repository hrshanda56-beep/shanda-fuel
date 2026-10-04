import type { ContextResolution } from '../context';

export type SettingsAccount = Readonly<{
  name: string;
  email: string;
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
}>;

export type SettingsContextResolution = ContextResolution;
