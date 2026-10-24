import { csvCell } from '../export-csv';
import type { TableReportDefinition, TableReportRow } from './definitions';

export function buildTableReportCsv(
  definition: TableReportDefinition,
  rows: readonly TableReportRow[],
): string {
  const lines = [definition.columns.map((column) => csvCell(column.label)).join(',')];
  for (const row of rows) {
    lines.push(
      definition.columns.map((column) => csvCell(row[column.key] ?? null, column.kind)).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
