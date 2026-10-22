import { notFound } from 'next/navigation';
import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';
import { V1PanelsPreviewClient } from './v1-panels-client';

export const metadata = { title: { absolute: 'New screens preview · Shanda Fuel' } };

/**
 * The cash handover card, activity log, document attachments and reminder settings without the
 * signed-in shell (development only). They read and write through the normal API routes, so
 * Playwright answers those with its own sample data.
 */
export default function V1PanelsPreview() {
  if (!isDevOnlySurfaceAvailable()) notFound();
  return <V1PanelsPreviewClient />;
}
