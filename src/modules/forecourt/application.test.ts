import { describe, expect, it } from 'vitest';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import type { SessionRecord } from '../../platform/security';
import {
  createForecourtCommandContext,
  executeForecourtCommand,
  FORECOURT_COMMAND_POLICY,
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
  roleCode: 'ATTENDANT' | 'SUPERVISOR' | 'FINANCE' = 'SUPERVISOR',
  authorizedStationId = ids.station,
  sessionOverrides: Partial<SessionRecord> = {},
) {
  const session: SessionRecord = {
    sessionId: '77777777-7777-4777-8777-777777777777',
    userId: ids.actor,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    stepUpTenantId: ids.tenant,
    ...sessionOverrides,
  };
  const transaction = createTrustedTenantTransactionContext({
    tenantId: ids.tenant,
    actorId: ids.actor,
    membershipId: ids.membership,
    requestId: ids.request,
  });
  const authority = {
    actor: {
      identityId: ids.actor,
      session,
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
      strongAuthenticationAt: session.strongAuthenticatedAt,
      strongAuthenticationExpiresAt: session.strongAuthenticationExpiresAt,
      strongAuthenticationVerified: session.strongAuthenticationVerified,
      stepUpLevel: session.stepUpLevel,
      stepUpTenantId: session.stepUpTenantId,
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

function ports(
  calls: string[],
  shouldFail = false,
  hooks: {
    attendantEligibility?: ForecourtCommandPorts['attendantEligibility'];
    expectedVersion?: ForecourtCommandPorts['expectedVersion'];
  } = {},
): ForecourtCommandPorts {
  return {
    transaction: {
      run: async (_context, work) => {
        calls.push('transaction.begin');
        try {
          const result = await work(undefined as never);
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
    attendantEligibility:
      hooks.attendantEligibility ??
      (async () => {
        calls.push('attendant-eligibility');
      }),
    expectedVersion:
      hooks.expectedVersion ??
      (async () => {
        calls.push('version');
      }),
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
  it('binds business-day locking to its dedicated permission', () => {
    expect(FORECOURT_COMMAND_POLICY.LockBusinessDay.permissionCode).toBe('business_day.lock');
    expect(FORECOURT_COMMAND_POLICY.LockBusinessDay.permissionCode).not.toBe('approval.act');
  });

  it('authorizes and executes all side effects on one transaction', async () => {
    const calls: string[] = [];
    const result = await executeForecourtCommand({
      context: context(),
      commandType: 'ConfirmBoundary',
      idempotencyKey: 'retry-key-1',
      requestHash: 'hash-1',
      subjectType: 'MeterBoundary',
      subjectId: ids.station,
      ports: ports(calls),
      responsibleAttendantId: ids.membership,
      expectedVersion: 0,
      execute: async () => {
        calls.push('business');
        return { result: 'captured' as const };
      },
    });
    expect(result).toBe('captured');
    expect(calls).toEqual([
      'transaction.begin',
      'idempotency:11111111-1111-4111-8111-111111111111:ConfirmBoundary:retry-key-1',
      'attendant-eligibility',
      'version',
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
        commandType: 'ConfirmBoundary',
        idempotencyKey: 'retry-key-2',
        requestHash: 'hash-2',
        subjectType: 'MeterBoundary',
        subjectId: ids.station,
        ports: ports(calls, true),
        responsibleAttendantId: ids.membership,
        expectedVersion: 0,
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
        commandType: 'ConfirmBoundary',
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
        commandType: 'ConfirmBoundary',
        idempotencyKey: 'retry-key-4',
        requestHash: 'hash-4',
        subjectType: 'MeterBoundary',
        subjectId: ids.station,
        ports: ports(calls),
        responsibleAttendantId: ids.membership,
        expectedVersion: 0,
        execute: async () => ({ result: 'captured' as const }),
      }),
    ).rejects.toThrow(/not authorized/);

    await expect(
      executeForecourtCommand({
        context: context('FINANCE'),
        commandType: 'ApproveReconciliation',
        idempotencyKey: 'retry-key-5',
        requestHash: 'hash-5',
        subjectType: 'ReconciliationRevision',
        subjectId: ids.station,
        ports: ports(calls),
        expectedVersion: 0,
        execute: async () => ({ result: 'approved' as const }),
      }),
    ).rejects.toThrow(/not authorized/);
  });

  it('keeps operational role boundaries on approval and price commands', async () => {
    await expect(
      executeForecourtCommand({
        context: context('ATTENDANT'),
        commandType: 'ApproveProductionReconciliation',
        idempotencyKey: 'role-attendant-approve',
        requestHash: 'role-attendant-approve-hash',
        subjectType: 'Reconciliation',
        subjectId: ids.station,
        expectedVersion: 0,
        ports: ports([]),
        execute: async () => ({ result: 'approved' as const }),
      }),
    ).rejects.toThrow(/not authorized/);

    await expect(
      executeForecourtCommand({
        context: context('FINANCE'),
        commandType: 'ApprovePriceChange',
        idempotencyKey: 'role-finance-price',
        requestHash: 'role-finance-price-hash',
        subjectType: 'SellingPrice',
        subjectId: ids.station,
        expectedVersion: 0,
        ports: ports([]),
        execute: async () => ({ result: 'approved' as const }),
      }),
    ).rejects.toThrow(/not authorized/);
  });

  it('requires an active step-up for forecourt STEP_UP commands', async () => {
    const now = Date.now();
    const strongAuthenticatedAt = new Date(now - 60_000);
    const strongAuthenticationExpiresAt = new Date(now + 30 * 60_000);
    const stepUpExpiresAt = new Date(now + 10 * 60_000);
    const stepUpCommand = {
      context: context('FINANCE', ids.station, {
        strongAuthenticatedAt,
        strongAuthenticationExpiresAt,
        strongAuthenticationVerified: true,
      }),
      commandType: 'ApproveReconciliation' as const,
      idempotencyKey: 'retry-step-up-none',
      requestHash: 'hash-step-up-none',
      subjectType: 'ReconciliationRevision',
      subjectId: ids.station,
      expectedVersion: 0,
      ports: ports([]),
      execute: async () => ({ result: 'approved' as const }),
    };
    await expect(executeForecourtCommand(stepUpCommand)).rejects.toThrow(/step-up/);

    await expect(
      executeForecourtCommand({
        ...stepUpCommand,
        context: context('FINANCE', ids.station, {
          strongAuthenticatedAt,
          strongAuthenticationExpiresAt,
          strongAuthenticationVerified: true,
          stepUpLevel: 1,
          stepUpExpiresAt: new Date(now - 60_000),
        }),
        idempotencyKey: 'retry-step-up-expired',
      }),
    ).rejects.toThrow(/step-up/);

    await expect(
      executeForecourtCommand({
        ...stepUpCommand,
        context: context('FINANCE', ids.station, {
          strongAuthenticatedAt,
          strongAuthenticationExpiresAt,
          strongAuthenticationVerified: true,
          stepUpLevel: 1,
          stepUpExpiresAt,
        }),
        idempotencyKey: 'retry-step-up-valid',
      }),
    ).resolves.toBe('approved');

    await expect(
      executeForecourtCommand({
        ...stepUpCommand,
        context: context('FINANCE', ids.station, {
          strongAuthenticatedAt,
          strongAuthenticationExpiresAt: new Date(now - 60_000),
          strongAuthenticationVerified: true,
          stepUpLevel: 2,
          stepUpExpiresAt,
        }),
        idempotencyKey: 'retry-step-up-strong-expired',
      }),
    ).rejects.toThrow(/not authorized|Strong authentication/);
  });

  it('requires and invokes the transaction-bound optimistic version check', async () => {
    const calls: string[] = [];
    await expect(
      executeForecourtCommand({
        context: context(),
        commandType: 'CloseMeters',
        idempotencyKey: 'retry-key-6',
        requestHash: 'hash-6',
        subjectType: 'Shift',
        subjectId: ids.station,
        expectedVersion: 4,
        ports: ports(calls, false, {
          expectedVersion: async (_transaction, _subjectType, _subjectId, version) => {
            calls.push(`version:${version}`);
            throw new Error('stale version');
          },
        }),
        execute: async () => ({ result: 'closed' as const }),
      }),
    ).rejects.toThrow('stale version');
    expect(calls).toContain('version:4');
    expect(calls).toContain('transaction.rollback');
    expect(calls).not.toContain('business');
  });

  it('ignores a forged caller permission and uses the command policy', async () => {
    const calls: string[] = [];
    const forged = {
      context: context('FINANCE'),
      commandType: 'StartShift',
      permissionCode: 'business_day.view',
      idempotencyKey: 'retry-key-7',
      requestHash: 'hash-7',
      subjectType: 'Shift',
      subjectId: ids.station,
      expectedVersion: 0,
      ports: ports(calls),
      execute: async () => ({ result: 'started' as const }),
    } as never;
    await expect(executeForecourtCommand(forged)).rejects.toThrow(/not authorized/);
    expect(calls).toContain('transaction.rollback');
  });

  it('does not make an on-behalf-of operation optional', async () => {
    const calls: string[] = [];
    await expect(
      executeForecourtCommand({
        context: context(),
        commandType: 'ConfirmBoundary',
        idempotencyKey: 'retry-key-8',
        requestHash: 'hash-8',
        subjectType: 'MeterBoundary',
        subjectId: ids.station,
        expectedVersion: 0,
        ports: ports(calls),
        execute: async () => ({ result: 'captured' as const }),
      }),
    ).rejects.toThrow(/responsible attendant/);
  });
});
