'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Icon } from '../../../design-system/icons';
import { Card } from '../../../design-system/primitives';
import { formatBusinessDate } from '../../../design-system/formatters';
import type { ManagementReport } from '../contracts';
import { exact, ratioPercentage, subtractExact } from '../domain';
import { findReport, reportsInCategory } from '../catalog';
import type { IncomeRow, IncomeStatement, StatementUnit } from '../statements';
import { formatStatementAmount } from './statement';

function amount(value: string | null, unit?: StatementUnit) {
  if (value !== null && exact(value).value.isZero()) return '–';
  return formatStatementAmount({ label: '', value, unit });
}

/** Change from the previous period: the difference, and how large it is against what it was. */
function change(row: IncomeRow) {
  if (row.current === null || row.previous === null) return null;
  const difference = subtractExact(row.current, row.previous);
  const percent = exact(row.previous).value.isZero()
    ? null
    : ratioPercentage(difference, exact(row.previous).value.abs().toFixed());
  const sign = exact(difference).value.isZero() ? 0 : exact(difference).value.isNegative() ? -1 : 1;
  return { difference, percent, sign };
}

function percentText(percent: string | null) {
  if (percent === null) return '';
  const value = exact(percent).value.toDecimalPlaces(1);
  return `${value.isNegative() ? '' : '+'}${value.toFixed(1)}%`;
}

/**
 * A statement as a comparative table: this period beside the one before it, with
 * folding groups, a Detailed switch and ruled result rows. Every report page uses it.
 */
export function StatementWorkspace({
  id,
  title,
  slug,
  statement,
  report,
  previous,
  previousRange,
  comparing,
  query,
  filtersMenu,
}: {
  id: string;
  title: string;
  slug: string;
  statement: IncomeStatement;
  report: ManagementReport;
  previous: ManagementReport | null;
  previousRange: { fromDate: string; toDate: string } | null;
  comparing: boolean;
  query: string;
  filtersMenu: ReactNode;
}) {
  const tabs = reportsInCategory(findReport(slug)?.category ?? 'statements');
  const [detailed, setDetailed] = useState(true);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const expandable = new Set(
    statement.rows.filter((row) => row.parentId).map((row) => row.parentId as string),
  );

  const stations =
    report.filters.stationIds.length === 0
      ? 'All stations'
      : report.stations
          .filter((station) => report.filters.stationIds.includes(station.stationId))
          .map((station) => station.name)
          .join(', ');

  function toggleGroup(id: string) {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card as="section" className="panel income-card content-span" id={id} aria-label={title}>
      {tabs.length > 1 ? (
        <nav className="income-tabs" aria-label="Related reports">
          {tabs.map((tab) => (
            <Link
              key={tab.slug}
              href={`/reports/${tab.slug}?${query}`}
              aria-current={tab.slug === slug ? 'page' : undefined}
            >
              {tab.title}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="income-toolbar">
        <p className="income-period">
          {formatBusinessDate(report.filters.fromDate)} –{' '}
          {formatBusinessDate(report.filters.toDate)}
          {report.filters.stationIds.length > 0 ? ` · ${stations}` : ''}
        </p>
        <div className="income-actions">
          {expandable.size > 0 ? (
            <label className="income-switch">
              <input
                type="checkbox"
                role="switch"
                checked={detailed}
                onChange={(event) => {
                  setDetailed(event.target.checked);
                  setFolded(new Set());
                }}
              />
              <span className="income-switch-track" aria-hidden="true" />
              Detailed
            </label>
          ) : null}
          {filtersMenu}
          <button
            type="button"
            className="button button-secondary button-sm"
            onClick={() => window.print()}
          >
            Print
          </button>
        </div>
      </div>

      <div className="income-scroll">
        <table className="income" data-foldable={expandable.size > 0 || undefined}>
          <caption className="visually-hidden">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="income-name">
                <span className="visually-hidden">Line item</span>
              </th>
              <th scope="col" className="income-num">
                This period
              </th>
              <th
                scope="col"
                className="income-num income-prev"
                title={
                  previousRange
                    ? `${formatBusinessDate(previousRange.fromDate)} – ${formatBusinessDate(previousRange.toDate)}`
                    : undefined
                }
              >
                Previous
              </th>
              <th scope="col" className="income-num income-change">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {statement.rows.map((row) => {
              if (row.parentId && (!detailed || folded.has(row.parentId))) return null;
              const diff = change(row);
              const canFold =
                (row.kind === 'section' || row.kind === 'heading') && expandable.has(row.id);
              const open = detailed && !folded.has(row.id);
              const isHeading = row.kind === 'heading';
              return (
                <tr key={row.id} className={`income-row income-${row.kind}`}>
                  <th scope="row" className="income-name">
                    {canFold ? (
                      <button
                        type="button"
                        className="income-fold"
                        aria-expanded={open}
                        disabled={!detailed}
                        onClick={() => toggleGroup(row.id)}
                      >
                        <Icon name="chevron-down" />
                        {row.label}
                      </button>
                    ) : (
                      <span className="income-label">{row.label}</span>
                    )}
                    {row.note ? <small>{row.note}</small> : null}
                  </th>
                  <td
                    className="income-num"
                    data-unavailable={(!isHeading && row.current === null) || undefined}
                  >
                    {isHeading ? null : amount(row.current, row.unit)}
                  </td>
                  <td className="income-num income-prev" data-muted="true">
                    {isHeading
                      ? null
                      : comparing
                        ? '…'
                        : previous
                          ? amount(row.previous, row.unit)
                          : '—'}
                  </td>
                  <td className="income-num income-change">
                    {isHeading ? null : diff ? (
                      <span data-sign={diff.sign}>
                        {amount(diff.difference, row.unit)}
                        {diff.percent !== null ? <small>{percentText(diff.percent)}</small> : null}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="income-foot">
        {statement.notes.map((note) => `${note} `)}
        {!previous && !comparing ? 'The previous period could not be loaded. ' : ''}
        Unaudited management statement · USD
      </p>
    </Card>
  );
}
