'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { parseCategoryParam } from '../rail';
import { Dropdown } from '../../../design-system/dropdown';
import { Icon } from '../../../design-system/icons';
import { Card } from '../../../design-system/primitives';
import { CATEGORY_ICONS } from './report-icons';
import { ReportCategoryFilter, ReportsFilters } from './reports-filters';
import { ReportActionMenu } from './report-action-menu';
import { ReportActionStatus } from './report-action-status';
import { useReportActions, type ReportActionTarget } from './use-report-actions';
import { REPORT_CATALOG, categoryLabel, type ReportDefinition } from '../catalog';
import { applyReportFilters, parseReportFilters, resolveReportFilters } from '../filters';
import { REPORT_PERIODS, REPORT_PERIOD_LABELS, businessToday, type ReportPeriod } from '../period';

type RowPeriod = { period: ReportPeriod; customFrom: string; customTo: string };

/** One row per report type. Each row has its own period; stations come from the page filters. */
export function ReportList({ tenantId }: { tenantId: string }) {
  const searchParams = useSearchParams();
  const actions = useReportActions();
  const category = parseCategoryParam(searchParams.get('category'));
  const reports = REPORT_CATALOG.filter((report) => !category || report.category === category);
  const pageFilters = useMemo(() => parseReportFilters(searchParams), [searchParams]);
  const [overrides, setOverrides] = useState<Record<string, RowPeriod>>({});

  return (
    <Card as="section" className="panel" aria-labelledby="available-reports-title">
      <div className="panel-heading">
        <div className="report-heading-main">
          <h2 id="available-reports-title">Available reports</h2>
          <span className="report-count">
            {reports.length} {reports.length === 1 ? 'report' : 'reports'}
          </span>
        </div>
        <div className="report-heading-tools">
          <ReportsFilters tenantId={tenantId} />
          <ReportCategoryFilter />
        </div>
      </div>
      <ReportActionStatus status={actions.status} onDismiss={actions.dismiss} />
      <ul className="report-rows">
        {reports.map((report) => {
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
              busy={actions.busy}
              onShare={(target) => void actions.share(target, report.title)}
              onExport={(target) => void actions.exportCsv(target)}
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
  busy,
  onShare,
  onExport,
  onPeriod,
}: {
  report: ReportDefinition;
  tenantId: string;
  stationIds: readonly string[];
  rowPeriod: RowPeriod;
  busy: boolean;
  onShare: (target: ReportActionTarget) => void;
  onExport: (target: ReportActionTarget) => void;
  onPeriod: (next: RowPeriod) => void;
}) {
  const filters = { stationIds, ...rowPeriod };
  const range = resolveReportFilters(filters, businessToday());
  const ready = range !== null;
  const target: ReportActionTarget | null = range
    ? {
        tenantId,
        slug: report.slug,
        stationIds,
        period: rowPeriod.period,
        fromDate: range.fromDate,
        toDate: range.toDate,
      }
    : null;
  const href = `/reports/${report.slug}?${applyReportFilters(
    new URLSearchParams({ tenantId }),
    filters,
  ).toString()}`;
  const id = `report-${report.slug}`;

  return (
    <li className="report-row">
      <span className="report-tile" aria-hidden="true">
        <Icon name={CATEGORY_ICONS[report.category]} size="md" />
      </span>
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
        <Dropdown
          id={`${id}-period`}
          align="end"
          value={rowPeriod.period}
          options={REPORT_PERIODS.map((period) => ({
            value: period,
            label: REPORT_PERIOD_LABELS[period],
          }))}
          onValueChange={(period) => onPeriod({ ...rowPeriod, period: period as ReportPeriod })}
        />
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
        <ReportActionMenu
          reportTitle={report.title}
          disabled={!target || busy}
          items={
            target
              ? [
                  { kind: 'link', label: 'View', href },
                  { kind: 'action', label: 'Share private link', onSelect: () => onShare(target) },
                  ...(report.exportable
                    ? [
                        {
                          kind: 'action' as const,
                          label: 'Export CSV',
                          onSelect: () => onExport(target),
                        },
                      ]
                    : []),
                ]
              : []
          }
        />
      </div>
    </li>
  );
}
