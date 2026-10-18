import { notFound } from 'next/navigation';
import { ServerReportDetail } from '@/modules/reporting/server-pages';
import { findReport } from '@/modules/reporting/catalog';
import type { PageSearch } from '@/modules/context/server-page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<PageSearch>;
}) {
  const report = findReport((await params).slug);
  if (!report) notFound();
  return <ServerReportDetail search={await searchParams} view={report.slug} />;
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: findReport((await params).slug)?.title ?? 'Reports' };
}
