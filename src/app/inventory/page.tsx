import { redirect } from 'next/navigation';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  const context = new URLSearchParams();
  // Context links are built with tenantId (buildContextHref); keep it with the rest.
  for (const name of ['tenantId', 'organisationId', 'legalEntityId', 'stationId', 'allStations']) {
    const value = first(search[name]);
    if (value) context.set(name, value);
  }
  const query = context.toString();
  redirect(query ? `/inventory/valuation?${query}` : '/inventory/valuation');
}
