import { expect } from 'vitest';
import { ExactDecimal } from '../../../src/platform/domain/primitives';
import type { Qa1Snapshot } from './snapshots';

export function expectStatus(
  result: { response: Response; body: Record<string, any> },
  status: number,
): void {
  expect(result.response.status, JSON.stringify(result.body)).toBe(status);
}

export function expectDecimal(actual: unknown, expected: string, label: string): void {
  expect(typeof actual, `${label} must be serialized as a decimal string`).toBe('string');
  expect(
    new ExactDecimal(actual as string).equals(new ExactDecimal(expected)),
    `${label}: ${String(actual)}`,
  ).toBe(true);
}

export function decimal(value: string): ExactDecimal {
  return new ExactDecimal(value);
}

export function expectNoAuthoritativeChange(before: Qa1Snapshot, after: Qa1Snapshot): void {
  expect(after.inventoryMovements).toEqual(before.inventoryMovements);
  expect(after.costEvents).toEqual(before.costEvents);
  expect(after.attributions).toEqual(before.attributions);
  expect(after.revaluations).toEqual(before.revaluations);
  expect(after.revaluationLines).toEqual(before.revaluationLines);
  expect(after.costProjection).toEqual(before.costProjection);
  expect(after.deliveries).toEqual(before.deliveries);
  expect(after.reconciliations).toEqual(before.reconciliations);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.reconciliationPayments).toEqual(before.reconciliationPayments);
  expect(after.cashCollections).toEqual(before.cashCollections);
  expect(after.cashCollectionAllocations).toEqual(before.cashCollectionAllocations);
  expect(after.cashMovements).toEqual(before.cashMovements);
  expect(after.bankDeposits).toEqual(before.bankDeposits);
  expect(after.bankDepositAllocations).toEqual(before.bankDepositAllocations);
  expect(after.suppliers).toEqual(before.suppliers);
  expect(after.supplierDocuments).toEqual(before.supplierDocuments);
  expect(after.supplierPayments).toEqual(before.supplierPayments);
  expect(after.supplierAllocations).toEqual(before.supplierAllocations);
  expect(after.supplierMovements).toEqual(before.supplierMovements);
  expect(after.customers).toEqual(before.customers);
  expect(after.customerAccounts).toEqual(before.customerAccounts);
  expect(after.customerLedger).toEqual(before.customerLedger);
  expect(after.customerAuthorizations).toEqual(before.customerAuthorizations);
  expect(after.providers).toEqual(before.providers);
  expect(after.providerAccounts).toEqual(before.providerAccounts);
  expect(after.settlements).toEqual(before.settlements);
  expect(after.settlementAllocations).toEqual(before.settlementAllocations);
  expect(after.reportSourceIds).toEqual(before.reportSourceIds);
  expect(after.audit).toEqual(before.audit);
  expect(after.idempotency).toEqual(before.idempotency);
  expect(after.outbox).toEqual(before.outbox);
}

export function expectConservation(
  parts: readonly string[],
  expected: string,
  label: string,
): void {
  const total = parts.reduce((sum, part) => sum.add(new ExactDecimal(part)), new ExactDecimal('0'));
  expect(total.equals(new ExactDecimal(expected)), `${label}: ${total.toString()}`).toBe(true);
}

export function expectOne<T>(rows: readonly T[], label: string): T {
  expect(rows, label).toHaveLength(1);
  return rows[0]!;
}
