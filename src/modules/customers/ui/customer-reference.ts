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
