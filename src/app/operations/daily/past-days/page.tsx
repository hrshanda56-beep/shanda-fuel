import { ServerPastDays } from '@/modules/forecourt/server-past-days';

export const metadata = { title: 'Record a past day' };
export const dynamic = 'force-dynamic';

export default async function PastDaysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ServerPastDays search={await searchParams} />;
}
