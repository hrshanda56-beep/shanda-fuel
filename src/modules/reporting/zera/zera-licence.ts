/** Licence details the ZERA return asks for. Kept free of server imports so forms can use them too. */

export const ZERA_PROVINCES = [
  'Bulawayo',
  'Harare',
  'Manicaland',
  'Mashonaland Central',
  'Mashonaland East',
  'Mashonaland West',
  'Masvingo',
  'Matabeleland North',
  'Matabeleland South',
  'Midlands',
] as const;

export type ZeraProvince = (typeof ZERA_PROVINCES)[number];

export const ZERA_OWNERSHIPS = ['COCO', 'CODO', 'DODO'] as const;
export type ZeraOwnership = (typeof ZERA_OWNERSHIPS)[number];

/** Plain words for the three ownership types, shown next to the short code. */
export const ZERA_OWNERSHIP_LABELS: Record<ZeraOwnership, string> = {
  COCO: 'Company owned, company operated',
  CODO: 'Company owned, dealer operated',
  DODO: 'Dealer owned, dealer operated',
};

export type StationZeraDetails = Readonly<{
  licenceNumber: string | null;
  licenceHolder: string | null;
  ownership: ZeraOwnership | null;
  province: ZeraProvince | null;
  representativeName: string | null;
  representativePhone: string | null;
  representativeEmail: string | null;
}>;

/** What is still needed before a return can be written for a station, in the order it is asked. */
export function missingLicenceDetails(details: StationZeraDetails): string[] {
  const missing: string[] = [];
  if (!details.licenceHolder) missing.push('Name on the licence');
  if (!details.licenceNumber) missing.push('Licence number');
  if (!details.ownership) missing.push('Ownership type');
  if (!details.province) missing.push('Province');
  if (!details.representativeName) missing.push('Representative name');
  if (!details.representativePhone) missing.push('Representative phone');
  if (!details.representativeEmail) missing.push('Representative email');
  return missing;
}
