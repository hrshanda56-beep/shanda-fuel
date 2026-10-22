import 'server-only';

import { assertStepUp } from '../../../platform/security';
import { AppError } from '../../../platform/errors';
import { withTenantTransaction } from '../../../platform/db/transaction';
import { createTrustedTenantTransactionContext } from '../../../platform/db/tenant-context';
import { authorizeManagementReportRequest } from '../queries';
import {
  TABLE_REPORT_ROW_LIMIT,
  findTableReport,
  type TableReportDefinition,
  type TableReportRow,
} from './definitions';
import { TABLE_REPORT_READERS } from './read';

export type TableReportResult = Readonly<{
  definition: TableReportDefinition;
  fromDate: string;
  toDate: string;
  stationCount: number;
  rows: readonly TableReportRow[];
  /** True when more rows exist than the report shows. */
  truncated: boolean;
}>;

/**
 * Runs one table report through the same authorisation as the management report, so it
 * can never include more than the signed-in user may see. Exports need a fresh step-up.
 */
export async function runTableReport(
  request: Request,
  slug: string,
  input: unknown,
  options: { requireStepUp?: boolean } = {},
): Promise<TableReportResult> {
  const definition = findTableReport(slug);
  const reader = TABLE_REPORT_READERS[slug];
  if (!definition || !reader) throw new AppError('NOT_FOUND', 'That report does not exist');
  const { filters, authority, stations } = await authorizeManagementReportRequest(request, input);
  if (options.requireStepUp) {
    assertStepUp(authority.actor.session, 1, new Date(), filters.tenantId);
  }
  const [single] = stations;
  const context =
    stations.length === 1 && single
      ? createTrustedTenantTransactionContext({
          ...authority.transaction,
          legalEntityId: single.legalEntityId,
          stationId: single.id,
        })
      : authority.transaction;
  const all = await withTenantTransaction(context, (transaction) => reader(transaction, filters));
  return {
    definition,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    stationCount: filters.stationIds.length,
    rows: all.slice(0, TABLE_REPORT_ROW_LIMIT),
    truncated: all.length > TABLE_REPORT_ROW_LIMIT,
  };
}
