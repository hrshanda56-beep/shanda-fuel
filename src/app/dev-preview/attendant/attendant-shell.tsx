'use client';

import type { ReactNode } from 'react';

import { AppShell } from '@/design-system/app-shell';
import { emptyNavigationProjection } from '@/design-system/navigation-projection';
import type { NavigationProjection } from '@/design-system/navigation';

/** What a real attendant is projected: My Shift and nothing else. */
const ATTENDANT_PROJECTION: readonly NavigationProjection[] = emptyNavigationProjection.map(
  (entry) => (entry.key === 'my-shift' ? { key: 'my-shift', visible: true, enabled: true } : entry),
);

export function AttendantShell({ children }: { children: ReactNode }) {
  return <AppShell navigationProjection={ATTENDANT_PROJECTION}>{children}</AppShell>;
}
