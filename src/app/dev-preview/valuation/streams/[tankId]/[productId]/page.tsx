import { notFound } from 'next/navigation';
import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { ValuationStreamDetail } from '@/modules/costing/ui/valuation-workspace';

import { PREVIEW_CONTEXT_HREF, PREVIEW_INVENTORY_CONTEXT } from '../../../context';

export const metadata = { title: 'Inventory valuation stream' };

export default async function StreamPreview({
  params,
}: {
  params: Promise<{ tankId: string; productId: string }>;
}) {
  if (!isDevOnlySurfaceAvailable()) notFound();
  const { tankId, productId } = await params;
  return (
    <AppShell
      breadcrumbs={[
        { label: 'Inventory', href: PREVIEW_CONTEXT_HREF },
        { label: 'Valuation stream' },
      ]}
    >
      <ValuationStreamDetail
        context={PREVIEW_INVENTORY_CONTEXT}
        contextHref={PREVIEW_CONTEXT_HREF}
        tankId={tankId}
        productId={productId}
      />
    </AppShell>
  );
}
