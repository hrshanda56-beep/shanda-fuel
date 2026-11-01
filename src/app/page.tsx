import { resolveAvailableContext } from '@/modules/context/resolution';
import { contextRoutePolicy, readContextRoute } from '@/modules/context/routes';
import { readPersistedContext } from '@/modules/context/persistence';
import { ErrorState } from '@/design-system/primitives';
import { Suspense } from 'react';
import { getDashboardFromRequest } from '@/modules/dashboard/queries';
import {
  getServerShellAccessForResolution,
  requestFromHeaders,
} from '@/design-system/navigation-server';
import { chartBuckets } from './_overview/dashboard-figures';
import { businessToday } from '@/modules/reporting/period';
import { requireAuthenticatedActor } from '@/modules/identity';
import type { AvailableContext } from '@/modules/context/contracts';
import { buildActionCenter } from '@/modules/approvals/action-center-model';
import { loadActionCenterFacts } from '@/modules/approvals/action-center';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { getServerShellAccess } from '@/design-system/navigation-server';

import { TodayOverview } from './_overview/today-overview';
import { resolveDashboardPeriod, type ResolvedDashboardPeriod } from './_overview/dashboard-period';
import {
  dashboardScopeFromCurrentContext,
  type AttentionRow,
} from './_overview/today-overview-model';

export const metadata = {
  title: { absolute: 'Dashboard · Shanda Fuel' },
};

/** Today for the selected station: daily operations and anything needing attention. */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    tenantId?: string;
    legalEntityId?: string;
    stationId?: string;
    allStations?: string;
    period?: string;
    fromDate?: string;
    toDate?: string;
  }>;
}) {
  const { tenantId, legalEntityId, stationId, allStations, period, fromDate, toDate } =
    await searchParams;
  // One period for every period figure on the page; Today unless the person chose another (B1).
  const dashboardPeriod = resolveDashboardPeriod({ period, fromDate, toDate }, businessToday());

  // Someone whose permissions are only shift and meter work lands on My Shift
  // instead of an empty management dashboard. Decided from resolved permissions.
  const requestHeaders = await headers();
  let access = await getServerShellAccess(requestHeaders);
  let validatedContext: ReturnType<typeof dashboardScopeFromCurrentContext>;
  const request = requestFromHeaders(requestHeaders);
  if (access.status === 'ready' && access.resolution && request) {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (legalEntityId) params.set('legalEntityId', legalEntityId);
    if (stationId) params.set('stationId', stationId);
    if (allStations !== undefined) params.set('allStations', allStations);
    try {
      const resolution = resolveAvailableContext(
        access.resolution.available,
        readContextRoute('/', params),
        contextRoutePolicy('/'),
        readPersistedContext(request),
      );
      validatedContext = dashboardScopeFromCurrentContext(resolution.current);
      access = await getServerShellAccessForResolution(request, access, resolution);
    } catch {
      return (
        <AppShell shellAccess={access}>
          <ErrorState
            title="Work context unavailable"
            message="Choose an authorized work context using the selector above."
          />
        </AppShell>
      );
    }
  }

  if (
    access.status === 'ready' &&
    access.projection?.some((entry) => entry.key === 'my-shift' && entry.visible)
  ) {
    const query = new URLSearchParams();
    if (tenantId) query.set('tenantId', tenantId);
    if (legalEntityId) query.set('legalEntityId', legalEntityId);
    if (stationId) query.set('stationId', stationId);
    if (allStations !== undefined) query.set('allStations', allStations);
    const search = query.toString();
    redirect(search ? `/my-shift?${search}` : '/my-shift');
  }

  // Finance sign-off work without running the day lands on the Finance overview.
  if (
    access.status === 'ready' &&
    access.projection?.some((entry) => entry.key === 'finance-home' && entry.visible && entry.home)
  ) {
    const query = new URLSearchParams();
    if (tenantId) query.set('tenantId', tenantId);
    if (legalEntityId) query.set('legalEntityId', legalEntityId);
    if (stationId) query.set('stationId', stationId);
    if (allStations !== undefined) query.set('allStations', allStations);
    const search = query.toString();
    redirect(search ? `/finance?${search}` : '/finance');
  }

  const initialContext =
    access.status === 'ready' && !tenantId
      ? dashboardScopeFromCurrentContext(access.current)
      : undefined;

  return (
    <AppShell searchPlacement="header" shellAccess={access}>
      <Suspense
        key={JSON.stringify([
          validatedContext ?? [tenantId, stationId],
          dashboardPeriod.period,
          dashboardPeriod.fromDate,
          dashboardPeriod.toDate,
        ])}
        fallback={<p role="status">Loading dashboard…</p>}
      >
        <DashboardContent
          request={
            access.status === 'ready' && access.resolution
              ? requestFromHeaders(requestHeaders)
              : null
          }
          tenantId={validatedContext?.tenantId ?? tenantId}
          legalEntityId={validatedContext?.legalEntityId ?? legalEntityId}
          stationId={validatedContext ? validatedContext.stationId : stationId}
          initialContext={initialContext}
          available={access.status === 'ready' ? access.resolution?.available : undefined}
          period={dashboardPeriod}
        />
      </Suspense>
    </AppShell>
  );
}

async function DashboardContent({
  request,
  tenantId,
  legalEntityId,
  stationId,
  initialContext,
  available,
  period,
}: {
  request: Request | null;
  tenantId?: string;
  legalEntityId?: string;
  stationId?: string;
  initialContext?: { tenantId: string; legalEntityId?: string; stationId?: string };
  available?: AvailableContext;
  period: ResolvedDashboardPeriod;
}) {
  const scope = tenantId ? { tenantId, legalEntityId, stationId } : initialContext;
  if (!request || !scope?.tenantId)
    return (
      <TodayOverview
        tenantId={tenantId}
        legalEntityId={legalEntityId}
        stationId={stationId}
        initialContext={initialContext}
      />
    );
  // The chart keeps its own 30-day window; everything else follows the chosen period.
  const chartWindow = chartBuckets('30D', businessToday());
  const data = await getDashboardFromRequest(request, {
    ...scope,
    fromDate: period.fromDate,
    toDate: period.toDate,
    chartFromDate: chartWindow.fromDate,
    chartToDate: chartWindow.toDate,
  });
  const work = await loadWorkItems(request, scope, available);
  return (
    <TodayOverview
      key={`${scope.tenantId}|${scope.stationId ?? ''}|${period.period}|${period.fromDate}|${period.toDate}`}
      workItems={work.items}
      workMore={work.more}
      workUnavailable={work.unavailable}
      tenantId={scope.tenantId}
      legalEntityId={scope.legalEntityId}
      stationId={scope.stationId}
      initialData={{
        ...data,
        key: `${scope.tenantId}|${scope.stationId ?? ''}|30D`,
        period,
        asOf: new Date().toISOString(),
      }}
    />
  );
}

/**
 * Approvals, banking and payables waiting for a person, from the same list the Finance page
 * shows, so "Needs attention" never says all clear while a report waits for approval. With no
 * station chosen it looks at every live station of the company and names the station.
 */
async function loadWorkItems(
  request: Request,
  scope: { tenantId: string; legalEntityId?: string; stationId?: string },
  available?: AvailableContext,
): Promise<{ items: AttentionRow[]; more: number; unavailable: boolean }> {
  const entities =
    available?.organisations
      .find((organisation) => organisation.id === scope.tenantId)
      ?.legalEntities.filter(
        (entity) => !scope.legalEntityId || entity.id === scope.legalEntityId,
      ) ?? [];
  const targets = scope.stationId
    ? [{ legalEntityId: scope.legalEntityId, stationId: scope.stationId, name: null }]
    : entities.flatMap((entity) =>
        entity.stations
          .filter((station) => station.status !== 'ONBOARDING')
          .map((station) => ({
            legalEntityId: entity.id,
            stationId: station.id,
            name: station.name as string | null,
          })),
      );
  if (targets.length === 0) return { items: [], more: 0, unavailable: false };
  try {
    const actor = await requireAuthenticatedActor(request);
    const results = await Promise.all(
      targets.map(async (target) => {
        const center = buildActionCenter(
          await loadActionCenterFacts(
            request,
            {
              organisationId: scope.tenantId,
              ...(target.legalEntityId ? { legalEntityId: target.legalEntityId } : {}),
              stationId: target.stationId,
              allStations: false,
            },
            actor,
          ),
        );
        return {
          unavailable: center.unavailable.length > 0,
          items: center.items
            .filter((item) => item.area !== 'Operations')
            .map((item) => {
              // What a company owes or is owed is the same whichever station is asked.
              const shared = item.area === 'Payables' || item.area === 'Receivables';
              return {
                id: shared ? `work-${item.id}` : `work-${target.stationId}-${item.id}`,
                title: target.name && !shared ? `${target.name}: ${item.title}` : item.title,
                detail: item.detail,
                href: item.href,
              };
            }),
        };
      }),
    );
    const all = [
      ...new Map(results.flatMap((result) => result.items).map((item) => [item.id, item])).values(),
    ];
    return {
      items: all.slice(0, 6),
      more: Math.max(0, all.length - 6),
      unavailable: results.some((result) => result.unavailable),
    };
  } catch {
    return { items: [], more: 0, unavailable: true };
  }
}
