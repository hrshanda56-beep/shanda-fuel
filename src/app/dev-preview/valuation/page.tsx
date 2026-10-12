import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { ValuationOverview } from '@/modules/costing/ui/valuation-workspace';

import { PREVIEW_CONTEXT_HREF, PREVIEW_INVENTORY_CONTEXT } from './context';

export const metadata = { title: 'Inventory valuation' };

export default function ValuationPreview() {
  return (
    <AppShell>
      <ValuationOverview context={PREVIEW_INVENTORY_CONTEXT} contextHref={PREVIEW_CONTEXT_HREF} />
    </AppShell>
  );
}
