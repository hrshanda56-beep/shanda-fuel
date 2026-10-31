import type { ReactNode } from 'react';

/**
 * One labelled figure of a pump or tank row. It has a form field's label size and height, so a row
 * that mixes readouts and fields still lines up; `result` marks the figure the others work out to.
 */
export function PumpReadout({
  label,
  value,
  unit,
  result = false,
}: Readonly<{
  label: string;
  value: ReactNode;
  unit?: string;
  result?: boolean;
}>) {
  return (
    <div className="pump-readout" data-result={result || undefined}>
      <span className="pump-readout-label">{label}</span>
      <span className="pump-readout-value">
        {value}
        {unit ? <span className="pump-readout-unit">{unit}</span> : null}
      </span>
    </div>
  );
}
