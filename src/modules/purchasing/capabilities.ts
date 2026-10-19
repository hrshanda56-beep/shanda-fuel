import 'server-only';

import { isPermissionGranted } from '../../platform/security/permissions';
import { resolveTenantReadAuthority } from '../context/read-authority';
import type { PurchasingCapabilities } from './capabilities-types';

export type { PurchasingCapabilities } from './capabilities-types';

export async function getPurchasingCapabilitiesFromRequest(
  request: Request,
  tenantId: string,
): Promise<PurchasingCapabilities> {
  const { authority } = await resolveTenantReadAuthority({ request, tenantId });
  const may = (
    permissionCode:
      | 'purchase_order.view'
      | 'purchase_order.create'
      | 'purchase_order.approve'
      | 'purchase_order.cancel'
      | 'supplier.creditor.review'
      | 'supplier.view'
      | 'purchasing.policy.manage',
  ) =>
    isPermissionGranted({
      actor: authority.authorization,
      permissionCode,
      requestedScope: { tenantId, scopeType: 'TENANT' },
    });
  return {
    viewOrders: may('purchase_order.view'),
    createOrders: may('purchase_order.create'),
    approveOrders: may('purchase_order.approve'),
    cancelOrders: may('purchase_order.cancel'),
    reviewInvoices: may('supplier.creditor.review'),
    viewSettings: may('supplier.view'),
    manageSettings: may('purchasing.policy.manage'),
  };
}
