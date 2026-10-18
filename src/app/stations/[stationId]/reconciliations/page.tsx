import { ServerOperationsOverview } from '@/modules/forecourt/server-overview';
import type { PageSearch } from '@/modules/context/server-page';
export const metadata = { title: 'Reconciliations' };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams: Promise<PageSearch>;
}) {
  const { stationId } = await params;
  return (
    <ServerOperationsOverview
      search={await searchParams}
      stationId={stationId}
      focus="reconciliations"
    />
  );
}
