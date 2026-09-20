import { AppError } from '@/platform/errors';

export type TenantTransactionContext = {
  tenantId: string;
  actorId: string;
  legalEntityId?: string;
  stationId?: string;
};

export function assertTenantTransactionContext(context: TenantTransactionContext): void {
  if (!context.tenantId || !context.actorId) {
    throw new AppError('FORBIDDEN', 'Tenant and actor context are required for database work');
  }
}
