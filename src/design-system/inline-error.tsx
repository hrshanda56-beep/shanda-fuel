'use client';

import { useEffect, useRef } from 'react';

import { Button } from './primitives';
import { isRetryable, type UserMessage } from './user-messages';

/**
 * A failure shown right next to the button that caused it. It takes keyboard focus when it appears so
 * screen-reader and keyboard users land on it. "Try again" only appears when retrying can help.
 */
export function InlineError({
  error,
  onRetry,
  className = '',
}: {
  error: UserMessage | null | undefined;
  onRetry?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const code = error?.code;
  const title = error?.title;
  useEffect(() => {
    if (title) ref.current?.focus();
  }, [code, title]);
  if (!error) return null;
  return (
    <div
      ref={ref}
      className={`inline-error ${className}`.trim()}
      role="alert"
      tabIndex={-1}
      data-code={error.code}
    >
      <strong>{error.title}</strong>
      <p>{error.body}</p>
      {onRetry && isRetryable(error.code) ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
