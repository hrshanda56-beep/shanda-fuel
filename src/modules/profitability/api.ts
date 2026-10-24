import 'server-only';

import { withTenantTransaction } from '../../platform/db/transaction';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { authorizeManagementReportRequest } from '../reporting/queries';
import type { ProfitabilityReport } from './contracts';
import { readCanonicalRevenue, readRestatedCogs } from './query';
import { buildProfitabilityReport } from './report';

/**
 * Authenticated, tenant- and station-scoped profitability read. It reuses the
 * reporting authority (report.view on every requested station; one denial
 * rejects the whole request) and the shared REV1/A12 readers. Expenses are
 * never netted into COGS or margin.
 */
export async function getProfitabilityFromRequest(
  request: Request,
  input: unknown,
): Promise<ProfitabilityReport> {
  const { filters, authority, stations } = await authorizeManagementReportRequest(request, input);
  const [single] = stations;
  const context =
    stations.length === 1 && single
      ? createTrustedTenantTransactionContext({
          ...authority.transaction,
          legalEntityId: single.legalEntityId,
          stationId: single.id,
        })
      : authority.transaction;
  return withTenantTransaction(context, async (transaction) => {
    const [revenue, costing] = await Promise.all([
      readCanonicalRevenue(transaction, filters),
      readRestatedCogs(transaction, filters),
    ]);
    return buildProfitabilityReport({
      tenantId: filters.tenantId,
      stationIds: filters.stationIds,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      revenue,
      costing,
    });
  });
}
