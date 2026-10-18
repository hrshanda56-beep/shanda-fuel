import 'server-only';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { buildContextHref } from '@/modules/context';
import { InventoryContextRequired } from '@/modules/inventory/ui/inventory-workspace';
import {
  ValuationOverview,
  ValuationStreamDetail,
  RevaluationDetail,
} from './ui/valuation-workspace';
import { getInventoryValuationReadModel, getInventoryRevaluationReadModel } from './queries';
export function ValuationPage({
  search,
  tankId,
  productId,
  revaluationId,
}: {
  search: PageSearch;
  tankId?: string;
  productId?: string;
  revaluationId?: string;
}) {
  return (
    <ServerDataPage
      pathname="/inventory/valuation"
      search={search}
      fallback={<InventoryContextRequired />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.stationId || !current.legalEntityId || current.allStations) return null;
        const organisation = resolution.available.organisations.find(
          (row) => row.id === current.organisationId,
        )!;
        const entity = organisation.legalEntities.find((row) => row.id === current.legalEntityId)!;
        const station = entity.stations.find((row) => row.id === current.stationId)!;
        const context = {
          tenantId: organisation.id,
          legalEntityId: entity.id,
          stationId: station.id,
          organisationName: organisation.name,
          legalEntityName: entity.name,
          stationName: station.name,
          stationTimezone: station.timezone,
        };
        const contextHref = buildContextHref('/inventory/valuation', '', current);
        const input = { tenantId: organisation.id, stationId: station.id };
        if (revaluationId)
          return {
            kind: 'revaluation' as const,
            context,
            contextHref,
            data: await getInventoryRevaluationReadModel(request, { ...input, revaluationId }),
          };
        return {
          kind: 'valuation' as const,
          context,
          contextHref,
          data: await getInventoryValuationReadModel(request, { ...input, tankId, productId }),
        };
      }}
      render={(result) => {
        if (!result) return <InventoryContextRequired />;
        const key = JSON.stringify([result.context, tankId, productId, revaluationId]);
        if (result.kind === 'revaluation')
          return (
            <RevaluationDetail
              key={key}
              context={result.context}
              contextHref={result.contextHref}
              revaluationId={revaluationId!}
              initialData={result.data}
            />
          );
        if (tankId && productId)
          return (
            <ValuationStreamDetail
              key={key}
              context={result.context}
              contextHref={result.contextHref}
              tankId={tankId}
              productId={productId}
              initialData={result.data}
            />
          );
        return (
          <ValuationOverview
            key={key}
            context={result.context}
            contextHref={result.contextHref}
            initialData={result.data}
          />
        );
      }}
    />
  );
}
