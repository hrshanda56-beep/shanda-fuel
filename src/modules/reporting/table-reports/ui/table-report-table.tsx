import { Card, EmptyState } from '../../../../design-system/primitives';
import { TableScrollRegion } from '../../../../design-system/table';
import type { TableReportDefinition, TableReportRow } from '../definitions';
import { TABLE_REPORT_ROW_LIMIT } from '../definitions';

/** The report as one plain table. Numbers are shown exactly as the database holds them. */
export function TableReportTable({
  definition,
  rows,
  truncated,
}: {
  definition: TableReportDefinition;
  rows: readonly TableReportRow[];
  truncated: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState title="Nothing to show" message={definition.emptyMessage} />;
  }
  return (
    <Card as="section" className="panel content-span" aria-label={definition.title}>
      <p className="field-hint" role="status">
        {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'row' : 'rows'}
        {truncated
          ? `. Only the first ${TABLE_REPORT_ROW_LIMIT.toLocaleString('en-US')} are shown; choose fewer days or stations, or download the report.`
          : ''}
      </p>
      <TableScrollRegion label={`${definition.title} table`}>
        <table className="data-table">
          <caption className="visually-hidden">{definition.title}</caption>
          <thead>
            <tr>
              {definition.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.kind === 'number' ? 'numeric' : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {definition.columns.map((column) => (
                  <td key={column.key} className={column.kind === 'number' ? 'numeric' : undefined}>
                    {row[column.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
    </Card>
  );
}
