import { useId } from 'react';

/**
 * Minimal, dependency-free charts (ADR-015). Each chart answers one question,
 * uses the --chart-* tokens, and ships a visually hidden table as its text
 * equivalent. Values arrive as display-ready strings from the server; the
 * numbers here only drive geometry and are never shown or re-used as data.
 */

export type ChartPoint = {
  /** Axis label, e.g. "Wed". */
  label: string;
  /** Plain decimal string used for geometry only. */
  value: string;
  /** Display value for the text equivalent, e.g. "$7,460". */
  display: string;
};

type ChartFrameProps = {
  /** Accessible name, e.g. "Daily fuel revenue, 23–29 Sep 2026". */
  label: string;
  valueHeading: string;
  points: readonly ChartPoint[];
};

function DataTable({ label, valueHeading, points }: ChartFrameProps) {
  return (
    <table className="visually-hidden">
      <caption>{label}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th scope="col">{valueHeading}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.label}>
            <th scope="row">{point.label}</th>
            <td>{point.display}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const VIEW_W = 400;
const VIEW_H = 120;

function smoothPath(coords: readonly (readonly [number, number])[]) {
  return coords.reduce((path, [x, y], index) => {
    if (index === 0) return `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const [px, py] = coords[index - 1]!;
    const mx = ((px + x) / 2).toFixed(1);
    return `${path} C${mx} ${py.toFixed(1)} ${mx} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }, '');
}

/**
 * Area chart with a soft fade. `ticks` are y-axis gridlines in the same unit
 * as the values; `tickLabel` formats them. `labelEvery` thins the x labels.
 */
export function AreaChart({
  label,
  valueHeading,
  points,
  max,
  ticks,
  tickLabel,
  labelEvery = 1,
}: ChartFrameProps & {
  max: number;
  ticks: readonly number[];
  tickLabel: (tick: number) => string;
  labelEvery?: number;
}) {
  const gradientId = `area-${useId().replace(/:/g, '')}`;
  const n = points.length;
  const x = (index: number) => (n === 1 ? VIEW_W / 2 : (index * VIEW_W) / (n - 1));
  const y = (value: number) => VIEW_H - (Math.min(value, max) / max) * VIEW_H;
  const coords = points.map((point, index) => [x(index), y(Number(point.value))] as const);
  const line = smoothPath(coords);
  const area = `${line} L${VIEW_W} ${VIEW_H} L0 ${VIEW_H} Z`;

  return (
    <figure className="chart chart-area">
      <div className="chart-y-axis" aria-hidden="true">
        {[...ticks].reverse().map((tick) => (
          <span key={tick}>{tickLabel(tick)}</span>
        ))}
      </div>
      <div className="chart-plot">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          {ticks.map((tick) => (
            <line
              key={tick}
              className="chart-gridline"
              x1="0"
              x2={VIEW_W}
              y1={y(tick)}
              y2={y(tick)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill={`url(#${gradientId})`} />
          <path className="chart-line" d={line} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="chart-x-axis" aria-hidden="true">
          {points.map((point, index) =>
            index % labelEvery === 0 || index === n - 1 ? (
              <span key={point.label} style={{ left: `${(x(index) / VIEW_W) * 100}%` }}>
                {point.label}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <DataTable label={label} valueHeading={valueHeading} points={points} />
    </figure>
  );
}

/** Rounded vertical bars with a soft fade, scaled to the largest value. */
export function BarChart({ label, valueHeading, points }: ChartFrameProps) {
  const max = Math.max(...points.map((point) => Number(point.value)), 1);
  return (
    <figure className="chart chart-bars">
      <div className="chart-bar-row" aria-hidden="true">
        {points.map((point) => (
          <div className="chart-bar-slot" key={point.label}>
            <span
              className="chart-bar"
              style={{ height: `${Math.max(8, (Number(point.value) / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="chart-bar-labels" aria-hidden="true">
        {points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
      <DataTable label={label} valueHeading={valueHeading} points={points} />
    </figure>
  );
}

export type DonutSegment = {
  label: string;
  value: string;
  display: string;
  /** Series token index, 1–5. */
  series: 1 | 2 | 3 | 4 | 5;
};

/** Two-to-five part donut. Pair it with a direct legend in the card. */
export function DonutChart({
  label,
  segments,
}: {
  label: string;
  segments: readonly DonutSegment[];
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + Number(segment.value), 0) || 1;
  const lengths = segments.map((segment) => (Number(segment.value) / total) * circumference);
  const offsets = lengths.map((_, index) =>
    lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  );

  return (
    <figure className="chart chart-donut">
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        {segments.map((segment, index) => (
          <circle
            key={segment.label}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={`var(--chart-${segment.series})`}
            strokeWidth="11"
            strokeDasharray={`${lengths[index]!.toFixed(2)} ${circumference.toFixed(2)}`}
            strokeDashoffset={(-offsets[index]!).toFixed(2)}
            transform="rotate(-90 50 50)"
          />
        ))}
      </svg>
      <DataTable
        label={label}
        valueHeading="Volume"
        points={segments.map((segment) => ({
          label: segment.label,
          value: segment.value,
          display: segment.display,
        }))}
      />
    </figure>
  );
}
