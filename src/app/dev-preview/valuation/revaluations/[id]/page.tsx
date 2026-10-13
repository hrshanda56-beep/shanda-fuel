import { notFound } from 'next/navigation';
import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { RevaluationDetail } from '@/modules/costing/ui/valuation-workspace';

import { PREVIEW_CONTEXT_HREF, PREVIEW_INVENTORY_CONTEXT } from '../../context';

export const metadata = { title: 'Inventory revaluation' };

export default async function RevaluationPreview({ params }: { params: Promise<{ id: string }> }) {
  if (!isDevOnlySurfaceAvailable()) notFound();
  const { id } = await params;
  return (
    <AppShell
      breadcrumbs={[{ label: 'Inventory', href: PREVIEW_CONTEXT_HREF }, { label: 'Revaluation' }]}
    >
      <RevaluationDetail
        context={PREVIEW_INVENTORY_CONTEXT}
        contextHref={PREVIEW_CONTEXT_HREF}
        revaluationId={id}
      />
    </AppShell>
  );
}
