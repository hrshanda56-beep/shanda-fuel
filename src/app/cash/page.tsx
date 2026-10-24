import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { EmptyState } from '@/design-system/primitives';
export const metadata = { title: 'Cash' };
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  return (
    <ServerDataPage
      pathname="/cash"
      search={{ ...(await searchParams), allStations: 'true', stationId: undefined }}
      fallback={
        <EmptyState title="Choose an organisation" message="Choose an authorized organisation." />
      }
      load={async () => null}
      render={() => null}
    />
  );
}
