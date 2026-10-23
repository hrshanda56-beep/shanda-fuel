import { DeliveryDetailsPage } from '@/modules/deliveries/server-page';
import type { PageSearch } from '@/modules/context/server-page';
export const metadata = { title: 'Delivery details' };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageSearch>;
}) {
  const { id } = await params;
  return <DeliveryDetailsPage search={await searchParams} deliveryId={id} />;
}
