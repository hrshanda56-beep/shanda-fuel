import 'server-only';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { buildContextHref } from '@/modules/context';
import { InventoryContextRequired } from './ui/inventory-workspace';
import { TankDetailView } from './ui/tank-detail';
import { queryTankDetail } from './tank-detail';

/** The tank page for the selected station, or null when a single station is not chosen. */
function stationOf(
  resolution: Parameters<Parameters<typeof ServerDataPage>[0]['load']>[1],
  pathname: string,
) {
  const current = resolution.current;
  if (!current?.stationId || !current.legalEntityId || current.allStations) return null;
  const organisation = resolution.available.organisations.find(
    (row) => row.id === current.organisationId,
  )!;
  const entity = organisation.legalEntities.find((row) => row.id === current.legalEntityId)!;
  const station = entity.stations.find((row) => row.id === current.stationId)!;
  const contextHref = buildContextHref(pathname, '', current);
  return {
    tenantId: organisation.id,
    stationId: station.id,
    stationName: station.name,
    contextQuery: contextHref.split('?')[1] ?? '',
  };
}

export function TankDetailPage({ search, tankId }: { search: PageSearch; tankId: string }) {
  const pathname = `/inventory/tanks/${tankId}`;
  return (
    <ServerDataPage
      pathname={pathname}
      search={search}
      fallback={<InventoryContextRequired />}
      load={async (request, resolution) => {
        const station = stationOf(resolution, pathname);
        if (!station) return null;
        return {
          station,
          tankId,
          data: await queryTankDetail({
            request,
            tenantId: station.tenantId,
            stationId: station.stationId,
            tankId,
          }),
        };
      }}
      render={(result) => {
        if (!result) return <InventoryContextRequired />;
        const withContext = (path: string) =>
          result.station.contextQuery ? `${path}?${result.station.contextQuery}` : path;
        return (
          <TankDetailView
            key={`${result.station.stationId}:${result.tankId}`}
            context={result.station}
            inventoryHref={withContext('/inventory')}
            streamHref={withContext(
              `/inventory/valuation/streams/${result.tankId}/${result.data.tank.productId}`,
            )}
            initialData={result.data}
            initialTab={typeof search.tab === 'string' ? search.tab : undefined}
          />
        );
      }}
    />
  );
}
