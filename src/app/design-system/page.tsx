import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isDesignSystemReferenceAvailable } from '@/design-system/reference/availability';
import { DesignSystemReference } from '@/design-system/reference/design-system-reference';

export const metadata: Metadata = {
  title: 'Design system · Shanda Fuel',
  robots: { index: false, follow: false },
};

/**
 * Internal visual reference for the design-system foundation. Synthetic
 * content only; not a product screen. Intentionally a 404 in production
 * builds; see reference/availability.ts.
 */
export default function DesignSystemPage() {
  if (!isDesignSystemReferenceAvailable()) notFound();
  return <DesignSystemReference />;
}
