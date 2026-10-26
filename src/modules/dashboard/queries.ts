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

async function section<T>(work: () => Promise<T>) {
  try {
    return { status: 'ready' as const, data: await work() };
  } catch (error) {
    return isAccessRefusal(error)
      ? { status: 'forbidden' as const }
      : { status: 'error' as const, message: 'This dashboard section could not be loaded.' };
  }
}
export type DashboardInput = {
  tenantId: string;
  stationId?: string;
  fromDate?: string;
  toDate?: string;
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
    const [daily, customers, operations, chart, report] = await Promise.all([
      section(() => getDailyOperationsFromRequest(request, reportScope)),
      section(() => getCustomerAccountsFromRequest(request, { tenantId: input.tenantId })),
      input.stationId
        ? section(() =>
            getOperationsOverviewFromRequest(request, {
              tenantId: input.tenantId,
              stationId: input.stationId!,
            }),
          )
        : Promise.resolve(null),
      section(() =>
        getDashboardSalesFromRequest(request, {
          ...reportScope,
          fromDate: input.fromDate,
          toDate: input.toDate,
        }),
      ),
      section(() =>
        getManagementReportFromRequest(request, {
          ...reportScope,
          fromDate: input.fromDate,
          toDate: input.toDate,
        }),
      ),
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
