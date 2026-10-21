import { notFound } from 'next/navigation';

import { isOwnerDemoBuildEnabled } from '@/platform/demo/owner-demo-guard';

import { OwnerDemoApp } from './owner-demo-app';

export const metadata = { title: 'Owner demo' };

// Keep the environment check request-time evaluated so a demo-built artifact
// cannot become active merely because runtime configuration changed.
export const dynamic = 'force-dynamic';

/**
 * This route is deliberately separate from the authenticated product shell.
 * It is a browser-local synthetic walkthrough and never reads or writes the
 * application database.
 */
export default function OwnerDemoPage() {
  if (!isOwnerDemoBuildEnabled()) notFound();
  return <OwnerDemoApp />;
}
