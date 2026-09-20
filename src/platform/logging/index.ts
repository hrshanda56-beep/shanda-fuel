const sensitiveKey = /(authorization|cookie|secret|password|token|api[-_]?key|database|private)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : redact(child),
      ]),
    );
  }
  return value;
}

export function createLogger(base: Record<string, unknown> = {}) {
  const write = (
    level: 'info' | 'warn' | 'error',
    message: string,
    fields: Record<string, unknown> = {},
  ) => {
    const record = redact({
      level,
      message,
      ...base,
      ...fields,
      timestamp: new Date().toISOString(),
    });
    console[level](JSON.stringify(record));
  };

  return {
    info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
    error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
  };
}
