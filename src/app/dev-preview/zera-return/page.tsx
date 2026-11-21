import { notFound } from 'next/navigation';
import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';
import { PageContainer } from '@/design-system/layout';
import { ZeraReturnWizard } from '@/modules/reporting/zera/ui/zera-return-wizard';
import { recentMonths } from '@/modules/reporting/zera/zera-wizard-checks';

export const metadata = { title: { absolute: 'ZERA return preview · Shanda Fuel' } };

/**
 * The real ZERA return wizard without the signed-in shell (development only). It talks to the normal
 * API routes, so Playwright answers those with its own sample data.
 */
export default function ZeraReturnPreview() {
  if (!isDevOnlySurfaceAvailable()) notFound();
  return (
    <main>
      <PageContainer width="wide">
        <h1>ZERA Monthly Return</h1>
        <ZeraReturnWizard
          tenantId="e2e90000-0000-4000-8000-000000000001"
          stations={[{ id: 'e2e90000-0000-4000-8000-000000000021', name: 'Main Station' }]}
          months={recentMonths('2026-11-21', 3)}
        />
      </PageContainer>
    </main>
  );
}
