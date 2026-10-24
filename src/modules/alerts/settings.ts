import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorize, isPermissionGranted } from '../../platform/security/permissions';
import {
  executeInventoryCommand,
  requestHash,
  resolveInventoryCommandContext,
} from '../inventory/application';

/**
 * Alert email settings (ADR-020, owner decision 21). Two switches:
 * - the organisation's master switch, OFF until the owner or an administrator turns it on;
 * - a person's own switch: everyone starts as "receive" once the master switch is on, and can
 *   switch themselves off. A person can only change their own.
 * Both changes are idempotent and write a signed audit event, like every other setup command.
 */

const uuid = z.string().uuid();
const authority = z.object({ tenantId: uuid, stationId: uuid });
const masterPayload = authority.extend({
  enabled: z.boolean(),
  /** Omit when the switch has never been saved; required to change a saved one. */
  expectedVersion: z.number().int().nonnegative().optional(),
});
const personalPayload = authority.extend({ receive: z.boolean() });

export type AlertEmailView = Readonly<{
  enabled: boolean;
  version: number | null;
  canManage: boolean;
  receive: boolean;
}>;

function keyOf(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  return key;
}

export async function getAlertEmailFromRequest(
  request: Request,
  rawInput: unknown,
): Promise<AlertEmailView> {
  const input = authority.parse(rawInput);
  const context = await resolveInventoryCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'station.view',
    requestedScope: context.scope,
  });
  const canManage = isPermissionGranted({
    actor: context.authority.authorization,
    permissionCode: 'tenant.manage',
    requestedScope: { tenantId: context.tenantId, scopeType: 'TENANT' },
  });
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const [master] = await transaction.execute<{ enabled: boolean; version: number | string }>(sql`
      select enabled, version from app.alert_email_settings where tenant_id = ${context.tenantId}
    `);
    const [mine] = await transaction.execute<{ receive: boolean }>(sql`
      select receive from app.alert_email_preferences
      where tenant_id = ${context.tenantId}
        and membership_id = ${context.authority.membership.membershipId}
    `);
    return {
      enabled: master?.enabled ?? false,
      version: master ? Number(master.version) : null,
      canManage,
      receive: mine?.receive ?? true,
    };
  });
}

/** Owner or administrator: turn alert email on or off for the whole organisation. */
export async function setAlertEmailEnabledFromRequest(request: Request, rawInput: unknown) {
  const payload = masterPayload.parse(rawInput);
  const key = keyOf(request);
  const context = await resolveInventoryCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
  });
  return executeInventoryCommand({
    context,
    commandType: 'Setup.SetAlertEmailEnabled',
    permissionCode: 'tenant.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.ALERT_EMAIL_ENABLED_SET',
      subjectType: 'AlertEmailSettings',
      subjectId: () => context.tenantId,
    },
    execute: async (transaction) => {
      authorize({
        actor: context.authority.authorization,
        permissionCode: 'tenant.manage',
        requestedScope: { tenantId: context.tenantId, scopeType: 'TENANT' },
      });
      const membershipId = context.authority.membership.membershipId;
      const existing = await transaction.execute<{ version: number | string }>(sql`
        select version from app.alert_email_settings where tenant_id = ${context.tenantId} for update
      `);
      if (!existing[0]) {
        if (payload.expectedVersion !== undefined && payload.expectedVersion !== 0) {
          throw new AppError('CONFLICT', 'The setting changed. Refresh and try again.');
        }
        await transaction.execute(sql`
          insert into app.alert_email_settings (tenant_id, enabled, version, updated_by)
          values (${context.tenantId}, ${payload.enabled}, 0, ${membershipId})
        `);
        return { enabled: payload.enabled, version: 0 };
      }
      if (
        payload.expectedVersion === undefined ||
        payload.expectedVersion !== Number(existing[0].version)
      ) {
        throw new AppError('CONFLICT', 'Someone else changed this setting. Refresh and try again.');
      }
      const updated = await transaction.execute<{ version: number | string }>(sql`
        update app.alert_email_settings
        set enabled = ${payload.enabled}, version = version + 1,
            updated_by = ${membershipId}, updated_at = now()
        where tenant_id = ${context.tenantId}
        returning version
      `);
      return { enabled: payload.enabled, version: Number(updated[0]!.version) };
    },
  });
}

/** Anyone: switch their own alert emails off or back on. */
export async function setMyAlertEmailFromRequest(request: Request, rawInput: unknown) {
  const payload = personalPayload.parse(rawInput);
  const key = keyOf(request);
  const context = await resolveInventoryCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
  });
  const membershipId = context.authority.membership.membershipId;
  return executeInventoryCommand({
    context,
    commandType: 'Setup.SetMyAlertEmail',
    permissionCode: 'station.view',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'SETUP.ALERT_EMAIL_PREFERENCE_SET',
      subjectType: 'AlertEmailPreference',
      subjectId: () => membershipId,
    },
    execute: async (transaction) => {
      await transaction.execute(sql`
        insert into app.alert_email_preferences (tenant_id, membership_id, receive)
        values (${context.tenantId}, ${membershipId}, ${payload.receive})
        on conflict (tenant_id, membership_id)
        do update set receive = excluded.receive, updated_at = now()
      `);
      return { receive: payload.receive };
    },
  });
}
