'use client';

import { useId } from 'react';

import { Icon, type IconName } from './icons';
import type { ThemePreference } from './theme';
import { useThemePreference } from './theme-runtime';

const options: readonly { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

/**
 * Product Shell theme control: a compact segmented radio group. Native radios
 * give arrow-key movement and a single tab stop for free. System (device
 * preference) is the default; an explicit choice persists per device.
 */
export function ThemeControl({ className = '' }: { className?: string }) {
  const { preference, resolvedTheme, setPreference } = useThemePreference();
  const name = `theme-${useId().replace(/:/g, '')}`;

  return (
    <fieldset className={`theme-control ${className}`.trim()}>
      <legend className="visually-hidden">Theme</legend>
      {options.map((option) => {
        const label =
          option.value === 'system' ? `${option.label} (currently ${resolvedTheme})` : option.label;
        return (
          <label className="theme-option" key={option.value} title={label}>
            <input
              className="theme-option-input"
              type="radio"
              name={name}
              value={option.value}
              checked={preference === option.value}
              onChange={() => setPreference(option.value)}
            />
            <Icon name={option.icon} />
            <span className="visually-hidden">{label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
