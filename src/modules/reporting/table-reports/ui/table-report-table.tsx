'use client';

import { Card, EmptyState } from '../../../../design-system/primitives';
import { formatDecimal } from '../../../../design-system/formatters';
import { Pagination, usePagination } from '../../../../design-system/pagination';
import { TableScrollRegion } from '../../../../design-system/table';
import type { TableReportDefinition, TableReportRow } from '../definitions';

/** Rows a report shows on each page. Other lists keep the shorter default page. */
export const REPORT_PAGE_SIZE = 20;

/** Longer text (an explanation, a reason) wraps; anything shorter stays on one line. */
const ONE_LINE_MAX = 32;

/**
 * Short values (a date, a station, a status) never wrap, so a row stays one line tall and the
 * footer stays close to the top. A table too wide for the page scrolls inside its own frame.
 */
function cellClass(kind: 'text' | 'number', value: string | null | undefined) {
  if (kind === 'number') return 'numeric';
  return !value || value.length <= ONE_LINE_MAX ? 'cell-nowrap' : undefined;
}

/** A number column gets thousands separators; its digits are never rounded or changed. */
function cellText(kind: 'text' | 'number', value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return kind === 'number' && /^-?\d+(?:\.\d+)?$/.test(value) ? formatDecimal(value) : value;
}

/**
 * The report as one plain table. Numbers are shown with the digits the database holds. Long
 * reports are split into pages; the download has every row.
 */
export function TableReportTable({
  definition,
  rows,
  truncated,
  rowLimit,
}: {
  definition: TableReportDefinition;
  rows: readonly TableReportRow[];
  truncated: boolean;
  /** The most rows a report holds; said on the page when the report was cut short. */
  rowLimit: number;
}) {
  const page = usePagination(rows, { pageSize: REPORT_PAGE_SIZE, resetKey: rows });
  if (rows.length === 0) {
    return <EmptyState title="Nothing to show" message={definition.emptyMessage} />;
  }
  return (
    <Card as="section" className="panel content-span" aria-label={definition.title}>
      {truncated || rows.length <= REPORT_PAGE_SIZE ? (
        <p className="field-hint" role="status">
          {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'row' : 'rows'}
          {truncated
            ? `. Only the first ${rowLimit.toLocaleString('en-US')} are shown; choose fewer days or stations, or download the report.`
            : ''}
        </p>
      ) : null}
      <TableScrollRegion label={`${definition.title} table`}>
        <table className="data-table report-table">
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
            {page.rows.map((row, index) => (
              <tr key={index}>
                {definition.columns.map((column) => (
                  <td
                    key={column.key}
                    data-label={column.label}
                    className={cellClass(column.kind, row[column.key])}
                  >
                    {cellText(column.kind, row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <Pagination slice={page} label="Report pages" noun="rows" />
    </Card>
  );
}
