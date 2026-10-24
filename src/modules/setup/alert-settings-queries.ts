import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { isPermissionGranted } from '../../platform/security/permissions';
import { alertSettingsFromRow, type AlertSettings } from '../approvals/operations-alerts';
import { resolveTenantExecutionContext } from '../tenancy/authority';

export type AlertSettingsView = Readonly<{
  settings: AlertSettings;
  /** Null until the organisation saves its own; the defaults apply until then. */
  version: number | null;
  canManage: boolean;
}>;

export async function getAlertSettingsFromRequest(
  request: Request,
  rawInput: unknown,
): Promise<AlertSettingsView> {
  const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(rawInput);
  const authority = await resolveTenantExecutionContext({ request, requestedTenantId: tenantId });
  const canManage = isPermissionGranted({
    actor: authority.authorization,
    permissionCode: 'tenant.manage',
    requestedScope: { tenantId, scopeType: 'TENANT' },
  });
  const [row] = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<{
      due_soon_days: number;
      pos_settlement_lag_days: number;
      report_grace_days: number;
      cash_shortage_minimum: string;
      version: number | string;
    }>(sql`
      select due_soon_days, pos_settlement_lag_days, report_grace_days,
             cash_shortage_minimum::text as cash_shortage_minimum, version
      from app.alert_settings where tenant_id = ${tenantId}
    `),
  );
  return {
    settings: alertSettingsFromRow(row),
    version: row ? Number(row.version) : null,
    canManage,
  };
}
