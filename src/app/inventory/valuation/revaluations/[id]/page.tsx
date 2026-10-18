import { ValuationPage } from '@/modules/costing/server-page';
import type { PageSearch } from '@/modules/context/server-page';
export const metadata = { title: 'Inventory valuation' };
export default async function Page({
  searchParams,
  params,
}: {
  searchParams: Promise<PageSearch>;
  params: Promise<{ id: string }>;
}) {
  const route = await params;
  return <ValuationPage search={await searchParams} revaluationId={route.id} />;
}
