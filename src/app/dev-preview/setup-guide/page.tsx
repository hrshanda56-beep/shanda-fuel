import { notFound } from 'next/navigation';
import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';
import { PageContainer } from '@/design-system/layout';
import { StationPreview } from './station-preview';

export const metadata = { title: { absolute: 'Station setup preview · Shanda Fuel' } };

/**
 * The real station page and its setup wizards, without the signed-in shell (development only). It
 * reads and writes through the normal API routes, so Playwright answers those with its own sample
 * data.
 */
export default function SetupGuidePreview() {
  if (!isDevOnlySurfaceAvailable()) notFound();
  return (
    <main>
      <PageContainer width="wide">
        <h1>Set up your station</h1>
        {/* Stands in for the settings card's title, so the headings below it run in order. */}
        <h2>Station setup</h2>
        <StationPreview />
      </PageContainer>
    </main>
  );
}
