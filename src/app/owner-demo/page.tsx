import { notFound } from 'next/navigation';

import { isOwnerDemoBuildEnabled } from '@/platform/demo/owner-demo-guard';

import { OwnerDemoApp } from './owner-demo-app';

export const metadata = {
  title: 'Owner demo',
};

// Do not prerender this route: APP_ENV must be checked at request time too,
// so a demo-built artifact cannot become active if runtime configuration is
// later changed to production.
export const dynamic = 'force-dynamic';

/**
 * This route is deliberately separate from the authenticated product shell.
 * It is a synthetic browser-local demonstration and is never a fallback for
 * the normal application routes or their database-backed auth.
 */
export default function OwnerDemoPage() {
  if (!isOwnerDemoBuildEnabled()) notFound();
  return <OwnerDemoApp />;
}
