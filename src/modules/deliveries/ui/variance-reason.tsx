'use client';

import { Field } from '@/design-system/primitives';
import { VARIANCE_CAUSES, VARIANCE_CAUSE_LABELS, type VarianceCause } from '../variance-assessment';

export type VarianceReasonValue = {
  cause: VarianceCause | '';
  note: string;
  temperature: string;
};

export const EMPTY_VARIANCE_REASON: VarianceReasonValue = { cause: '', note: '', temperature: '' };

/** The body fields the server reads; empty answers are left out. */
export function varianceFields(value: VarianceReasonValue) {
  return {
    ...(value.cause ? { varianceCause: value.cause } : {}),
    ...(value.note.trim() ? { varianceNote: value.note.trim() } : {}),
    ...(value.temperature.trim() ? { loadTemperatureC: value.temperature.trim() } : {}),
  };
}

/**
 * Asked only when the litres received differ from the note. The server decides whether the
 * difference is big enough to need an answer (the owner sets the allowance), so this never
 * blocks on its own; a missing answer comes back as a plain message when the delivery is saved.
 */
export function VarianceReason({
  value,
  onChange,
}: {
  value: VarianceReasonValue;
  onChange: (next: VarianceReasonValue) => void;
}) {
  return (
    <div className="form-stack">
      <Field
        id="rd-variance-cause"
        label="Why is it different?"
        hint="Fuel can shrink or grow with the weather, or go missing on the road. If the difference is more than your allowance you must say why."
        optional
      >
        <select
          id="rd-variance-cause"
          value={value.cause}
          onChange={(event) =>
            onChange({ ...value, cause: event.target.value as VarianceCause | '' })
          }
        >
          <option value="">Choose a reason</option>
          {VARIANCE_CAUSES.map((cause) => (
            <option key={cause} value={cause}>
              {VARIANCE_CAUSE_LABELS[cause]}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="rd-variance-note"
        label="What happened?"
        optional={value.cause !== 'OTHER'}
        required={value.cause === 'OTHER'}
      >
        <textarea
          id="rd-variance-note"
          rows={2}
          maxLength={500}
          value={value.note}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      </Field>
      <Field
        id="rd-load-temperature"
        label="Fuel temperature (°C)"
        hint="Kept as a record only. It does not change the litres."
        optional
      >
        <input
          id="rd-load-temperature"
          inputMode="decimal"
          autoComplete="off"
          value={value.temperature}
          onChange={(event) => onChange({ ...value, temperature: event.target.value })}
        />
      </Field>
    </div>
  );
}
