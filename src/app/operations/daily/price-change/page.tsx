import { ServerPriceChange } from '@/modules/forecourt/server-price-change';

export const metadata = { title: 'Change a price' };
export const dynamic = 'force-dynamic';

export default async function PriceChangePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ServerPriceChange search={await searchParams} />;
}
