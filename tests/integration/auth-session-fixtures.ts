import type { Sql } from 'postgres';

/**
 * Seed the persisted session state required by the production step-up
 * validator. Integration actors receive this only when their scenario
 * intentionally exercises a STEP_UP command.
 */
export async function seedActiveStepUp(
  client: Sql,
  sessionId: string,
  tenantId: string,
  level: 1 | 2 = 1,
) {
  const rows = await client<{ id: string }[]>`
    update auth.session
    set strong_authentication_verified = true,
        strong_authenticated_at = now(),
        strong_authentication_expires_at = timestamp '2030-01-01 00:00:00',
        step_up_level = ${level},
        step_up_expires_at = timestamp '2030-01-01 00:00:00',
        step_up_tenant_id = ${tenantId}
    where id = ${sessionId}
    returning id
  `;
  if (rows.length !== 1) {
    throw new Error(`Expected integration session ${sessionId} to exist before granting step-up`);
  }
}
