import { headers } from 'next/headers';

import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import {
  buildContextHref,
  contextRoutePolicy,
  readContextRoute,
  type ContextResolution,
} from '@/modules/context';
import { resolveCurrentContext } from '@/modules/context/server';
import { ValuationOverview } from '@/modules/costing/ui/valuation-workspace';
import {
  InventoryContextRequired,
  type InventoryContext,
} from '@/modules/inventory/ui/inventory-workspace';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function searchForContext(search: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of ['tenantId', 'organisationId', 'legalEntityId', 'stationId', 'allStations']) {
    const value = first(search[name]);
    if (value) params.set(name, value);
  }
  return params;
}

function resolvedInventoryContext(resolution: ContextResolution): InventoryContext | null {
  const selection = resolution.current;
  if (!selection || selection.allStations || !selection.legalEntityId || !selection.stationId) {
    return null;
  }
  const organisation = resolution.available.organisations.find(
    (candidate) => candidate.id === selection.organisationId,
  );
  const legalEntity = organisation?.legalEntities.find(
    (candidate) => candidate.id === selection.legalEntityId,
  );
  const station = legalEntity?.stations.find((candidate) => candidate.id === selection.stationId);
  if (!organisation || !legalEntity || !station) return null;
  return {
    tenantId: organisation.id,
    legalEntityId: legalEntity.id,
    stationId: station.id,
    organisationName: organisation.name,
    legalEntityName: legalEntity.name,
    stationName: station.name,
    stationTimezone: station.timezone,
  };
}

async function loadInventoryContext(search: SearchParams): Promise<InventoryContext | null> {
  const pathname = '/inventory/valuation';
  const params = searchForContext(search);
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) return null;
  const protocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http';
  const request = new Request(`${protocol}://${host}${pathname}?${params.toString()}`, {
    headers: new Headers(requestHeaders),
  });
  try {
    const policy = contextRoutePolicy(pathname);
    const resolution = await resolveCurrentContext(request, {
      route: readContextRoute(pathname, new URL(request.url).searchParams),
      policy,
    });
    return resolvedInventoryContext(resolution);
  } catch {
    return null;
  }
}

export default async function InventoryValuationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  const context = await loadInventoryContext(search);
  const contextHref = context
    ? buildContextHref('/inventory/valuation', '', {
        organisationId: context.tenantId,
        legalEntityId: context.legalEntityId,
        stationId: context.stationId,
        allStations: false,
      })
    : '/inventory/valuation';
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      breadcrumbs={[{ label: 'Inventory' }, { label: 'Valuation' }]}
    >
      {context ? (
        <ValuationOverview context={context} contextHref={contextHref} />
      ) : (
        <InventoryContextRequired />
      )}
    </AppShell>
  );
}
