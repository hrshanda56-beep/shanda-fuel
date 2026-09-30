'use client';

import { RouteError } from '@/design-system/route-states';

/** Route error boundary: keeps the Product Shell and offers a retry. */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError digest={error.digest} retry={retry} />;
}
