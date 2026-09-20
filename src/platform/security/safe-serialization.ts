const sensitiveField =
  /(account(number|_number)?|secret|password|token|cookie|authorization|private.?key|api.?key)/i;

export type SerializationPolicy = {
  allowSensitiveFields?: readonly string[];
};

/** Serialize server data without relying on UI hiding to protect sensitive fields. */
export function serializeSafe<T>(value: T, policy: SerializationPolicy = {}): T {
  const allowed = new Set(policy.allowSensitiveFields ?? []);

  const visit = (current: unknown, path: string): unknown => {
    if (Array.isArray(current))
      return current.map((item, index) => visit(item, `${path}[${index}]`));
    if (!current || typeof current !== 'object') return current;
    return Object.fromEntries(
      Object.entries(current).flatMap(([key, child]) => {
        const childPath = path ? `${path}.${key}` : key;
        if (sensitiveField.test(key) && !allowed.has(childPath) && !allowed.has(key)) return [];
        return [[key, visit(child, childPath)]];
      }),
    );
  };

  return visit(value, '') as T;
}
