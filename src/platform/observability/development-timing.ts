import 'server-only';

/**
 * Development/test-only server timing hook.
 *
 * The application never installs a production sink. Spans contain only a
 * fixed stage name and elapsed milliseconds; request headers, SQL, parameters,
 * tenant identifiers and returned data are intentionally out of scope.
 */
export type DevelopmentTimingSpan = Readonly<{
  stage: string;
  durationMs: number;
}>;

type DevelopmentTimingSink = (span: DevelopmentTimingSpan) => void;

let sink: DevelopmentTimingSink | undefined;

export function installDevelopmentTimingSinkForTests(nextSink: DevelopmentTimingSink): () => void {
  if (process.env.NODE_ENV === 'production') return () => undefined;

  const previous = sink;
  sink = nextSink;
  return () => {
    if (sink === nextSink) sink = previous;
  };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}

export async function withDevelopmentTiming<T>(
  stage: string,
  work: () => T | Promise<T>,
): Promise<T> {
  if (!sink) return work();

  const startedAt = performance.now();
  try {
    return await work();
  } finally {
    sink?.({ stage, durationMs: elapsedMs(startedAt) });
  }
}
