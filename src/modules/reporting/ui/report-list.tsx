'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Card } from '../../../design-system/primitives';
import { REPORT_CATALOG, categoryLabel, type ReportDefinition } from '../catalog';
import { applyReportFilters, parseReportFilters, resolveReportFilters } from '../filters';
import { REPORT_PERIODS, REPORT_PERIOD_LABELS, businessToday, type ReportPeriod } from '../period';

type RowPeriod = { period: ReportPeriod; customFrom: string; customTo: string };

/** One row per report type. Each row has its own period; stations come from the page filters. */
export function ReportList({ tenantId }: { tenantId: string }) {
  const searchParams = useSearchParams();
  const pageFilters = useMemo(() => parseReportFilters(searchParams), [searchParams]);
  const [overrides, setOverrides] = useState<Record<string, RowPeriod>>({});

  return (
    <Card as="section" className="panel" aria-labelledby="available-reports-title">
      <div className="panel-heading">
        <h2 id="available-reports-title">Available reports</h2>
      </div>
      <ul className="report-rows">
        {REPORT_CATALOG.map((report) => {
          const rowPeriod: RowPeriod = overrides[report.slug] ?? {
            period: pageFilters.period,
            customFrom: pageFilters.customFrom,
            customTo: pageFilters.customTo,
          };
          return (
            <ReportRow
              key={report.slug}
              report={report}
              tenantId={tenantId}
              stationIds={pageFilters.stationIds}
              rowPeriod={rowPeriod}
              onPeriod={(next) => setOverrides((current) => ({ ...current, [report.slug]: next }))}
            />
          );
        })}
      </ul>
    </Card>
  );
}

function ReportRow({
  report,
  tenantId,
  stationIds,
  rowPeriod,
  onPeriod,
}: {
  report: ReportDefinition;
  tenantId: string;
  stationIds: readonly string[];
  rowPeriod: RowPeriod;
  onPeriod: (next: RowPeriod) => void;
}) {
  const filters = { stationIds, ...rowPeriod };
  const ready = resolveReportFilters(filters, businessToday()) !== null;
  const href = `/reports/${report.slug}?${applyReportFilters(
    new URLSearchParams({ tenantId }),
    filters,
  ).toString()}`;
  const id = `report-${report.slug}`;

  return (
    <li className="report-row">
      <div className="report-row-main">
        {ready ? (
          <Link className="row-link" href={href}>
            {report.title}
          </Link>
        ) : (
          <span className="report-row-title">{report.title}</span>
        )}
        <p className="report-row-description">{report.description}</p>
        <p className="report-row-category">{categoryLabel(report.category)}</p>
      </div>
      <div className="report-row-period">
        <label className="field-label" htmlFor={`${id}-period`}>
          Period
        </label>
        <select
          id={`${id}-period`}
          value={rowPeriod.period}
          onChange={(event) =>
            onPeriod({ ...rowPeriod, period: event.target.value as ReportPeriod })
          }
        >
          {REPORT_PERIODS.map((period) => (
            <option key={period} value={period}>
              {REPORT_PERIOD_LABELS[period]}
            </option>
          ))}
        </select>
        {rowPeriod.period === 'custom' ? (
          <div className="report-row-dates">
            <input
              type="date"
              aria-label={`${report.title}: from`}
              value={rowPeriod.customFrom}
              max={rowPeriod.customTo || undefined}
              onChange={(event) => onPeriod({ ...rowPeriod, customFrom: event.target.value })}
            />
            <input
              type="date"
              aria-label={`${report.title}: to`}
              value={rowPeriod.customTo}
              min={rowPeriod.customFrom || undefined}
              onChange={(event) => onPeriod({ ...rowPeriod, customTo: event.target.value })}
            />
          </div>
        ) : null}
      </div>
      <div className="report-row-actions">
        {ready ? (
          <Link className="button button-secondary" href={href}>
            View
          </Link>
        ) : (
          <button className="button button-secondary" type="button" disabled>
            View
          </button>
        )}
      </div>
    </li>
  );
}
