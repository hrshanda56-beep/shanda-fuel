import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getPurchasingCapabilitiesFromRequest } from '@/modules/purchasing/capabilities';
import { PurchaseOrderDetail } from '@/modules/purchasing/ui/purchase-order-detail';
export const metadata = { title: 'Purchase order' };
export default async function Page({
  searchParams,
  params,
}: {
  searchParams: Promise<PageSearch>;
  params: Promise<{ purchaseOrderId: string }>;
}) {
  const { purchaseOrderId } = await params;
  const search = await searchParams;
  return (
    <ServerDataPage
      pathname={`/purchasing/${purchaseOrderId}`}
      search={search}
      fallback={
        <ContextRequiredState
          title="Choose a work context"
          message="Use the selector above to choose a company."
        />
      }
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.legalEntityId) return null;
        return getPurchasingCapabilitiesFromRequest(request, current.organisationId);
      }}
      render={(capabilities, resolution) =>
        capabilities ? (
          <PurchaseOrderDetail
            key={JSON.stringify(resolution.current) + purchaseOrderId}
            purchaseOrderId={purchaseOrderId}
            resolution={resolution}
            capabilities={capabilities}
          />
        ) : (
          <ContextRequiredState
            title="Choose a company"
            message="Use the selector above to choose the company this order belongs to."
          />
        )
      }
    />
  );
}
