import { TankDetailPage } from '@/modules/inventory/tank-detail-page';
import type { PageSearch } from '@/modules/context/server-page';
export const metadata = { title: 'Tank' };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tankId: string }>;
  searchParams: Promise<PageSearch>;
}) {
  const { tankId } = await params;
  return <TankDetailPage search={await searchParams} tankId={tankId} />;
}
