/**
 * Which company a new customer is with. A customer's credit is with one company, so it must be
 * known before the form opens, not after the person has typed everything.
 *  - a company chosen at the top of the page wins;
 *  - otherwise, if there is only one company, it is used without asking;
 *  - otherwise the person is asked first, and the answer is used.
 */
export function companyForNewCustomer(input: {
  selected: string | null;
  companies: ReadonlyArray<{ id: string }>;
  picked: string;
}): { legalEntityId: string | null; mustAskFirst: boolean } {
  const only = input.companies.length === 1 ? (input.companies[0]?.id ?? null) : null;
  const legalEntityId = input.selected ?? only ?? (input.picked || null);
  return { legalEntityId, mustAskFirst: legalEntityId === null && input.companies.length > 1 };
}
