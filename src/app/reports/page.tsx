import { ServerReportsIndex } from '@/modules/reporting/server-pages';
import type { PageSearch } from '@/modules/context/server-page';
export const metadata = { title: 'Reports' };
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  return <ServerReportsIndex search={await searchParams} />;
}
