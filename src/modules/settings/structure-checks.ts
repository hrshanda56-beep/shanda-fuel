/** The checks behind the "Add a company" and "Add a station" guides. Pure, so they are tested alone. */

export type Errors = Record<string, string>;

export function checkCompanyName(name: string, takenNames: readonly string[] = []): Errors {
  const trimmed = name.trim();
  if (!trimmed) return { name: 'Enter the company name.' };
  if (takenNames.some((taken) => taken.trim().toLowerCase() === trimmed.toLowerCase())) {
    return { name: `You already have a company called ${trimmed}.` };
  }
  return {};
}

export function checkStationName(name: string): Errors {
  return name.trim() ? {} : { name: 'Enter the station name.' };
}

export const STATION_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/;

export function checkStationCode(code: string, takenCodes: readonly string[] = []): Errors {
  const trimmed = code.trim();
  if (!STATION_CODE.test(trimmed)) {
    return { code: 'Enter a short code of 2 to 20 letters or numbers, for example BND.' };
  }
  if (takenCodes.some((taken) => taken.toUpperCase() === trimmed.toUpperCase())) {
    return { code: `The code ${trimmed.toUpperCase()} is already used by another station.` };
  }
  return {};
}

export function checkStationCompany(companyId: string): Errors {
  return companyId ? {} : { company: 'Choose the company that runs this station.' };
}

/** A short starting code from the station name, for example "Bindura Road" gives "BIN". */
export function suggestStationCode(name: string, takenCodes: readonly string[] = []): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const base = letters.slice(0, 3);
  if (base.length < 2) return '';
  const used = new Set(takenCodes.map((code) => code.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    if (!used.has(`${base}${n}`)) return `${base}${n}`;
  }
  return base;
}
