import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

import { Icon } from './icons';

/**
 * Form controls beyond text inputs. Plain `<input>`, `<select>` and
 * `<textarea>` are already styled globally; wrap them in `Field` for label,
 * hint, and error wiring. These components cover the cases where structure
 * matters (checkable controls, grouped choices, progressive disclosure).
 */

type SelectOption = { value: string; label: string; disabled?: boolean };

/**
 * Native select with the design-system treatment. Use inside `Field`.
 * Native keeps keyboard, screen reader, and mobile pickers correct for free.
 */
export function Select({
  options,
  placeholder,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  options: readonly SelectOption[];
  /** Renders a disabled first option, e.g. "Choose a station". */
  placeholder?: string;
}) {
  return (
    <select {...props}>
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

type CheckableProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
  hint?: ReactNode;
};

function Checkable({
  type,
  label,
  hint,
  className = '',
  ...props
}: CheckableProps & { type: 'checkbox' | 'radio' }) {
  return (
    <label className={`check ${className}`.trim()}>
      <input type={type} {...props} />
      <span className="check-text">
        <span>{label}</span>
        {hint ? <span className="check-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Checkbox(props: CheckableProps) {
  return <Checkable type="checkbox" {...props} />;
}

export function Radio(props: CheckableProps) {
  return <Checkable type="radio" {...props} />;
}

/** Groups related controls under one visible legend (radio groups, checkbox sets). */
export function Fieldset({
  legend,
  hint,
  children,
  className = '',
}: {
  legend: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={`fieldset ${className}`.trim()}>
      <legend>{legend}</legend>
      {hint ? <p className="field-hint">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

/**
 * Progressive disclosure for secondary or advanced fields. Built on native
 * details/summary so it is keyboard and screen-reader correct without JS.
 * Never hide required fields inside a closed disclosure.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="disclosure" open={defaultOpen || undefined}>
      <summary>
        <span>{summary}</span>
        <Icon name="chevron-down" />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
