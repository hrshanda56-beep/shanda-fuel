'use client';

import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { Icon } from '@/design-system/icons';

export type ChartPoint = { label: string; value: number };

const WIDTH = 700;
const HEIGHT = 260;
const GRID_LINES = 5;

/** Round the top of the scale up to a tidy 1/2/2.5/5 × 10ⁿ step. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const intervals = GRID_LINES - 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max / intervals)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s * intervals >= max);
  return (step ?? 10 * magnitude) * intervals;
}

type XY = { x: number; y: number };

/** Smooth curve through the points (Catmull-Rom converted to Béziers). */
export function smoothPath(points: XY[]): string {
  const first = points[0];
  if (!first) return '';
  let d = `M ${first.x} ${first.y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p1 = points[i] ?? first;
    const p2 = points[i + 1] ?? p1;
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Line-and-area chart with a value tooltip. It draws only the series it is
 * given: with no series it shows the empty axes and says so, never a sample.
 */
export function PerformanceChart({
  series,
  xLabels,
  formatValue,
  emptyMessage,
  label,
}: {
  series: ChartPoint[] | null;
  xLabels: string[];
  formatValue: (value: number) => string;
  emptyMessage: string;
  label: string;
}) {
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);
  const data = series && series.length > 0 ? series : null;

  const top = data ? niceMax(Math.max(...data.map((p) => p.value))) : 1;
  const ticks = Array.from({ length: GRID_LINES }, (_, i) => top - (top / (GRID_LINES - 1)) * i);
  const coords = data
    ? data.map((p, i) => ({
        x: data.length === 1 ? WIDTH / 2 : (i / (data.length - 1)) * WIDTH,
        y: HEIGHT - (p.value / top) * HEIGHT,
      }))
    : [];
  const line = smoothPath(coords);
  const area = data ? `${line} L ${WIDTH} ${HEIGHT} L 0 ${HEIGHT} Z` : '';

  const select = (index: number) =>
    setActive(Math.max(0, Math.min(index, (data?.length ?? 1) - 1)));

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!data) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    select(Math.round(ratio * (data.length - 1)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!data) return;
    if (event.key === 'ArrowRight') select((active ?? -1) + 1);
    else if (event.key === 'ArrowLeft') select((active ?? data.length) - 1);
    else if (event.key === 'Escape') setActive(null);
    else return;
    event.preventDefault();
  };

  const current = data && active !== null ? data[active] : null;
  const previous = data && active !== null && active > 0 ? data[active - 1] : null;
  const change = current && previous ? current.value - previous.value : null;
  const marker = active !== null ? coords[active] : null;

  return (
    <div className="perf-chart" data-empty={data ? undefined : ''}>
      <ul className="perf-chart-y" aria-hidden="true">
        {ticks.map((tick, i) => (
          <li key={i}>{data ? formatValue(tick) : ''}</li>
        ))}
      </ul>

      <div
        className="perf-chart-plot"
        role={data ? 'group' : 'img'}
        aria-label={data ? label : `${label}. ${emptyMessage}`}
        tabIndex={data ? 0 : undefined}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ecd57a" stopOpacity="0.28" />
              <stop offset="1" stopColor="#ecd57a" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((_, i) => (
            <line
              key={i}
              className="perf-chart-grid"
              x1="0"
              x2={WIDTH}
              y1={(HEIGHT / (GRID_LINES - 1)) * i}
              y2={(HEIGHT / (GRID_LINES - 1)) * i}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {data ? (
            <>
              <path d={area} fill={`url(#${gradientId})`} />
              <path className="perf-chart-line" d={line} vectorEffect="non-scaling-stroke" />
            </>
          ) : null}
        </svg>

        {marker && current ? (
          <>
            <span
              className="perf-chart-guide"
              style={{ left: `${(marker.x / WIDTH) * 100}%` }}
              aria-hidden="true"
            />
            <span
              className="perf-chart-dot"
              style={{
                left: `${(marker.x / WIDTH) * 100}%`,
                top: `${(marker.y / HEIGHT) * 100}%`,
              }}
              aria-hidden="true"
            />
            <span
              className="perf-chart-tip"
              role="status"
              style={{
                left: `${Math.min(Math.max((marker.x / WIDTH) * 100, 12), 88)}%`,
                top: `${(marker.y / HEIGHT) * 100}%`,
              }}
            >
              <span className="perf-chart-tip-row">
                <span>
                  {change === null
                    ? current.label
                    : `${change < 0 ? '−' : '+'}${formatValue(Math.abs(change))}`}
                </span>
                {change !== null ? (
                  <span className="perf-chart-tip-arrow" data-down={change < 0 || undefined}>
                    <Icon name="arrow-right" />
                  </span>
                ) : null}
              </span>
              <strong>{formatValue(current.value)}</strong>
            </span>
          </>
        ) : null}

        {!data ? <p className="perf-chart-empty">{emptyMessage}</p> : null}
      </div>

      <ol className="perf-chart-x" aria-hidden="true">
        {xLabels.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ol>
    </div>
  );
}
