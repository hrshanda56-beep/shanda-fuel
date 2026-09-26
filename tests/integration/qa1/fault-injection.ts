import type { Sql } from 'postgres';

/**
 * Installs only a test-local database fault and always removes it. The trigger
 * is intentionally on append-only audit evidence: a command that cannot write
 * its audit row must roll back every economic write in the same transaction.
 */
export async function withAuditFailure<T>(client: Sql, operation: () => Promise<T>): Promise<T> {
  await client.unsafe(`
    create or replace function public.qa1_fail_audit() returns trigger
    language plpgsql as $$
    begin
      raise exception 'QA1 injected audit failure';
    end;
    $$;
    drop trigger if exists qa1_fail_audit_trigger on platform.security_events;
    create trigger qa1_fail_audit_trigger
      before insert on platform.security_events
      for each row execute function public.qa1_fail_audit();
  `);
  try {
    return await operation();
  } finally {
    await client.unsafe(`
      drop trigger if exists qa1_fail_audit_trigger on platform.security_events;
      drop function if exists public.qa1_fail_audit();
    `);
  }
}
