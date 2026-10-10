import type { InventoryContext } from '@/modules/inventory/ui/inventory-workspace';

/** Matches the ids the local UI proxy serves, so the valuation reads line up. */
export const PREVIEW_INVENTORY_CONTEXT: InventoryContext = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  legalEntityId: '00000000-0000-4000-8000-000000000002',
  stationId: '00000000-0000-4000-8000-000000000003',
  organisationName: 'Shanda Fuel (preview)',
  legalEntityName: 'Shanda Energy Ltd',
  stationName: 'Harare Central',
  stationTimezone: 'Africa/Harare',
};

export const PREVIEW_CONTEXT_HREF =
  '/inventory/valuation?tenantId=00000000-0000-4000-8000-000000000001&legalEntityId=00000000-0000-4000-8000-000000000002&stationId=00000000-0000-4000-8000-000000000003';
