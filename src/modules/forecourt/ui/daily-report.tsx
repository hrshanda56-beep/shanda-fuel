'use client';

import { useState } from 'react';
import { EmptyState } from '@/design-system/primitives';
import { formatLitres, formatMoney } from '@/design-system/formatters';
import {
  formatDailyReportText,
  type DailyReport,
  type DailyReportDipReading,
} from '../daily-report-model';

// Layout only; the page-level look comes from the shared statement classes, which also carry print.
const block = { display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-4) 0' } as const;
const list = {
  display: 'grid',
  gap: 'var(--space-2)',
  margin: 0,
  padding: 0,
  listStyle: 'none',
} as const;
const rowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: 'var(--space-1) var(--space-4)',
} as const;
const total = { ...rowStyle, margin: 0 } as const;

function timeOf(value: string | null, timezone: string): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

function dipLabel(dip: DailyReportDipReading): string {
  return dip.measurement !== null
    ? `${dip.measurement} ${dip.unit ?? ''} · ${formatLitres(dip.litres)}`
    : formatLitres(dip.litres);
}

export function DailyReportView({ report }: { report: DailyReport }) {
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null);
  const start = timeOf(report.shiftStartAt, report.timezone);
  const end = timeOf(report.shiftEndAt, report.timezone);
  const closed = ['APPROVED', 'POSTED', 'LOCKED'].includes(report.state);
  const month = report.monthToDate;

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatDailyReportText(report));
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <section
      className="card panel recon-statement daily-report"
      aria-labelledby="daily-report-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{report.stationName}</p>
          <h2 id="daily-report-title">Daily report · {report.businessDate}</h2>
          <p>
            {start && end ? `Shift ${start}–${end}` : 'Shift time not recorded'}
            {closed ? '' : ' · Not yet approved, figures may still change'}
          </p>
        </div>
        <div className="recon-statement-actions">
          <button type="button" className="button button-secondary" onClick={copy}>
            Copy as WhatsApp text
          </button>
          <button type="button" className="button button-primary" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </div>
      </div>
      <p role="status" style={{ margin: 0 }}>
        {copied === 'done' ? 'Copied. Paste it into WhatsApp.' : null}
        {copied === 'failed' ? 'Could not copy. Use Print or save as PDF instead.' : null}
      </p>

      {report.products.length === 0 ? (
        <EmptyState title="No pump readings" message="This shift has no pump readings saved yet." />
      ) : (
        report.products.map((product) => (
          <section key={product.productName} style={block}>
            <h3 style={{ margin: 0 }}>{product.productName} sales</h3>
            <p>Price {product.prices.map((price) => formatMoney(price)).join(' / ')} per litre</p>
            <ul style={list}>
              {product.pumps.map((pump) => (
                <li style={rowStyle} key={pump.label}>
                  <strong>{pump.label}</strong>
                  <span>
                    Opening {pump.opening} → Closing {pump.closing}
                  </span>
                  <span>{formatLitres(pump.litres)}</span>
                </li>
              ))}
            </ul>
            <p style={total}>
              <span>Total litres sold</span>
              <strong>{formatLitres(product.totalLitres)}</strong>
            </p>
            <p style={total}>
              <span>Sales value</span>
              <strong>{formatMoney(product.salesValue)}</strong>
            </p>
          </section>
        ))
      )}

      <section style={block}>
        <h3 style={{ margin: 0 }}>Expenses</h3>
        {report.expenses.lines.length === 0 ? (
          <p>No expenses recorded.</p>
        ) : (
          <ul style={list}>
            {report.expenses.lines.map((line, index) => (
              <li style={rowStyle} key={`${line.description}-${index}`}>
                <span>{line.description}</span>
                <span>{formatMoney(line.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {report.expenses.total !== null ? (
          <p style={total}>
            <span>Total expenses</span>
            <strong>{formatMoney(report.expenses.total)}</strong>
          </p>
        ) : null}
      </section>

      <section style={block}>
        <h3 style={{ margin: 0 }}>Cash</h3>
        {report.cash ? (
          <>
            <p style={total}>
              <span>Available cash (counted)</span>
              <strong>{formatMoney(report.cash.countedCash)}</strong>
            </p>
            <p style={total}>
              <span>Excess / shortfall</span>
              <strong>{formatMoney(report.cash.cashVariance)}</strong>
            </p>
          </>
        ) : (
          <p>Cash has not been counted for this shift.</p>
        )}
        <p style={total}>
          <span>Drop (handed over today)</span>
          <strong>
            {report.drops.total === null ? 'None recorded' : formatMoney(report.drops.total)}
          </strong>
        </p>
        {report.drops.lines.length > 1 ? (
          <ul style={list}>
            {report.drops.lines.map((line, index) => (
              <li style={rowStyle} key={`${line.toLocation}-${index}`}>
                <span>To {line.toLocation}</span>
                <span>{formatMoney(line.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section style={block}>
        <h3 style={{ margin: 0 }}>Site dips</h3>
        {report.dips.length === 0 ? (
          <p>No dips recorded for this shift.</p>
        ) : (
          <ul style={list}>
            {report.dips.map((dip) => (
              <li style={rowStyle} key={dip.tankCode}>
                <strong>
                  {dip.productName} · {dip.tankCode}
                </strong>
                {dip.opening ? <span>Opening {dipLabel(dip.opening)}</span> : null}
                <span>
                  {dip.opening ? 'Closing' : 'Dip'} {dipLabel(dip.closing)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className="recon-statement-meta">
        <div>
          <dt>Attendants</dt>
          <dd>
            {report.attendantNames.length ? report.attendantNames.join(', ') : 'None recorded'}
          </dd>
        </div>
        <div>
          <dt>Supervisor</dt>
          <dd>{report.supervisorName ?? 'None recorded'}</dd>
        </div>
      </dl>

      <section style={block}>
        <h3 style={{ margin: 0 }}>Month to date</h3>
        <p>
          From {month.fromDate} to {report.businessDate}, counting approved shifts and this one.
        </p>
        {month.products.length === 0 ? (
          <p>No figures yet this month.</p>
        ) : (
          <ul style={list}>
            {month.products.map((row) => (
              <li style={rowStyle} key={row.productName}>
                <strong>{row.productName}</strong>
                <span>{formatLitres(row.litres)}</span>
                <span>{formatMoney(row.sales)}</span>
              </li>
            ))}
          </ul>
        )}
        <p style={total}>
          <span>Expenses this month</span>
          <strong>{formatMoney(month.expenses)}</strong>
        </p>
      </section>
    </section>
  );
}
