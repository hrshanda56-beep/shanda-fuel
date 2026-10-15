import { useId } from 'react';

import { cylinderDepth, type TankLevel } from './tank-overview-model';

// Horizontal storage tank in viewBox units: a brushed-steel cylinder with a
// glass sight section inset in the shell, on two low saddles.
const LEFT = 8;
const RIGHT = 152;
const TOP = 24;
const BOTTOM = 82;
const BODY_H = BOTTOM - TOP;
const END = 24;
const INSET = 3.5;
const WAVE_AMPLITUDE = 2;
const WAVELENGTH = 40;

const IN_LEFT = LEFT + INSET;
const IN_RIGHT = RIGHT - INSET;
const IN_TOP = TOP + INSET;
const IN_BOTTOM = BOTTOM - INSET;
const IN_H = IN_BOTTOM - IN_TOP;

/** Rounded capsule outline between two x positions. */
function capsule(l: number, r: number, t: number, b: number, e: number): string {
  return `M${l + e} ${t} H${r - e} Q${r} ${t} ${r} ${t + e} V${b - e} Q${r} ${b} ${r - e} ${b} H${l + e} Q${l} ${b} ${l} ${b - e} V${t + e} Q${l} ${t} ${l + e} ${t}Z`;
}

/** Y of the liquid surface for a volume percent, accounting for the round section. */
function surfaceY(percent: number): number {
  return IN_BOTTOM - IN_H * cylinderDepth(percent / 100);
}

/** One wavelength repeated across the tank plus a spare, so a shift of one wavelength loops. */
function wavePath(phase: 1 | -1): string {
  const waves = Math.ceil((IN_RIGHT - IN_LEFT) / WAVELENGTH) + 2;
  const half = WAVELENGTH / 2;
  let d = `M${IN_LEFT - WAVELENGTH} 0`;
  for (let i = 0; i < waves; i += 1) {
    d += ` q${half / 2} ${-WAVE_AMPLITUDE * phase * 2} ${half} 0 q${half / 2} ${WAVE_AMPLITUDE * phase * 2} ${half} 0`;
  }
  return `${d} V${IN_H + 10} H${IN_LEFT - WAVELENGTH}Z`;
}

const OUTER = capsule(LEFT, RIGHT, TOP, BOTTOM, END);
const INNER = capsule(IN_LEFT, IN_RIGHT, IN_TOP, IN_BOTTOM, END - INSET);
const FRONT_WAVE = wavePath(1);
const BACK_WAVE = wavePath(-1);

/**
 * Decorative tank showing how full it is. The figures beside it carry the exact
 * litres, so the drawing is hidden from assistive technology. The liquid colour
 * comes from the card's data-fuel; the steel from design-system tokens. Surface
 * depth follows the volume of a horizontal cylinder, not a straight percentage.
 * The liquid gently sloshes unless the visitor prefers reduced motion.
 */
export function TankDrum({ level }: { level: TankLevel }) {
  const id = useId();
  const clip = `${id}-clip`;
  const liquid = `${id}-liquid`;
  const steel = `${id}-steel`;
  const ends = `${id}-ends`;
  const glass = `${id}-glass`;
  const percent = level.percent;
  const surface = percent === null || percent <= 0 ? null : surfaceY(percent);
  const reorder = level.reorderPercent === null ? null : surfaceY(level.reorderPercent);

  return (
    <svg
      className="tank-drum"
      viewBox="0 0 160 108"
      aria-hidden="true"
      focusable="false"
      overflow="visible"
    >
      <defs>
        <clipPath id={clip}>
          <path d={INNER} />
        </clipPath>
        <linearGradient id={liquid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--fuel-top)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--fuel-mid)' }} />
          <stop offset="1" style={{ stopColor: 'var(--fuel-bottom)' }} />
        </linearGradient>
        {/* Brushed steel: bright upper shoulder, soft core, deep lower edge. */}
        <linearGradient id={steel} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--tank-steel-light)' }} />
          <stop offset="0.18" style={{ stopColor: 'var(--tank-steel-high)' }} />
          <stop offset="0.45" style={{ stopColor: 'var(--tank-steel-mid)' }} />
          <stop offset="1" style={{ stopColor: 'var(--tank-steel-dark)' }} />
        </linearGradient>
        {/* Darkens the rounded ends so the cylinder reads as a solid. */}
        <linearGradient id={ends} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.28" />
          <stop offset="0.14" stopColor="#000" stopOpacity="0" />
          <stop offset="0.86" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
        <linearGradient id={glass} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Glow of the fuel on the surface below, then the saddles. */}
      <ellipse className="tank-drum-glow" cx="80" cy="100" rx="58" ry="5" />
      <path className="tank-drum-saddle" d={`M26 ${BOTTOM - 3} L23 99 H51 L48 ${BOTTOM - 3}Z`} />
      <path
        className="tank-drum-saddle"
        d={`M112 ${BOTTOM - 3} L109 99 H137 L134 ${BOTTOM - 3}Z`}
      />

      {/* Minimal manway cap on top. */}
      <rect className="tank-drum-fitting" x="70" y={TOP - 6} width="20" height="7" rx="3" />

      <path d={OUTER} fill={`url(#${steel})`} />
      <path d={OUTER} fill={`url(#${ends})`} />

      <g clipPath={`url(#${clip})`}>
        <path className="tank-drum-glass" d={INNER} />
        {surface === null ? (
          level.percent === null ? (
            <path className="tank-drum-unknown" d={INNER} />
          ) : null
        ) : (
          <g
            className="tank-liquid"
            style={{ transformOrigin: `80px ${surface}px`, transformBox: 'view-box' }}
          >
            <g transform={`translate(0 ${surface + 1.2})`}>
              <path className="tank-wave tank-wave-back" d={BACK_WAVE} />
            </g>
            <g transform={`translate(0 ${surface})`}>
              <path className="tank-wave tank-wave-front" d={FRONT_WAVE} fill={`url(#${liquid})`} />
            </g>
          </g>
        )}
        {reorder === null ? null : (
          <line
            className="tank-drum-reorder"
            x1={IN_LEFT}
            x2={IN_RIGHT}
            y1={reorder}
            y2={reorder}
            strokeDasharray="2.5 3"
          />
        )}
        {/* Glass reflection and a soft lower shade over the liquid. */}
        <path className="tank-drum-reflection" d={INNER} fill={`url(#${glass})`} />
        <rect
          className="tank-drum-shine"
          x={IN_LEFT + 10}
          y={IN_TOP + 3}
          width={IN_RIGHT - IN_LEFT - 20}
          height="2.5"
          rx="1.25"
        />
      </g>

      {/* Polished collars. */}
      <line className="tank-drum-band" x1="50" x2="50" y1={TOP + 1} y2={BOTTOM - 1} />
      <line className="tank-drum-band" x1="110" x2="110" y1={TOP + 1} y2={BOTTOM - 1} />
      <path className="tank-drum-inner-edge" d={INNER} fill="none" />
      <path className="tank-drum-outline" d={OUTER} fill="none" />
    </svg>
  );
}
