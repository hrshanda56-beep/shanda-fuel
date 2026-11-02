'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { parseCategoryParam } from '../rail';
import { Icon } from '../../../design-system/icons';
import { Card } from '../../../design-system/primitives';
import { CATEGORY_ICONS } from './report-icons';
import { ReportCategoryFilter, ReportsFilters } from './reports-filters';
import { ReportActionMenu } from './report-action-menu';
import { ReportActionStatus } from './report-action-status';
import { ReportPeriodDialog, type RowPeriod } from './report-period-dialog';
import { useReportActions, type ExportFormat, type ReportActionTarget } from './use-report-actions';
import { categoryLabel, reportsFor, type ReportDefinition } from '../catalog';
import { applyReportFilters, parseReportFilters, resolveReportFilters } from '../filters';
import { businessToday } from '../period';

/** What the person chose to do with a report; the period is chosen next. */
type RowAction = { kind: 'view' } | { kind: 'share' } | { kind: 'export'; format: ExportFormat };

const EXPORT_LABELS: Record<ExportFormat, string> = {
  xlsx: 'Download for Excel',
  pdf: 'Download PDF',
  csv: 'Export CSV',
};

function confirmLabel(action: RowAction): string {
  if (action.kind === 'view') return 'Open report';
  if (action.kind === 'share') return 'Create link';
  return EXPORT_LABELS[action.format];
}

/**
 * One row per report type. A row offers what you can do (open, share, download); once an action
 * is chosen a small dialog asks for the period. Stations come from the page filters.
 */
export function ReportList({
  tenantId,
  financeReports = true,
}: {
  tenantId: string;
  financeReports?: boolean;
}) {
  const searchParams = useSearchParams();
  const actions = useReportActions();
  const category = parseCategoryParam(searchParams.get('category'));
  const reports = reportsFor(financeReports).filter(
    (report) => !category || report.category === category,
  );
  const pageFilters = useMemo(() => parseReportFilters(searchParams), [searchParams]);

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
        {reports.map((report) => (
          <ReportRow
            key={report.slug}
            report={report}
            tenantId={tenantId}
            contextSearch={searchParams.toString()}
            stationIds={pageFilters.stationIds}
            defaultPeriod={{
              period: pageFilters.period,
              customFrom: pageFilters.customFrom,
              customTo: pageFilters.customTo,
            }}
            busy={actions.busy}
            onShare={(target) => void actions.share(target, report.title)}
            onExport={(target, format) => void actions.exportCsv(target, false, format)}
          />
        ))}
      </ul>
    </Card>
  );
}

function ReportRow({
  report,
  tenantId,
  contextSearch,
  stationIds,
  defaultPeriod,
  busy,
  onShare,
  onExport,
}: {
  report: ReportDefinition;
  tenantId: string;
  contextSearch: string;
  stationIds: readonly string[];
  defaultPeriod: RowPeriod;
  busy: boolean;
  onShare: (target: ReportActionTarget) => void;
  onExport: (target: ReportActionTarget, format: ExportFormat) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<RowAction | null>(null);

  function hrefFor(rowPeriod: RowPeriod): string {
    return `/reports/${report.slug}?${applyReportFilters(
      new URLSearchParams({
        tenantId,
        ...Object.fromEntries(
          [...new URLSearchParams(contextSearch)].filter(([key]) =>
            ['legalEntityId', 'stationId', 'allStations'].includes(key),
          ),
        ),
      }),
      { stationIds, ...rowPeriod },
    ).toString()}`;
  }

  function targetFor(rowPeriod: RowPeriod): ReportActionTarget | null {
    const range = resolveReportFilters({ stationIds, ...rowPeriod }, businessToday());
    return range
      ? {
          tenantId,
          slug: report.slug,
          stationIds,
          period: rowPeriod.period,
          fromDate: range.fromDate,
          toDate: range.toDate,
        }
      : null;
  }

  function run(action: RowAction, rowPeriod: RowPeriod) {
    const target = targetFor(rowPeriod);
    if (!target) return;
    setPending(null);
    if (action.kind === 'view') router.push(hrefFor(rowPeriod));
    else if (action.kind === 'share') onShare(target);
    else onExport(target, action.format);
  }

  return (
    <li className="report-row">
      <span className="report-tile" aria-hidden="true">
        <Icon name={CATEGORY_ICONS[report.category]} size="md" />
      </span>
      <div className="report-row-main">
        <Link className="row-link" href={hrefFor(defaultPeriod)}>
          {report.title}
        </Link>
        <p className="report-row-description">{report.description}</p>
        <p className="report-row-category">{categoryLabel(report.category)}</p>
      </div>
      <div className="report-row-actions">
        <ReportActionMenu
          reportTitle={report.title}
          disabled={busy}
          items={[
            { kind: 'action', label: 'View', onSelect: () => setPending({ kind: 'view' }) },
            {
              kind: 'action',
              label: 'Share private link',
              onSelect: () => setPending({ kind: 'share' }),
            },
            ...(report.exportable
              ? (['xlsx', 'pdf', 'csv'] as const).map((format) => ({
                  kind: 'action' as const,
                  label: EXPORT_LABELS[format],
                  onSelect: () => setPending({ kind: 'export', format }),
                }))
              : []),
          ]}
        />
      </div>
      {pending ? (
        <ReportPeriodDialog
          reportTitle={report.title}
          confirmLabel={confirmLabel(pending)}
          initial={defaultPeriod}
          onClose={() => setPending(null)}
          onConfirm={(rowPeriod) => run(pending, rowPeriod)}
        />
      ) : null}
    </li>
  );
}
