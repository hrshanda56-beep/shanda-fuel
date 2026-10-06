'use client';

import { useEffect, useState } from 'react';

import { formatMoney } from '../../../design-system/formatters';
import { MetricCard } from '../../../design-system/layout';
import { ContextRequiredState, ErrorState, LoadingState } from '../../../design-system/primitives';
import type { ManagementReport } from '../contracts';

type DashboardState =
  | { status: 'loading' }
  | { status: 'ready'; report: ManagementReport }
  | { status: 'error'; message: string };

export type OperationsDashboardMetrics = Readonly<{
  sales: string;
  expectedCash: string;
  actualCash: string;
  cashVariance: string;
  fuelStockVariance: string;
  accountCreditSales: string;
  unresolvedExceptions: 'Unavailable';
  shiftCloseStatus: 'Unavailable';
}>;

export function selectOperationsDashboardMetrics(
  report: ManagementReport,
): OperationsDashboardMetrics {
  const accountCreditSales = report.sales.payments.find(
    (payment) => payment.method === 'CUSTOMER_CREDIT',
  );

  return {
    sales: formatMoney(report.sales.salesValue),
    expectedCash: formatMoney(report.cash.cashEvidence),
    actualCash: formatMoney(report.cash.collected),
    cashVariance: formatMoney(report.cash.cashVariance),
    fuelStockVariance: report.inventory.varianceLitres,
    accountCreditSales: formatMoney(accountCreditSales?.amount ?? '0'),
    unresolvedExceptions: 'Unavailable',
    shiftCloseStatus: 'Unavailable',
  };
}

function todayInHarare(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(new Date());
}

function reportHref(tenantId: string, stationId?: string): string {
  const query = new URLSearchParams({ tenantId });
  if (stationId) query.set('stationId', stationId);
  return `/reports?${query.toString()}`;
}

export function OperationsDashboard({
  tenantId,
  stationId,
}: {
  tenantId?: string;
  stationId?: string;
}) {
  const [state, setState] = useState<DashboardState>({ status: 'loading' });

  useEffect(() => {
    if (!tenantId) return;

    const controller = new AbortController();
    const today = todayInHarare();
    const query = new URLSearchParams({ tenantId, fromDate: today, toDate: today });
    if (stationId) query.set('stationId', stationId);

    fetch(`/api/reports/management?${query.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          ManagementReport | { message?: string } | null;
        if (!response.ok || !body || !('report' in body)) {
          throw new Error(
            body && 'message' in body && body.message
              ? body.message
              : 'Today’s operational facts could not be loaded.',
          );
        }
        return body;
      })
      .then((report) => setState({ status: 'ready', report }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message: cause instanceof Error ? cause.message : 'The dashboard is unavailable.',
          });
        }
      });

    return () => controller.abort();
  }, [stationId, tenantId]);

  if (!tenantId) {
    return (
      <ContextRequiredState
        title="Tenant context required"
        message="Choose an authorised organisation or station from the shared work-context selector before loading today’s operational facts."
      />
    );
  }

  if (state.status === 'loading') return <LoadingState label="Loading today’s operations" />;
  if (state.status === 'error') {
    return <ErrorState title="Today’s dashboard unavailable" message={state.message} />;
  }

  const metrics = selectOperationsDashboardMetrics(state.report);
  const href = reportHref(tenantId, stationId);

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operational control</p>
          <h1>Today’s dashboard</h1>
          <p className="lede">
            Posted operational facts for the current authorised work context. Unsupported source
            states remain unavailable rather than being inferred.
          </p>
        </div>
      </div>

      <section aria-labelledby="operations-headline-metrics">
        <h2 id="operations-headline-metrics" className="visually-hidden">
          Today’s operational headline metrics
        </h2>
        <div className="metric-grid">
          <MetricCard
            label="Today’s total sales"
            value={metrics.sales}
            meta="Posted accounted sales"
            href={href}
          />
          <MetricCard
            label="Expected cash"
            value={metrics.expectedCash}
            meta="Cash declared in posted reconciliations"
            href={href}
          />
          <MetricCard
            label="Actual cash"
            value={metrics.actualCash}
            meta="Collected cash evidence"
            href={href}
          />
          <MetricCard
            label="Cash variance"
            value={metrics.cashVariance}
            meta="Posted reconciliation variance"
            href={href}
          />
          <MetricCard
            label="Fuel / stock variance"
            value={`${metrics.fuelStockVariance} L`}
            meta="Inventory position variance"
            href={href}
          />
          <MetricCard
            label="Account / credit sales"
            value={metrics.accountCreditSales}
            meta="CUSTOMER_CREDIT payment evidence"
            href={href}
          />
          <MetricCard
            label="Unresolved exceptions"
            value={metrics.unresolvedExceptions}
            meta="Authoritative exception feed unavailable"
          />
          <MetricCard
            label="Shift approval / close"
            value={metrics.shiftCloseStatus}
            meta="Authoritative close state unavailable"
          />
        </div>
      </section>
    </div>
  );
}
