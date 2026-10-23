import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState, EmptyState } from '@/design-system/primitives';
import { getSupplierDueScheduleFromRequest } from '@/modules/creditors/due-schedule-queries';
import { SupplierDueView } from '@/modules/creditors/ui/supplier-due-view';

export const metadata = { title: 'Supplier payments due' };

export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) query.set(key, first);
  }
  return (
    <ServerDataPage
      pathname="/suppliers/due"
      search={search}
      fallback={<EmptyState title="Supplier payments due" message="Loading your work context." />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.legalEntityId) return null;
        return getSupplierDueScheduleFromRequest(request, {
          tenantId: current.organisationId,
          legalEntityId: current.legalEntityId,
        });
      }}
      render={(data, resolution) =>
        data && resolution.current ? (
          <SupplierDueView data={data} selection={resolution.current} search={query.toString()} />
        ) : (
          <ContextRequiredState
            title="Choose a work context"
            message="Use the selector above to choose a company."
          />
        )
      }
    />
  );
}
