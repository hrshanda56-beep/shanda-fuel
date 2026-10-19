import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { authorize } from '../../platform/security/permissions';
import { getStationProductStock, getTankVariance } from './persistence';
import { sql } from 'drizzle-orm';
import {
  authorizeInventoryCommand,
  resolveInventoryCommandContext,
  withInventoryReadContext,
} from './application';

const queryInput = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  tankId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
});

export async function queryInventoryStock(input: {
  request: Request;
  tenantId: string;
  stationId: string;
  tankId?: string;
  productId?: string;
}) {
  const parsed = queryInput.parse(input);
  const context = await resolveInventoryCommandContext({
    request: input.request,
    requestedTenantId: parsed.tenantId,
    stationId: parsed.stationId,
  });
  // Context resolution proves tenant/station scope only; stock is management data.
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'inventory.view',
    requestedScope: context.scope,
  });
  if (parsed.tankId) {
    if (parsed.productId) {
      const position = await getTankVariance(context, parsed.tankId);
      if (position.productId !== parsed.productId) {
        throw new AppError('NOT_FOUND', 'The requested tank/product position was not found');
      }
      return [position];
    }
    return [await getTankVariance(context, parsed.tankId)];
  }
  if (!parsed.productId) {
    throw new AppError('VALIDATION_FAILED', 'tankId or productId is required');
  }
  return getStationProductStock(context, parsed.productId);
}

export type DeliverySupplierOption = Readonly<{ id: string; code: string; name: string }>;

/**
 * Suppliers a delivery may be received from: ACTIVE suppliers of the tenant, id/code/name
 * only. Authorized by inventory.delivery.manage at the station (the permission CreateDelivery
 * uses), so receiving staff need no creditor access. No balances or documents are exposed.
 */
export async function queryDeliverySuppliers(input: {
  request: Request;
  tenantId: string;
  stationId: string;
}): Promise<DeliverySupplierOption[]> {
  const parsed = z
    .object({ tenantId: z.string().uuid(), stationId: z.string().uuid() })
    .parse({ tenantId: input.tenantId, stationId: input.stationId });
  return withInventoryReadContext(
    input.request,
    parsed.tenantId,
    parsed.stationId,
    async (transaction, context) => {
      authorizeInventoryCommand(context, 'inventory.delivery.manage');
      const rows = await transaction.execute<{ id: string; code: string; legal_name: string }>(sql`
        select id, code, legal_name
        from app.suppliers
        where tenant_id = ${context.tenantId} and status = 'ACTIVE'
        order by legal_name, code
      `);
      return rows.map((row) => ({ id: row.id, code: row.code, name: row.legal_name }));
    },
  );
}
