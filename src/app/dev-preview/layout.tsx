import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { isDevOnlySurfaceAvailable } from '@/design-system/reference/availability';

/** UI-only preview with fixture data. It never exists outside local development. */
export default function DevPreviewLayout({ children }: { children: ReactNode }) {
  if (!isDevOnlySurfaceAvailable()) notFound();
  return children;
}
