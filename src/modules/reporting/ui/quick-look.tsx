'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Dropdown } from '../../../design-system/dropdown';
import type { ManagementReport } from '../contracts';
import { applyReportFilters, parseReportFilters } from '../filters';
import { REPORT_PERIODS, REPORT_PERIOD_LABELS, businessToday, resolvePeriod } from '../period';
import type { ReportPeriod } from '../period';
import { buildQuickFigures } from '../statements';
import { formatStatementAmount } from './statement';

const QUICK_PERIODS = REPORT_PERIODS.filter((period) => period !== 'custom');

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; report: ManagementReport };

/** The owner's first-glance figures for one period, each opening the report behind it. */
export function QuickLook({ tenantId }: { tenantId: string }) {
  const searchParams = useSearchParams();
  const stationIds = useMemo(() => parseReportFilters(searchParams).stationIds, [searchParams]);
  const stationKey = stationIds.join(',');
  const [period, setPeriod] = useState<ReportPeriod>('this-month');
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const range = resolvePeriod(period, businessToday());
    if (!range) return;
    const timer = window.setTimeout(async () => {
      setState({ status: 'loading' });
      const query = new URLSearchParams({
        tenantId,
        fromDate: range.fromDate,
        toDate: range.toDate,
      });
      if (stationKey) query.set('stationIds', stationKey);
      try {
        const response = await fetch(`/api/reports/management?${query.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('unavailable');
        setState({ status: 'ready', report: (await response.json()) as ManagementReport });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error' });
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [tenantId, stationKey, period]);

  function href(slug: string) {
    const params = applyReportFilters(new URLSearchParams({ tenantId }), {
      stationIds,
      period,
      customFrom: '',
      customTo: '',
    });
    return `/reports/${slug}?${params.toString()}`;
  }

  return (
    <section className="card panel rail-card" aria-labelledby="report-quick-look-title">
      <div className="rail-heading-row">
        <h2 className="rail-heading" id="report-quick-look-title">
          Quick look
        </h2>
        <Dropdown
          aria-label="Quick Look period"
          align="end"
          value={period}
          options={QUICK_PERIODS.map((value) => ({ value, label: REPORT_PERIOD_LABELS[value] }))}
          onValueChange={(value) => setPeriod(value as ReportPeriod)}
        />
      </div>
      {state.status === 'error' ? (
        <p className="rail-note">Figures are unavailable right now.</p>
      ) : (
        <ul className="rail-figures" aria-busy={state.status === 'loading'}>
          {(state.status === 'ready'
            ? buildQuickFigures(state.report)
            : PLACEHOLDERS.map((label) => ({ id: label, label, value: '', slug: '' }))
          ).map((figure) => (
            <li key={figure.id}>
              {state.status === 'ready' ? (
                <Link className="rail-figure" href={href(figure.slug)}>
                  <span>{figure.label}</span>
                  <strong>{formatStatementAmount(figure)}</strong>
                </Link>
              ) : (
                <span className="rail-figure" aria-hidden="true">
                  <span>{figure.label}</span>
                  <strong className="rail-figure-skeleton" />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const PLACEHOLDERS = [
  'Total sales',
  'Gross profit',
  'Total expenses',
  'Net profit',
  'Banked cash',
  'Cash',
  'Stock on Hand',
  'Creditors',
  'Debtors',
  'Settlements to Receive',
];
