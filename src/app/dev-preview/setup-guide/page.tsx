import { notFound } from 'next/navigation';
import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';
import { PageContainer } from '@/design-system/layout';
import { GuidedSetupPanel } from '../../../modules/setup/ui/guided-setup-panel';

export const metadata = { title: { absolute: 'Station setup preview · Shanda Fuel' } };

/**
 * The real guided station setup, without the signed-in shell (development only). It reads and
 * writes through the normal API routes, so Playwright answers those with its own sample data.
 */
export default function SetupGuidePreview() {
  if (!isDevOnlySurfaceAvailable()) notFound();
  return (
    <main>
      <PageContainer width="wide">
        <h1>Set up your station</h1>
        <GuidedSetupPanel />
      </PageContainer>
    </main>
  );
}
