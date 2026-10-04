'use client';

import { useState } from 'react';

import { GlobalSearchButton } from '@/design-system/app-shell';
import { AreaChart, BarChart, DonutChart } from '@/design-system/charts';
import { WorkInProgressTrigger } from '@/design-system/dialogs';
import { Icon } from '@/design-system/icons';
import { EmptyState } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';

import {
  sampleAttention,
  sampleKpis,
  samplePeriods,
  sampleTankStock,
  type AttentionType,
  type PeriodKey,
} from './sample-overview';

const PERIOD_KEYS: PeriodKey[] = ['week', 'lastweek', 'month', 'lastmonth'];
const FILTERS: { key: AttentionType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'exception', label: 'Exceptions' },
  { key: 'approval', label: 'Approvals' },
  { key: 'info', label: 'Info' },
];
const PRIORITY_CLASS = { High: 'text-critical', Medium: 'text-warning', Low: 'text-positive' };

/**
 * Production boundary for the overview until a trusted reporting context and
 * dashboard projection are available. Never replace these states with sample
 * values or a silent fallback after a fetch failure.
 */
export function ProductionSafeOverview() {
  return (
    <div className="overview">
      <div className="overview-title">
        <div>
          <h1 id="page-title">Dashboard</h1>
          <p className="overview-sample">Live figures are unavailable for this context.</p>
        </div>
        <GlobalSearchButton />
      </div>

      <section className="overview-section" aria-labelledby="today-heading">
        <h2 id="today-heading">Today at a glance</h2>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="Live metrics unavailable"
            message="No authoritative dashboard projection is available yet. Sample financial and operational figures are intentionally hidden."
          />
        </div>
      </section>

      <section className="overview-section" aria-labelledby="stats-heading">
        <h2 id="stats-heading">Statistics by period</h2>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="Trends unavailable"
            message="Period charts will appear when an authoritative reporting projection is available."
          />
        </div>
      </section>

      <section className="overview-section" aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs attention</h2>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="Live attention feed unavailable"
            message="No sample tasks, attention rows, or action-center data are shown on the production dashboard."
          />
        </div>
      </section>
    </div>
  );
}

/** Owner/Finance Overview (ADR-015): today's KPIs, period charts, then Needs attention. */
export function OverviewDashboard() {
  const [period, setPeriod] = useState<PeriodKey>('week');
  const [filter, setFilter] = useState<AttentionType | 'all'>('all');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const stats = samplePeriods[period];
  const live = sampleAttention.filter((row) => !dismissed.has(row.id));
  const rows = live.filter((row) => filter === 'all' || row.type === filter);
  const count = (key: AttentionType | 'all') =>
    live.filter((row) => key === 'all' || row.type === key).length;

  return (
    <div className="overview">
      <div className="overview-title">
        <div>
          <h1 id="page-title">Dashboard</h1>
          <p className="overview-sample">
            Sample data for design review. Figures are illustrative.
          </p>
        </div>
        <GlobalSearchButton />
      </div>

      <section className="overview-section" aria-labelledby="today-heading">
        <h2 id="today-heading">Today at a glance</h2>
        <div className="kpi-grid">
          {sampleKpis.map((kpi) => (
            <article className="card kpi-card" key={kpi.label}>
              <p className="kpi-label">
                <Icon name={kpi.icon} size="md" />
                {kpi.label}
              </p>
              <p className="kpi-value numeric">{kpi.value}</p>
              <p className="kpi-meta">
                {kpi.qualifier ? <span className="text-warning">{kpi.qualifier} · </span> : null}
                {kpi.meta}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="overview-section" aria-labelledby="stats-heading">
        <div className="overview-section-head">
          <h2 id="stats-heading">Statistics by period</h2>
          <p className="overview-range">
            <Icon name="calendar" />
            {stats.range}
          </p>
          <div className="pill-group" role="group" aria-label="Period">
            {PERIOD_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="pill"
                aria-pressed={period === key}
                onClick={() => setPeriod(key)}
              >
                {samplePeriods[key].label}
              </button>
            ))}
          </div>
        </div>

        <div className="chart-grid">
          <article className="card chart-card chart-card-wide" aria-labelledby="revenue-heading">
            <div className="chart-card-summary">
              <h3 id="revenue-heading">Fuel revenue</h3>
              <p className="chart-card-value numeric">{stats.revenue.total}</p>
              <Change
                label="Growth"
                change={stats.revenue.change}
                direction={stats.revenue.direction}
              />
              <p className="chart-card-note">{stats.comparison}. All stations, USD.</p>
            </div>
            <AreaChart
              label={`Daily fuel revenue, ${stats.range}`}
              valueHeading="Revenue"
              points={stats.revenue.points}
              max={8000}
              ticks={[0, 2000, 4000, 6000, 8000]}
              tickLabel={(tick) => (tick === 0 ? '0' : `$${tick / 1000}K`)}
              labelEvery={stats.labelEvery}
            />
          </article>

          <article className="card chart-card" aria-labelledby="stock-heading">
            <h3 id="stock-heading">Tank stock now</h3>
            <div className="donut-layout">
              <DonutChart label="Tank stock now by product" segments={sampleTankStock.segments} />
              <ul className="donut-legend">
                {sampleTankStock.segments.map((segment) => {
                  const note = sampleTankStock.notes[segment.label];
                  return (
                    <li key={segment.label}>
                      <span className="donut-legend-label">
                        <span
                          className="legend-dot"
                          style={{ background: `var(--chart-${segment.series})` }}
                          aria-hidden="true"
                        />
                        {segment.label}
                      </span>
                      <strong className="numeric">{segment.display}</strong>
                      {note ? (
                        <span className={note.tone === 'warning' ? 'text-warning' : undefined}>
                          {note.text}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          </article>

          <article className="card chart-card" aria-labelledby="litres-heading">
            <h3 id="litres-heading">Litres sold</h3>
            <p className="chart-card-value numeric">{stats.litres.total}</p>
            <Change
              label="Growth"
              change={stats.litres.change}
              direction={stats.litres.direction}
            />
            <BarChart
              label={`Litres sold, ${stats.range}`}
              valueHeading="Litres"
              points={stats.litres.points}
            />
          </article>
        </div>
      </section>

      <section
        className="overview-section"
        id="needs-attention"
        aria-labelledby="attention-heading"
      >
        <div className="overview-section-head">
          <h2 id="attention-heading">Needs attention</h2>
          <div className="pill-group" role="group" aria-label="Filter items">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="pill"
                aria-pressed={filter === option.key}
                onClick={() => setFilter(option.key)}
              >
                {option.label} <span className="numeric">{count(option.key)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card attention-card">
          <TableScrollRegion label="Needs attention table">
            <table className="table attention-table">
              <caption className="visually-hidden">Items that need attention</caption>
              <thead>
                <tr>
                  <th scope="col">Priority</th>
                  <th scope="col">Item</th>
                  <th scope="col">Type</th>
                  <th scope="col">Station</th>
                  <th scope="col">Age</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Priority" className={PRIORITY_CLASS[row.priority]}>
                      {row.priority}
                    </td>
                    <td data-label="Item">
                      <span className="attention-title">{row.title}</span>
                      <span className="attention-ref">{row.reference}</span>
                    </td>
                    <td data-label="Type">{row.typeLabel}</td>
                    <td data-label="Station">{row.station}</td>
                    <td data-label="Age" className="numeric">
                      {row.age}
                    </td>
                    <td className="attention-actions">
                      <WorkInProgressTrigger feature="Item review">
                        <button type="button" className="text-action">
                          Review<span className="visually-hidden"> {row.title}</span>
                        </button>
                      </WorkInProgressTrigger>
                      {row.type === 'info' ? (
                        <button
                          type="button"
                          className="text-action text-action-quiet"
                          onClick={() => setDismissed((current) => new Set(current).add(row.id))}
                        >
                          Dismiss<span className="visually-hidden"> {row.title}</span>
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
          {rows.length === 0 ? (
            <p className="attention-empty" role="status">
              Nothing needs attention in this view.
            </p>
          ) : null}
        </div>
        <div className="overview-more">
          <WorkInProgressTrigger feature="All attention items">
            <button type="button" className="pill">
              All items
            </button>
          </WorkInProgressTrigger>
        </div>
      </section>
    </div>
  );
}

function Change({
  label,
  change,
  direction,
}: {
  label: string;
  change: string;
  direction: 'up' | 'down';
}) {
  const word = direction === 'up' ? label : 'Fall';
  return (
    <p className="chart-card-change">
      <span>{word}</span>
      <span className={direction === 'up' ? 'text-positive' : 'text-critical'}>
        <span aria-hidden="true">{direction === 'up' ? '▲' : '▼'} </span>
        <span className="numeric">{change}</span>
      </span>
    </p>
  );
}
