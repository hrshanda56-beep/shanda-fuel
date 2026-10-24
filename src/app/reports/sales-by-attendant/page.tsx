import { ServerTableReport } from '@/modules/reporting/table-reports/server-page';
import { findTableReport } from '@/modules/reporting/table-reports/definitions';
import type { PageSearch } from '@/modules/context/server-page';

const SLUG = 'sales-by-attendant';

export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  return <ServerTableReport slug={SLUG} search={await searchParams} />;
}
export const metadata = { title: findTableReport(SLUG)?.title ?? 'Reports' };
