import { DeliveriesPage } from '@/modules/deliveries/server-page';
import type { PageSearch } from '@/modules/context/server-page';
export const metadata = { title: 'Fuel deliveries' };
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  return <DeliveriesPage search={await searchParams} />;
}
