type Client = { unsafe: (...args: never[]) => unknown };
const adapters = new WeakMap<object, object>();

/** Drizzle calls unsafe(), whose per-query default overrides client.prepare.
 * This adapter changes only that option; SQL, parameters and transaction commands
 * are delegated unchanged. It never mutates the underlying Postgres.js client.
 */
export function preparedDrizzleClient<T extends Client>(client: T): T {
  const existing = adapters.get(client);
  if (existing) return existing as T;
  const adapter = new Proxy(client, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key === 'unsafe' && typeof value === 'function')
        return (...args: unknown[]) => {
          const parameters = Array.isArray(args[1]) ? args[1] : [];
          const options = (Array.isArray(args[1]) ? args[2] : args[1]) ?? {};
          // Drizzle passes { prepare: false } on every unnamed query, so the caller's value cannot
          // win or nothing would ever be prepared. A prepared statement skips the describe round
          // trip on repeat runs and lets concurrent queries share one connection's pipeline.
          // Parameterless queries are left exactly as sent.
          return Reflect.apply(value, target, [
            args[0],
            parameters,
            parameters.length > 0 ? { ...(options as object), prepare: true } : options,
          ]);
        };
      if ((key === 'begin' || key === 'savepoint') && typeof value === 'function') {
        return (...args: unknown[]) =>
          Reflect.apply(
            value,
            target,
            args.map((arg) =>
              typeof arg === 'function'
                ? (transaction: Client) => arg(preparedDrizzleClient(transaction))
                : arg,
            ),
          );
      }
      return value;
    },
  });
  adapters.set(client, adapter);
  return adapter;
}
