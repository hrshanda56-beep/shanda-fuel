import { getReviewAccess } from '@/app/_context/review-access';
import { resolvePageContext } from '@/app/_context/page-context';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { DailyOperationsContextRequired } from '@/modules/forecourt/ui/daily-operations-workspace';
import { ReviewScreen } from '@/modules/forecourt/ui/review-screen';

export const metadata = { title: 'Review figures' };

export default async function ReconciliationReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string; id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stationId, id } = await params;
  const search = (await searchParams) ?? {};
  const businessDayId = typeof search.businessDayId === 'string' ? search.businessDayId : undefined;
  const shiftId = typeof search.shiftId === 'string' ? search.shiftId : undefined;
  const context = await resolvePageContext(
    `/stations/${stationId}/reconciliations/${id}/review`,
    search,
  );
  const access = context
    ? await getReviewAccess(context.tenantId, stationId)
    : { canApprove: false, membershipId: null };

  return (
    <AppShell
      breadcrumbs={[
        { label: 'Reconciliations', href: `/stations/${stationId}/reconciliations` },
        { label: 'Review figures' },
      ]}
    >
      {context && businessDayId && shiftId ? (
        <ReviewScreen
          context={{
            tenantId: context.tenantId,
            stationId,
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
