import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getDailyOperationsFromRequest,
  getDashboardSalesFromRequest,
} from '../../../modules/reporting/queries';
import { getCustomerAccountsFromRequest } from '../../../modules/customers/queries';
import { getOperationsOverviewFromRequest } from '../../../modules/forecourt/operations-overview';
import { withRequestAuthority } from '../../../modules/tenancy/request-authority';
import { resolveTenantExecutionContext } from '../../../modules/tenancy/authority';
import { apiErrorResponse, withRequestObservability } from '../../../platform/observability';
import { AppError } from '../../../platform/errors';

export const runtime = 'nodejs';
const query = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
async function section<T>(work: () => Promise<T>) {
  try {
    return { status: 'ready' as const, data: await work() };
  } catch (error) {
    return error instanceof AppError && error.code === 'FORBIDDEN'
      ? { status: 'forbidden' as const }
      : { status: 'error' as const, message: 'This dashboard section could not be loaded.' };
  }
}
export const GET = withRequestObservability(async (request: Request) => {
  try {
    const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    return await withRequestAuthority(async () => {
      await resolveTenantExecutionContext({ request, requestedTenantId: input.tenantId });
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
      return NextResponse.json(
        { daily, customers, operations, chart },
        { headers: { 'cache-control': 'no-store' } },
      );
    });
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: false });
  }
});
