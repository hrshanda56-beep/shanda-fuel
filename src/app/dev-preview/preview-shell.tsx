'use client';

import { useState, type ReactNode } from 'react';

import { AppShell } from '@/design-system/app-shell';
import type { NavigationProjection } from '@/design-system/navigation';

import { installFixtureFetch } from './fixtures';

const KEYS = [
  'today',
  'daily-operations',
  'reconciliations',
  'inventory',
  'cash',
  'settlements',
  'customers',
  'suppliers',
  'reports',
  'settings',
] as const;

const PROJECTION: readonly NavigationProjection[] = [
  { key: 'my-shift', visible: false, enabled: false },
  ...KEYS.map((key) => ({ key, visible: true, enabled: true })),
];

/** The real client shell, fed a full navigation and fixture API answers. */
export function PreviewShell({ children }: { children: ReactNode }) {
  // Installed during render so it is in place before child effects fetch.
  useState(() => {
    if (typeof window !== 'undefined') installFixtureFetch();
  });
  return (
    <AppShell navigationProjection={PROJECTION} searchPlacement="header">
      <p
        role="note"
        className="preview-sample-banner"
        style={{
          margin: '0 0 12px',
          padding: '8px 12px',
          border: '1px dashed currentColor',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        SAMPLE DATA — development preview only. All figures are invented; none are business records.
        Scenario: ?scenario=normal | attention | unapproved | empty | loading | error
      </p>
      {children}
    </AppShell>
  );
}
