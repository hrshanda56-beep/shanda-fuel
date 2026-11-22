import 'server-only';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { AccessDeniedState } from '@/design-system/primitives';
import { getPastDaysFromRequest } from './past-days';
import { PastDaysWorkspace } from './ui/past-days-workspace';

const NEEDS_STATION = (
  <AccessDeniedState message="Choose a station first, then open Record a past day." />
);

export function ServerPastDays({ search }: { search: PageSearch }) {
  return (
    <ServerDataPage
      pathname="/operations/daily/past-days"
      search={search}
      shell={{ pageTitle: 'Record a past day' }}
      fallback={NEEDS_STATION}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.stationId || current.allStations) return null;
        const tenantId = current.organisationId;
        const stationId = current.stationId;
        return {
          tenantId,
          stationId,
          data: await getPastDaysFromRequest(request, { tenantId, stationId }),
        };
      }}
      render={(result) =>
        result ? (
          <PastDaysWorkspace
            key={`${result.tenantId}|${result.stationId}`}
            tenantId={result.tenantId}
            stationId={result.stationId}
            data={result.data}
          />
        ) : (
          NEEDS_STATION
        )
      }
    />
  );
}
