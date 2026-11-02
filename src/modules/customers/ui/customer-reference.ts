/** A short code people never have to type: letters from the name plus a few digits. */
export function makeReference(name: string): string {
  const letters = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${letters || 'CUST'}-${digits}`;
}

export { STAFF_CUSTOMER_KIND } from '../staff-records';

const plainName = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

/** True when another customer already has this name, ignoring case and extra spaces. */
export function isDuplicateCustomerName(name: string, existing: readonly string[]): boolean {
  const wanted = plainName(name);
  return wanted !== '' && existing.some((other) => plainName(other) === wanted);
}
