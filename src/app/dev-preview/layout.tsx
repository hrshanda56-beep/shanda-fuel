import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/** UI-only preview with fixture data. It never exists outside local development. */
export default function DevPreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  return children;
}
