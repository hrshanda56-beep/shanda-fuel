import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { EmptyState } from '@/design-system/primitives';
export const metadata = { title: 'Settlements' };
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  return (
    <ServerDataPage
      pathname="/settlements"
      search={{ ...(await searchParams), allStations: 'true', stationId: undefined }}
      fallback={
        <EmptyState title="Choose an organisation" message="Choose an authorized organisation." />
      }
      load={async () => null}
      render={() => null}
    />
  );
}
