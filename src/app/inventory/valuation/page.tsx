import { ValuationPage } from '@/modules/costing/server-page';
import type { PageSearch } from '@/modules/context/server-page';
export const metadata = { title: 'Inventory valuation' };
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  return <ValuationPage search={await searchParams} />;
}
