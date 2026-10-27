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
import { loadFilterOptions, type FilterOptions } from './read-options';

export type TableReportResult = Readonly<{
  definition: TableReportDefinition;
  fromDate: string;
  toDate: string;
  stationCount: number;
  rows: readonly TableReportRow[];
  /** True when more rows exist than the report shows. */
  truncated: boolean;
  /** Said instead of figures when the choice cannot be answered truthfully. */
  notice: string | null;
  /** Choices for the extra filters this report understands. Empty when exports skip them. */
  filterOptions: FilterOptions;
}>;

/**
 * Runs one table report through the same authorisation as the management report, so it
 * can never include more than the signed-in user may see. Exports need a fresh step-up.
 */
export async function runTableReport(
  request: Request,
  slug: string,
  input: unknown,
  options: { requireStepUp?: boolean; withFilterOptions?: boolean } = {},
): Promise<TableReportResult> {
  const definition = findTableReport(slug);
  const reader = TABLE_REPORT_READERS[slug];
  if (!definition || !reader) throw new AppError('NOT_FOUND', 'That report does not exist');
  const { filters, authority, stations } = await authorizeManagementReportRequest(
    request,
    input,
    definition.audience === 'operational' ? 'report.view' : 'report.finance.view',
  );
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
  const base = {
    definition,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    stationCount: filters.stationIds.length,
  };
  // Whole-organisation figures are never shown for a single station's view.
  if (definition.scope === 'organisation' && filters.stationIds.length > 0) {
    return {
      ...base,
      rows: [],
      truncated: false,
      filterOptions: {},
      notice:
        'These figures are kept for the whole organisation, not by station. Choose all stations to see them.',
    };
  }
  const legalEntityIds = [...new Set(stations.map((station) => station.legalEntityId))].sort();
  const { all, filterOptions } = await withTenantTransaction(context, async (transaction) => ({
    all: await reader(transaction, filters, { legalEntityIds }),
    filterOptions:
      options.withFilterOptions && definition.filters?.length
        ? await loadFilterOptions(transaction, filters.tenantId, definition.filters)
        : {},
  }));
  return {
    definition,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    stationCount: filters.stationIds.length,
    rows: all.slice(0, TABLE_REPORT_ROW_LIMIT),
    truncated: all.length > TABLE_REPORT_ROW_LIMIT,
    notice: null,
    filterOptions,
  };
}
