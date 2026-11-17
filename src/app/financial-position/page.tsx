import { redirect } from 'next/navigation';
import type { PageSearch } from '@/modules/context/server-page';

/** The financial position is now a tab on the Profits page; old links and bookmarks land there. */
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  params.set('view', 'position');
  redirect(`/profitability?${params.toString()}`);
}
