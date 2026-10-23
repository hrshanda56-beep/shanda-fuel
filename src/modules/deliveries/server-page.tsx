import 'server-only';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { buildContextHref } from '@/modules/context';
import { InventoryContextRequired } from '@/modules/inventory/ui/inventory-workspace';
import { DeliveriesList } from './ui/deliveries-list';
import { DeliveryDetails } from './ui/delivery-details';
import { queryDeliveryDetail, queryDeliveryList } from './queries';

/** Loads the selected station for the page, or null when a single station is not chosen. */
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

export function DeliveriesPage({ search }: { search: PageSearch }) {
  return (
    <ServerDataPage
      pathname="/inventory/deliveries"
      search={search}
      fallback={<InventoryContextRequired />}
      load={async (request, resolution) => {
        const station = stationOf(resolution, '/inventory/deliveries');
        if (!station) return null;
        return {
          station,
          data: await queryDeliveryList({
            request,
            tenantId: station.tenantId,
            stationId: station.stationId,
          }),
        };
      }}
      render={(result) =>
        result ? (
          <DeliveriesList
            key={result.station.stationId}
            context={result.station}
            contextQuery={result.station.contextQuery}
            initialData={result.data}
          />
        ) : (
          <InventoryContextRequired />
        )
      }
    />
  );
}

export function DeliveryDetailsPage({
  search,
  deliveryId,
}: {
  search: PageSearch;
  deliveryId: string;
}) {
  return (
    <ServerDataPage
      pathname="/inventory/deliveries"
      search={search}
      fallback={<InventoryContextRequired />}
      load={async (request, resolution) => {
        const station = stationOf(resolution, '/inventory/deliveries');
        if (!station) return null;
        return {
          station,
          data: await queryDeliveryDetail({
            request,
            tenantId: station.tenantId,
            stationId: station.stationId,
            deliveryId,
          }),
        };
      }}
      render={(result) =>
        result ? (
          <DeliveryDetails
            key={`${result.station.stationId}:${deliveryId}`}
            context={result.station}
            listHref={`/inventory/deliveries${result.station.contextQuery ? `?${result.station.contextQuery}` : ''}`}
            initialData={result.data}
          />
        ) : (
          <InventoryContextRequired />
        )
      }
    />
  );
}
