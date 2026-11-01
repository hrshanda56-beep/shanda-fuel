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
import { useReportActions, type ExportFormat, type ReportActionTarget } from './use-report-actions';
import { categoryLabel, reportsFor, type ReportDefinition } from '../catalog';
import { applyReportFilters, parseReportFilters, resolveReportFilters } from '../filters';
import { REPORT_PERIODS, REPORT_PERIOD_LABELS, businessToday, type ReportPeriod } from '../period';

type RowPeriod = { period: ReportPeriod; customFrom: string; customTo: string };

/** One row per report type. Each row has its own period; stations come from the page filters. */
export function ReportList({
  tenantId,
  financeReports = true,
  canExport = true,
}: {
  tenantId: string;
  financeReports?: boolean;
  canExport?: boolean;
}) {
  const searchParams = useSearchParams();
  const actions = useReportActions();
  const category = parseCategoryParam(searchParams.get('category'));
  const reports = reportsFor(financeReports).filter(
    (report) => !category || report.category === category,
  );
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
          <ReportCategoryFilter financeReports={financeReports} />
        </div>
      </div>
      <ReportActionStatus
        status={actions.status}
        onDismiss={actions.dismiss}
        stepUp={actions.stepUp}
      />
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
              contextSearch={searchParams.toString()}
              stationIds={pageFilters.stationIds}
              rowPeriod={rowPeriod}
              busy={actions.busy}
              canExport={canExport}
              onShare={(target) => void actions.share(target, report.title)}
              onExport={(target, format) => void actions.exportCsv(target, false, format)}
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
  contextSearch,
  stationIds,
  rowPeriod,
  busy,
  canExport,
  onShare,
  onExport,
  onPeriod,
}: {
  report: ReportDefinition;
  tenantId: string;
  contextSearch: string;
  stationIds: readonly string[];
  rowPeriod: RowPeriod;
  busy: boolean;
  canExport: boolean;
  onShare: (target: ReportActionTarget) => void;
  onExport: (target: ReportActionTarget, format: ExportFormat) => void;
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
    new URLSearchParams({
      tenantId,
      ...Object.fromEntries(
        [...new URLSearchParams(contextSearch)].filter(([key]) =>
          ['legalEntityId', 'stationId', 'allStations'].includes(key),
        ),
      ),
    }),
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
                  ...(report.exportable && canExport
                    ? (
                        [
                          ['Download for Excel', 'xlsx'],
                          ['Download PDF', 'pdf'],
                          ['Export CSV', 'csv'],
                        ] as const
                      ).map(([label, format]) => ({
                        kind: 'action' as const,
                        label,
                        onSelect: () => onExport(target, format),
                      }))
                    : []),
                ]
              : []
          }
        />
      </div>
    </li>
  );
}
