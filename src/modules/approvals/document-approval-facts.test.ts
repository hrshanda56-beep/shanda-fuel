import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ can: vi.fn() }));
vi.mock('../../platform/security/permissions', () => ({ isPermissionGranted: mocks.can }));
import { loadDocumentApprovalFacts } from './document-approval-facts';
import type { InventoryCommandContext, InventoryTransaction } from '../inventory/application';
const context = {
  tenantId: 'tenant',
  legalEntityId: 'entity',
  stationId: 'station',
  scope: {},
  authority: { authorization: { membershipId: 'me' } },
} as unknown as InventoryCommandContext;
beforeEach(() => vi.clearAllMocks());
it('reads each queue once and marks the requester and the sole approver', async () => {
  mocks.can.mockReturnValue(true);
  const execute = vi.fn().mockResolvedValue([
    {
      prices: [{ id: 'p', requested_by: 'me', unit_price: '1.650000', product_name: 'Diesel' }],
      orders: [],
      invoices: [{ supplier_id: 's', document_type: 'INVOICE', count: 3 }],
      other_price_approver: false,
      other_order_approver: true,
    },
  ]);
  const result = await loadDocumentApprovalFacts(
    { execute } as unknown as InventoryTransaction,
    context,
  );
  expect(result.prices?.rows[0]?.requestedByMe).toBe(true);
  expect(result.prices?.soleApprover).toBe(true);
  expect(result.orders?.soleApprover).toBe(false);
  expect(result.invoices?.rows).toEqual([{ supplierId: 's', documentType: 'INVOICE', count: 3 }]);
  expect(execute).toHaveBeenCalledTimes(1);
});
it('does not read queues the person cannot act on', async () => {
  mocks.can.mockReturnValue(false);
  const execute = vi.fn();
  expect(
    await loadDocumentApprovalFacts({ execute } as unknown as InventoryTransaction, context),
  ).toEqual({ prices: null, orders: null, invoices: null });
  expect(execute).not.toHaveBeenCalled();
});
