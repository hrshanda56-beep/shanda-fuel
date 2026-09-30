import type { Metadata } from 'next';

import { RouteNotFound } from '@/design-system/route-states';

export const metadata: Metadata = { title: 'Page not found · Shanda Fuel' };

export default function NotFound() {
  return <RouteNotFound />;
}
