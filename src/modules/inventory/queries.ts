import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { authorize } from '../../platform/security/permissions';
import { getStationProductStock, getTankVariance } from './persistence';
import { resolveInventoryCommandContext } from './application';

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
