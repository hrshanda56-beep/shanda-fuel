/**
 * Which customer records can be given a staff fuel benefit from the benefit page: people already
 * kept as staff (the record carries the Staff mark) who are active and not yet on a benefit. A new
 * staff member is not picked from this list; the page creates the record and the benefit together.
 */
export const STAFF_CUSTOMER_KIND = 'STAFF';

export type StaffRecordCandidate = Readonly<{
  customerId: string;
  displayName: string;
  accountReference: string;
  status: string;
  contactMetadata: Readonly<Record<string, string>>;
}>;

export function staffRecordsWithoutBenefit(
  customers: readonly StaffRecordCandidate[],
  customersOnBenefit: ReadonlySet<string>,
): Array<{ customerId: string; name: string; reference: string }> {
  return customers
    .filter(
      (customer) =>
        customer.status === 'ACTIVE' &&
        customer.contactMetadata.kind === STAFF_CUSTOMER_KIND &&
        !customersOnBenefit.has(customer.customerId),
    )
    .map((customer) => ({
      customerId: customer.customerId,
      name: customer.displayName,
      reference: customer.accountReference,
    }));
}
