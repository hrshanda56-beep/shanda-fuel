import { notFound } from 'next/navigation';
import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';
import { V1PanelsPreviewClient } from './v1-panels-client';

export const metadata = { title: { absolute: 'New screens preview · Shanda Fuel' } };

/**
 * The cash handover card, activity log, document attachments and reminder settings without the
 * signed-in shell (development only). They read and write through the normal API routes, so
 * Playwright answers those with its own sample data.
 */
export default async function V1PanelsPreview({
  searchParams,
}: {
  searchParams: Promise<{ sheet?: string }>;
}) {
  if (!isDevOnlySurfaceAvailable()) notFound();
  const { sheet } = await searchParams;
  // `?sheet=closed` leaves the handover sheet shut so the panels behind it can be used.
  return <V1PanelsPreviewClient handoverOpen={sheet !== 'closed'} />;
}
