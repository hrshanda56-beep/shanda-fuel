import { resolveTenantReadAuthority } from '../context/read-authority';
import 'server-only';
import {
  getDailyOperationsFromRequest,
  getDashboardSalesFromRequest,
  getManagementReportFromRequest,
} from '../reporting/queries';
import { buildFinanceTiles } from '../reporting/finance-tiles';
import { buildDashboardSnapshot } from '../reporting/dashboard-snapshot';
import { getCustomerAccountsFromRequest } from '../customers/queries';
import { getOperationsOverviewFromRequest } from '../forecourt/operations-overview';
import { withRequestAuthority } from '../tenancy/request-authority';
import { resolveTenantExecutionContext } from '../tenancy/authority';
import { AppError, isAccessRefusal } from '../../platform/errors';

async function section<T>(work: () => Promise<T>, name = 'section') {
  const started = Date.now();
  try {
    const data = await work();
    // Local development only, like the other read-latency lines: which section is slow.
    if (process.env.APP_ENV === 'local')
      console.info(`[dashboard-timing] ${name} ${Date.now() - started}ms`);
    return { status: 'ready' as const, data };
  } catch (error) {
    return isAccessRefusal(error)
      ? { status: 'forbidden' as const }
      : { status: 'error' as const, message: 'This dashboard section could not be loaded.' };
  }
}
export type DashboardInput = {
  tenantId: string;
  stationId?: string;
  /** The period every period figure follows (daily totals, cash, profit, snapshot). */
  fromDate?: string;
  toDate?: string;
  /** The sales chart's own window; when absent it follows the period. */
  chartFromDate?: string;
  chartToDate?: string;
};
export async function getDashboardFromRequest(request: Request, input: DashboardInput) {
  return await withRequestAuthority(async () => {
    if (process.env.CONSOLIDATED_CONTEXT_READS === '1')
      await resolveTenantReadAuthority({ request, tenantId: input.tenantId });
    else await resolveTenantExecutionContext({ request, requestedTenantId: input.tenantId });
    const reportScope = {
      tenantId: input.tenantId,
      ...(input.stationId ? { stationIds: input.stationId } : {}),
    };
    const periodScope = {
      ...reportScope,
      ...(input.fromDate ? { fromDate: input.fromDate } : {}),
      ...(input.toDate ? { toDate: input.toDate } : {}),
    };
    const [daily, customers, operations, chart, report] = await Promise.all([
      section(() => getDailyOperationsFromRequest(request, periodScope), 'daily'),
      section(
        () => getCustomerAccountsFromRequest(request, { tenantId: input.tenantId }),
        'customers',
      ),
      input.stationId
        ? section(
            () =>
              getOperationsOverviewFromRequest(request, {
                tenantId: input.tenantId,
                stationId: input.stationId!,
              }),
            'operations',
          )
        : Promise.resolve(null),
      section(
        () =>
          getDashboardSalesFromRequest(request, {
            ...reportScope,
            fromDate: input.chartFromDate ?? input.fromDate,
            toDate: input.chartToDate ?? input.toDate,
          }),
        'chart',
      ),
      section(() => getManagementReportFromRequest(request, periodScope), 'management-report'),
    ]);
    // One management report feeds both the money tiles and the stock and cash snapshot.
    const finance =
      report.status === 'ready'
        ? { status: 'ready' as const, data: buildFinanceTiles(report.data) }
        : report;
    const snapshot =
      report.status === 'ready'
        ? { status: 'ready' as const, data: buildDashboardSnapshot(report.data) }
        : report;
    return { daily, customers, operations, chart, finance, snapshot };
  });
}
