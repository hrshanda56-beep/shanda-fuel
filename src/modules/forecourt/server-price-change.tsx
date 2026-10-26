import 'server-only';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { AccessDeniedState } from '@/design-system/primitives';
import { getPriceChangeFromRequest } from './price-change';
import { PriceChangeWorkspace } from './ui/price-change-workspace';

const NEEDS_STATION = (
  <AccessDeniedState message="Choose a station first, then open Change a price." />
);

export function ServerPriceChange({ search }: { search: PageSearch }) {
  return (
    <ServerDataPage
      pathname="/operations/daily/price-change"
      search={search}
      fallback={NEEDS_STATION}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.stationId || current.allStations) return null;
        const tenantId = current.organisationId;
        const stationId = current.stationId;
        try {
          return {
            tenantId,
            stationId,
            data: await getPriceChangeFromRequest(request, { tenantId, stationId }),
          };
        } catch {
          // The workspace loads again from the API and shows the matching message.
          return { tenantId, stationId, data: undefined };
        }
      }}
      render={(result) =>
        result ? (
          <PriceChangeWorkspace
            key={`${result.tenantId}|${result.stationId}`}
            tenantId={result.tenantId}
            stationId={result.stationId}
            initialData={result.data}
          />
        ) : (
          NEEDS_STATION
        )
      }
    />
  );
}
