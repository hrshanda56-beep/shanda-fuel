import { resolveTenantReadAuthority } from '../context/read-authority';
import 'server-only';
import { getDailyOperationsFromRequest, getDashboardSalesFromRequest } from '../reporting/queries';
import { getCustomerAccountsFromRequest } from '../customers/queries';
import { getOperationsOverviewFromRequest } from '../forecourt/operations-overview';
import { withRequestAuthority } from '../tenancy/request-authority';
import { resolveTenantExecutionContext } from '../tenancy/authority';
import { AppError } from '../../platform/errors';

async function section<T>(work: () => Promise<T>) {
  try {
    return { status: 'ready' as const, data: await work() };
  } catch (error) {
    return error instanceof AppError && error.code === 'FORBIDDEN'
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
    const [daily, customers, operations, chart] = await Promise.all([
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
    ]);
    return { daily, customers, operations, chart };
  });
}
