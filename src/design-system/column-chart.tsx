import type { CSSProperties } from 'react';

export type ColumnChartRow = {
  id: string;
  label: string;
  value: number;
  /** The figure written above the column, already formatted. */
  display: string;
  /** For the screen reader and the hover text, such as "1 invoice". */
  note?: string;
  tone?: 'warning';
};

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Round axis: five equal steps of 1, 2, 2.5, 5 or 10 times a power of ten that cover the data. */
function axisScale(max: number): { top: number; ticks: number[] } {
  const intervals = 5;
  if (!(max > 0))
    return { top: intervals, ticks: Array.from({ length: intervals + 1 }, (_, i) => i) };
  const rough = max / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude;
  return {
    top: step * intervals,
    ticks: Array.from({ length: intervals + 1 }, (_, i) => step * i),
  };
}

/**
 * One column for each row, drawn with the same axis, gridlines and column style as the
 * reconciliation chart. Heights are for the picture only; the exact figures sit above the columns.
 */
export function ColumnChart({
  unit,
  rows,
  label,
}: {
  unit: string;
  rows: readonly ColumnChartRow[];
  label: string;
}) {
  const { top, ticks } = axisScale(Math.max(0, ...rows.map((row) => row.value)));
  const height = (value: number) => `${Math.max((Math.max(value, 0) / top) * 100, 1)}%`;
  return (
    <figure
      className="recon-bars column-chart"
      style={{ '--recon-ticks': ticks.length - 1 } as CSSProperties}
      aria-label={`${label}: ${rows.map((row) => `${row.label} ${row.display}${row.note ? `, ${row.note}` : ''}`).join('; ')}`}
    >
      <p className="recon-bars-unit" aria-hidden="true">
        {unit}
      </p>
      <div className="recon-bars-plot">
        <div className="recon-bars-axis" aria-hidden="true">
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{whole.format(tick)}</span>
          ))}
        </div>
        <div className="recon-bars-columns">
          {rows.map((row) => (
            <div key={row.id} className="recon-bars-col">
              <div className="recon-bars-pair">
                <div
                  className="recon-bar-slot"
                  style={{ height: height(row.value) }}
                  title={`${row.label} ${row.display}${row.note ? `, ${row.note}` : ''}`}
                >
                  <span className="recon-bar-value">{row.display}</span>
                  <span className="recon-bar" data-kind="accounted" data-tone={row.tone} />
                </div>
              </div>
              <span className="recon-bars-label">{row.label}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
