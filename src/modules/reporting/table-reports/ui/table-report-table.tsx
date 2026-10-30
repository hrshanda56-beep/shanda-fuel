'use client';

import { useState } from 'react';
import { Card, EmptyState } from '../../../../design-system/primitives';
import { ShowMore, useShowMore } from '../../../../design-system/show-more';
import { TableScrollRegion } from '../../../../design-system/table';
import type { TableReportDefinition, TableReportRow } from '../definitions';

/** Rows a report shows to start with, and how many each press of Show more adds. */
const FIRST_ROWS = 20;
const MORE_ROWS = 20;

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

/**
 * The report as one plain table. Numbers are shown exactly as the database holds them. Long
 * reports start with the first few rows and grow with "Show more"; the download has every row.
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
  const [shown, setShown] = useShowMore(FIRST_ROWS);
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    // New figures arrived (other dates or stations): start again from the first rows.
    setSeenRows(rows);
    setShown(FIRST_ROWS);
  }
  if (rows.length === 0) {
    return <EmptyState title="Nothing to show" message={definition.emptyMessage} />;
  }
  return (
    <Card as="section" className="panel content-span" aria-label={definition.title}>
      {truncated || rows.length <= FIRST_ROWS ? (
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
            {rows.slice(0, shown).map((row, index) => (
              <tr key={index}>
                {definition.columns.map((column) => (
                  <td
                    key={column.key}
                    data-label={column.label}
                    className={cellClass(column.kind, row[column.key])}
                  >
                    {row[column.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <ShowMore
        shown={shown}
        total={rows.length}
        onChange={setShown}
        first={FIRST_ROWS}
        step={MORE_ROWS}
      />
    </Card>
  );
}
