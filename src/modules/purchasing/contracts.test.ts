import { describe, expect, it } from 'vitest';
import {
  PURCHASING_COMMAND_POLICY,
  PURCHASING_COMMAND_SCHEMAS,
  PURCHASING_COMMAND_TYPES,
} from './contracts';

const ids = {
  tenantId: '90a00000-0000-4000-8000-000000000001',
  stationId: '90a00000-0000-4000-8000-000000000021',
  supplierId: '90a00000-0000-4000-8000-000000000061',
  productId: '90a00000-0000-4000-8000-000000000071',
};

describe('purchasing command contracts', () => {
  it('has a policy for every command and no step-up requirement', () => {
    for (const type of PURCHASING_COMMAND_TYPES) {
      const policy = PURCHASING_COMMAND_POLICY[type];
      expect(policy.permissionCode.startsWith('purchase_order.')).toBe(true);
      expect(policy.auditActionCode.startsWith('PURCHASE_ORDER.')).toBe(true);
      expect('alwaysStepUp' in policy).toBe(false);
    }
  });

  it('requires expectedVersion on every state-changing header command', () => {
    for (const type of [
      'SubmitPurchaseOrder',
      'ApprovePurchaseOrder',
      'AmendPurchaseOrder',
      'CancelPurchaseOrder',
      'ClosePurchaseOrder',
    ] as const) {
      expect(PURCHASING_COMMAND_POLICY[type].requiresExpectedVersion).toBe(true);
    }
  });

  it('accepts exact decimal strings and rejects numbers and extra decimals', () => {
    const create = PURCHASING_COMMAND_SCHEMAS.CreatePurchaseOrder;
    const base = {
      commandType: 'CreatePurchaseOrder',
      ...ids,
      orderDate: '2026-10-19',
      lines: [
        { productId: ids.productId, orderedLitres: '10000.125', agreedUnitPrice: '1.12345678' },
      ],
    };
    expect(create.safeParse(base).success).toBe(true);
    expect(
      create.safeParse({ ...base, lines: [{ productId: ids.productId, orderedLitres: 10000 }] })
        .success,
    ).toBe(false);
    expect(
      create.safeParse({ ...base, lines: [{ productId: ids.productId, orderedLitres: '1.0001' }] })
        .success,
    ).toBe(false);
    expect(
      create.safeParse({
        ...base,
        lines: [{ productId: ids.productId, orderedLitres: '1', agreedUnitPrice: '1.123456789' }],
      }).success,
    ).toBe(false);
    expect(create.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it('requires a reason to cancel and close', () => {
    for (const type of ['CancelPurchaseOrder', 'ClosePurchaseOrder'] as const) {
      const schema = PURCHASING_COMMAND_SCHEMAS[type];
      const base = {
        commandType: type,
        tenantId: ids.tenantId,
        stationId: ids.stationId,
        purchaseOrderId: ids.supplierId,
        expectedVersion: 1,
      };
      expect(schema.safeParse(base).success).toBe(false);
      expect(schema.safeParse({ ...base, reason: 'Supplier could not deliver' }).success).toBe(
        true,
      );
    }
  });
});
