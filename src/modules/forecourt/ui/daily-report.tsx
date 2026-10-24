'use client';

import { useState } from 'react';
import { EmptyState } from '@/design-system/primitives';
import { formatDecimal } from '@/design-system/formatters';
import {
  formatDailyReportText,
  plainAmount,
  type DailyReport,
  type DailyReportDipReading,
} from '../daily-report-model';

// Layout only; the look comes from the shared statement classes, which also carry print.
const block = {
  display: 'grid',
  gap: 'var(--space-3)',
  padding: 'var(--space-4) 0 0',
  borderTop: 'var(--border-width) solid var(--border-subtle)',
} as const;
const heading = { margin: 0 } as const;
const note = { margin: 0, color: 'var(--text-secondary)' } as const;

const amount = (value: string): string => formatDecimal(plainAmount(value));

const money = (value: string) => `USD ${amount(value)}`;
const litres = (value: string) => `${amount(value)} L`;

function timeOf(value: string | null, timezone: string): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

function dipLabel(dip: DailyReportDipReading): string {
  return dip.measurement !== null
    ? `${dip.measurement} ${dip.unit ?? ''} · ${litres(dip.litres)}`
    : litres(dip.litres);
}

const isShort = (value: string) => value.trim().startsWith('-');

/** Plain words for the cash difference: "USD 5.00 short", "USD 5.00 over" or balanced. */
function difference(value: string): string {
  if (isShort(value)) return `${money(value.trim().slice(1))} short`;
  return amount(value) === '0.00' ? 'Balanced, no difference' : `${money(value)} over`;
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
            Copy for WhatsApp
          </button>
          <button type="button" className="button button-primary" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </div>
      </div>
      <p role="status" style={{ margin: 0 }}>
        {copied === 'done' ? 'Copied. Open WhatsApp and paste it into the chat.' : null}
        {copied === 'failed' ? 'Could not copy. Use Print or save as PDF instead.' : null}
      </p>

      {report.products.length > 0 || report.cash ? (
        <dl className="recon-statement-meta">
          {report.products.map((product) => (
            <div key={product.productName}>
              <dt>{product.productName} sold</dt>
              <dd>{litres(product.totalLitres)}</dd>
            </div>
          ))}
          {report.cash ? (
            <>
              <div>
                <dt>Cash counted</dt>
                <dd>{money(report.cash.countedCash)}</dd>
              </div>
              <div>
                <dt>Cash difference</dt>
                <dd>{difference(report.cash.cashVariance)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      ) : null}

      {report.products.length === 0 ? (
        <EmptyState title="No pump readings" message="This shift has no pump readings saved yet." />
      ) : (
        report.products.map((product) => (
          <section key={product.productName} style={block}>
            <h3 style={heading}>{product.productName} sales</h3>
            <p style={note}>
              Price {product.prices.map((price) => money(price)).join(' / ')} per litre
            </p>
            <table className="recon-summary" aria-label={`${product.productName} pumps`}>
              <thead>
                <tr>
                  <th scope="col">Pump</th>
                  <th scope="col">Opening</th>
                  <th scope="col">Closing</th>
                  <th scope="col">Litres sold</th>
                </tr>
              </thead>
              <tbody>
                {product.pumps.map((pump) => (
                  <tr key={pump.label}>
                    <th scope="row">{pump.label}</th>
                    <td data-label="Opening">{amount(pump.opening)}</td>
                    <td data-label="Closing">{amount(pump.closing)}</td>
                    <td data-label="Litres sold">{litres(pump.litres)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total {product.productName.toLowerCase()}</th>
                  <td colSpan={2} data-label="Sales value">
                    {money(product.salesValue)}
                  </td>
                  <td data-label="Litres sold">{litres(product.totalLitres)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        ))
      )}

      <section style={block}>
        <h3 style={heading}>Expenses</h3>
        {report.expenses.lines.length === 0 ? (
          <p style={note}>No expenses recorded for this shift.</p>
        ) : (
          <table className="recon-summary" aria-label="Expenses">
            <thead>
              <tr>
                <th scope="col">What it was for</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {report.expenses.lines.map((line, index) => (
                <tr key={`${line.description}-${index}`}>
                  <th scope="row">{line.description}</th>
                  <td data-label="Amount">{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total expenses</th>
                <td data-label="Amount">{money(report.expenses.total ?? '0')}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section style={block}>
        <h3 style={heading}>Cash</h3>
        <table className="recon-summary" aria-label="Cash">
          <tbody>
            {report.cash ? (
              <>
                <tr>
                  <th scope="row">Cash counted</th>
                  <td data-label="Amount">{money(report.cash.countedCash)}</td>
                </tr>
                <tr>
                  <th scope="row">Cash difference (excess / shortfall)</th>
                  <td
                    data-label="Amount"
                    data-tone={isShort(report.cash.cashVariance) ? 'critical' : undefined}
                  >
                    {difference(report.cash.cashVariance)}
                  </td>
                </tr>
              </>
            ) : (
              <tr>
                <th scope="row">Cash counted</th>
                <td data-label="Amount">Not counted yet</td>
              </tr>
            )}
            <tr>
              <th scope="row">Drop (cash handed over today)</th>
              <td data-label="Amount">
                {report.drops.total === null ? 'None recorded' : money(report.drops.total)}
              </td>
            </tr>
            {report.drops.lines.length > 1
              ? report.drops.lines.map((line, index) => (
                  <tr key={`${line.toLocation}-${index}`}>
                    <th scope="row">· To {line.toLocation}</th>
                    <td data-label="Amount">{money(line.amount)}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </section>

      <section style={block}>
        <h3 style={heading}>Tank dips</h3>
        {report.dips.length === 0 ? (
          <p style={note}>No dips recorded for this shift.</p>
        ) : (
          <table className="recon-summary" aria-label="Tank dips">
            <thead>
              <tr>
                <th scope="col">Tank</th>
                <th scope="col">Opening</th>
                <th scope="col">Closing</th>
              </tr>
            </thead>
            <tbody>
              {report.dips.map((dip) => (
                <tr key={dip.tankCode}>
                  <th scope="row">
                    {dip.productName} · {dip.tankCode}
                  </th>
                  <td data-label="Opening">
                    {dip.opening ? dipLabel(dip.opening) : 'No opening dip'}
                  </td>
                  <td data-label="Closing">{dipLabel(dip.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={block}>
        <h3 style={heading}>Who was on shift</h3>
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
      </section>

      <section style={block}>
        <h3 style={heading}>This month so far</h3>
        <p style={note}>
          {month.fromDate} to {report.businessDate}: approved shifts plus this one.
        </p>
        {month.products.length === 0 ? (
          <p style={note}>No figures yet this month.</p>
        ) : (
          <table className="recon-summary" aria-label="Month to date">
            <thead>
              <tr>
                <th scope="col">Fuel</th>
                <th scope="col">Litres sold</th>
                <th scope="col">Sales</th>
              </tr>
            </thead>
            <tbody>
              {month.products.map((row) => (
                <tr key={row.productName}>
                  <th scope="row">{row.productName}</th>
                  <td data-label="Litres sold">{litres(row.litres)}</td>
                  <td data-label="Sales">{money(row.sales)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Expenses this month</th>
                <td colSpan={2} data-label="Amount">
                  {money(month.expenses)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </section>
  );
}
