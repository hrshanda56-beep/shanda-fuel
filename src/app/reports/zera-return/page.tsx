import Link from 'next/link';
import { ContextRequiredState } from '@/design-system/primitives';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { findReport } from '@/modules/reporting/catalog';
import { businessToday } from '@/modules/reporting/period';
import { ZeraReturnWizard } from '@/modules/reporting/zera/ui/zera-return-wizard';
import { recentMonths } from '@/modules/reporting/zera/zera-wizard-checks';

const SLUG = 'zera-return';

export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  return (
    <ServerDataPage
      pathname={`/reports/${SLUG}`}
      search={await searchParams}
      shell={{ pageSubtitle: findReport(SLUG)?.title }}
      fallback={
        <ContextRequiredState
          title="Choose an organisation to view reports"
          message="Use the work context selector above to choose an organisation."
        />
      }
      load={async (_request, resolution) => {
        const current = resolution.current;
        if (!current) return null;
        const organisation = resolution.available.organisations.find(
          (candidate) => candidate.id === current.organisationId,
        );
        const stations = (organisation?.legalEntities ?? [])
          .flatMap((entity) => entity.stations)
          // A station still being set up has nothing to report.
          .filter((station) => station.status !== 'ONBOARDING')
          .filter((station) => !current.stationId || station.id === current.stationId)
          .map((station) => ({ id: station.id, name: station.name }));
        return { tenantId: current.organisationId, stations };
      }}
      render={(data) =>
        data ? (
          <div className="reports-stack">
            <p>
              <Link href={`/reports?tenantId=${encodeURIComponent(data.tenantId)}`}>
                ← All reports
              </Link>
            </p>
            {data.stations.length === 0 ? (
              <ContextRequiredState
                title="No live stations yet"
                message="A station appears here once it is set up and live."
              />
            ) : (
              <ZeraReturnWizard
                tenantId={data.tenantId}
                stations={data.stations}
                months={recentMonths(businessToday())}
              />
            )}
          </div>
        ) : null
      }
    />
  );
}

export const metadata = { title: findReport(SLUG)?.title ?? 'Reports' };
