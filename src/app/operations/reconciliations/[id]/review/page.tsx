import { getReviewAccess } from '@/app/_context/review-access';
import { resolvePageContext } from '@/app/_context/page-context';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { DailyOperationsContextRequired } from '@/modules/forecourt/ui/daily-operations-workspace';
import { ReviewScreen } from '@/modules/forecourt/ui/review-screen';

export const metadata = { title: 'Review figures' };

export default async function OperationsReconciliationReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const businessDayId = typeof search.businessDayId === 'string' ? search.businessDayId : undefined;
  const shiftId = typeof search.shiftId === 'string' ? search.shiftId : undefined;
  const context = await resolvePageContext(`/operations/reconciliations/${id}/review`, search, {
    needsStation: true,
  });
  const ready = context?.stationId && businessDayId && shiftId ? context : null;
  const access = ready?.stationId
    ? await getReviewAccess(ready.tenantId, ready.stationId)
    : { canApprove: false, membershipId: null };

  return (
    <AppShell
      breadcrumbs={[
        { label: 'Operations', href: '/operations/daily' },
        { label: 'Review figures' },
      ]}
    >
      {ready?.stationId && businessDayId && shiftId ? (
        <ReviewScreen
          context={{
            tenantId: ready.tenantId,
            stationId: ready.stationId,
            businessDayId,
            shiftId,
            reconciliationId: id,
          }}
          canApprove={access.canApprove}
          membershipId={access.membershipId}
        />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
