import { describe, expect, it } from 'vitest';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import {
  createForecourtCommandContext,
  executeForecourtCommand,
  type ForecourtCommandPorts,
} from './application';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  legal: '22222222-2222-4222-8222-222222222222',
  station: '33333333-3333-4333-8333-333333333333',
  actor: '44444444-4444-4444-8444-444444444444',
  membership: '55555555-5555-4555-8555-555555555555',
  request: '66666666-6666-4666-8666-666666666666',
};

function context(
  roleCode: 'SUPERVISOR' | 'FINANCE' = 'SUPERVISOR',
  authorizedStationId = ids.station,
) {
  const transaction = createTrustedTenantTransactionContext({
    tenantId: ids.tenant,
    actorId: ids.actor,
    membershipId: ids.membership,
    requestId: ids.request,
  });
  const authority = {
    actor: {
      identityId: ids.actor,
      session: {
        sessionId: '77777777-7777-4777-8777-777777777777',
        userId: ids.actor,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    },
    membership: {
      tenantId: ids.tenant,
      membershipId: ids.membership,
      identityId: ids.actor,
      actorId: ids.actor,
      status: 'ACTIVE' as const,
      roleAssignments: [
        {
          tenantId: ids.tenant,
          scopeType: 'STATION' as const,
          legalEntityId: ids.legal,
          stationId: authorizedStationId,
          roleCode,
        },
      ],
      temporaryGrants: [],
    },
    authorization: {
      userId: ids.actor,
      membershipId: ids.membership,
      tenantId: ids.tenant,
      membershipActive: true,
      roleAssignments: [
        {
          tenantId: ids.tenant,
          scopeType: 'STATION' as const,
          legalEntityId: ids.legal,
          stationId: authorizedStationId,
          roleCode,
        },
      ],
      temporaryGrants: [],
    },
    transaction,
  };
  return createForecourtCommandContext({
    authority,
    station: { id: ids.station, tenantId: ids.tenant, legalEntityId: ids.legal },
  });
}

function ports(calls: string[], shouldFail = false): ForecourtCommandPorts {
  return {
    transaction: {
      run: async (_context, work) => {
        calls.push('transaction.begin');
        try {
          const result = await work({ transactionId: 'tx-1' });
          calls.push('transaction.commit');
          return result;
        } catch (error) {
          calls.push('transaction.rollback');
          throw error;
        }
      },
    },
    idempotency: {
      run: async (_transaction, request, effect) => {
        calls.push(
          `idempotency:${request.tenantId}:${request.commandType}:${request.idempotencyKey}`,
        );
        return effect();
      },
    },
    audit: {
      append: async () => {
        calls.push('audit');
        if (shouldFail) throw new Error('audit failure');
      },
    },
    outbox: {
      publish: async () => {
        calls.push('outbox');
      },
    },
  };
}

describe('A3 authoritative command seam', () => {
  it('authorizes and executes all side effects on one transaction', async () => {
    const calls: string[] = [];
    const result = await executeForecourtCommand({
      context: context(),
      commandType: 'CaptureBoundary',
      permissionCode: 'meter.boundary.capture',
      idempotencyKey: 'retry-key-1',
      requestHash: 'hash-1',
      subjectType: 'MeterBoundary',
      subjectId: ids.station,
      ports: ports(calls),
      execute: async () => {
        calls.push('business');
        return { result: 'captured' as const };
      },
    });
    expect(result).toBe('captured');
    expect(calls).toEqual([
      'transaction.begin',
      'idempotency:11111111-1111-4111-8111-111111111111:CaptureBoundary:retry-key-1',
      'business',
      'audit',
      'transaction.commit',
    ]);
  });

  it('rolls back business state, idempotency, audit, and outbox when persistence fails', async () => {
    const calls: string[] = [];
    await expect(
      executeForecourtCommand({
        context: context(),
        commandType: 'CaptureBoundary',
        permissionCode: 'meter.boundary.capture',
        idempotencyKey: 'retry-key-2',
        requestHash: 'hash-2',
        subjectType: 'MeterBoundary',
        subjectId: ids.station,
        ports: ports(calls, true),
        execute: async () => ({ result: 'captured' as const }),
      }),
    ).rejects.toThrow('audit failure');
    expect(calls).toContain('transaction.rollback');
    expect(calls).not.toContain('transaction.commit');
    expect(calls).not.toContain('outbox');
  });

  it('rejects a caller-built context before opening a transaction', async () => {
    const calls: string[] = [];
    await expect(
      executeForecourtCommand({
        context: {} as never,
        commandType: 'CaptureBoundary',
        permissionCode: 'meter.boundary.capture',
        idempotencyKey: 'retry-key-3',
        requestHash: 'hash-3',
        subjectType: 'MeterBoundary',
        subjectId: ids.station,
        ports: ports(calls),
        execute: async () => ({ result: 'captured' as const }),
      }),
    ).rejects.toThrow(/server-resolved/);
    expect(calls).toEqual([]);
  });

  it('denies same-tenant cross-station operation and high-risk approval without assurance', async () => {
    const calls: string[] = [];
    await expect(
      executeForecourtCommand({
        context: context('SUPERVISOR', '88888888-8888-4888-8888-888888888888'),
        commandType: 'CaptureBoundary',
        permissionCode: 'meter.boundary.capture',
        idempotencyKey: 'retry-key-4',
        requestHash: 'hash-4',
        subjectType: 'MeterBoundary',
        subjectId: ids.station,
        ports: ports(calls),
        execute: async () => ({ result: 'captured' as const }),
      }),
    ).rejects.toThrow(/not authorized/);

    await expect(
      executeForecourtCommand({
        context: context('FINANCE'),
        commandType: 'ApproveReconciliation',
        permissionCode: 'reconciliation.approve',
        idempotencyKey: 'retry-key-5',
        requestHash: 'hash-5',
        subjectType: 'ReconciliationRevision',
        subjectId: ids.station,
        ports: ports(calls),
        execute: async () => ({ result: 'approved' as const }),
      }),
    ).rejects.toThrow(/not authorized/);
  });
});
