import { ServerOperationsOverview } from '@/modules/forecourt/server-overview';
import type { PageSearch } from '@/modules/context/server-page';
export const metadata = { title: 'Reconciliations' };
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  return <ServerOperationsOverview search={await searchParams} focus="reconciliations" />;
}
