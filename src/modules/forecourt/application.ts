import { AppError } from '../../platform/errors';
import { withTenantTransaction } from '../../platform/db/transaction';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import type { Database } from '../../platform/db';
import {
  authorize,
  type AccessScope,
  type PermissionCode,
} from '../../platform/security/permissions';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { createTrustedActor, type TrustedActor } from './trusted-actor';
import type { ForecourtEvent } from './contracts';

/** A station context is created only from A1 authority and a server-loaded station. */
export type ForecourtCommandContext = Readonly<{
  authority: TenantExecutionContext;
  actor: TrustedActor;
  scope: AccessScope;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  requestId: string;
}>;

const trustedForecourtContexts = new WeakSet<object>();

export function createForecourtCommandContext(input: {
  authority: TenantExecutionContext;
  station: Readonly<{ id: string; tenantId: string; legalEntityId: string }>;
}): ForecourtCommandContext {
  const { authority, station } = input;
  if (
    authority.membership.tenantId !== station.tenantId ||
    authority.transaction.tenantId !== station.tenantId ||
    authority.transaction.actorId !== authority.actor.identityId ||
    authority.transaction.membershipId !== authority.membership.membershipId
  ) {
    throw new AppError('FORBIDDEN', 'The station does not belong to the trusted tenant context');
  }
  const context = Object.freeze({
    authority,
    actor: createTrustedActor({
      transaction: authority.transaction,
      actorId: authority.actor.identityId,
      membershipId: authority.membership.membershipId,
      tenantId: station.tenantId,
      stationId: station.id,
      legalEntityId: station.legalEntityId,
    }),
    scope: {
      tenantId: station.tenantId,
      scopeType: 'STATION' as const,
      legalEntityId: station.legalEntityId,
      stationId: station.id,
    },
    tenantId: station.tenantId,
    legalEntityId: station.legalEntityId,
    stationId: station.id,
    requestId: authority.transaction.requestId ?? '',
  });
  trustedForecourtContexts.add(context);
  return context;
}

/** Better Auth -> A1 authority -> server-loaded station -> A3 context. */
export async function resolveForecourtCommandContext(input: {
  request: Request;
  requestedTenantId: string;
  stationId: string;
  loadStation: (
    authority: TenantExecutionContext,
    stationId: string,
  ) => Promise<Readonly<{ id: string; tenantId: string; legalEntityId: string }> | null>;
}): Promise<ForecourtCommandContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.requestedTenantId,
  });
  const station = await input.loadStation(authority, input.stationId);
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');
  const stationAuthority: TenantExecutionContext = {
    ...authority,
    transaction: createTrustedTenantTransactionContext({
      ...authority.transaction,
      legalEntityId: station.legalEntityId,
      stationId: station.id,
    }),
  };
  return createForecourtCommandContext({ authority: stationAuthority, station });
}

export type IdempotencyRequest = Readonly<{
  tenantId: string;
  commandType: string;
  idempotencyKey: string;
  requestHash: string;
}>;

export const FORECOURT_COMMAND_POLICY = {
  OpenBusinessDay: {
    permissionCode: 'business_day.open',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  CloseBusinessDay: {
    permissionCode: 'business_day.close',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  StartShift: {
    permissionCode: 'shift.start',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  CloseMeters: {
    permissionCode: 'shift.close',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  CompleteShift: {
    permissionCode: 'shift.close',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  MarkNotOperated: {
    permissionCode: 'shift.mark_not_operated',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  ConfirmBoundary: {
    permissionCode: 'meter.boundary.capture',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
    requiresAttendantEligibility: true,
  },
  ConfirmPriceChangeBoundary: {
    permissionCode: 'price.change.boundary',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
    requiresAttendantEligibility: true,
  },
  ResetMeter: {
    permissionCode: 'meter.reset',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
    requiresAttendantEligibility: true,
  },
  CorrectMeterSegment: {
    permissionCode: 'meter.correction.execute',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
    requiresAttendantEligibility: true,
  },
  ReportMeterUnavailable: {
    permissionCode: 'exception.manage',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
    requiresAttendantEligibility: true,
  },
  ResolveMeterException: {
    permissionCode: 'exception.manage',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
    requiresAttendantEligibility: true,
  },
  HandoverAttendant: {
    permissionCode: 'meter.boundary.capture',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
    requiresAttendantEligibility: true,
  },
  SealSegment: {
    permissionCode: 'meter.boundary.capture',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
    requiresAttendantEligibility: true,
  },
  ReplaceMeter: {
    permissionCode: 'meter.replace',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
    requiresAttendantEligibility: true,
  },
  RequestPriceChange: {
    permissionCode: 'price.change.request',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  ApprovePriceChange: {
    permissionCode: 'price.change.approve',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
  },
  ActivatePriceChange: {
    permissionCode: 'price.change.activate',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
  },
  SubmitReconciliation: {
    permissionCode: 'reconciliation.submit',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  CreateCorrectedReconciliationRevision: {
    permissionCode: 'reconciliation.submit',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  ReturnReconciliation: {
    permissionCode: 'reconciliation.return',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STANDARD',
    requiresExpectedVersion: true,
  },
  ApproveReconciliation: {
    permissionCode: 'reconciliation.approve',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
  },
  PostReconciliation: {
    permissionCode: 'reconciliation.post',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
  },
  LockReconciliation: {
    permissionCode: 'approval.act',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
  },
  LockBusinessDay: {
    permissionCode: 'business_day.lock',
    requiredScopeType: 'STATION',
    assuranceRequirement: 'STEP_UP',
    requiresExpectedVersion: true,
  },
} as const satisfies Record<
  string,
  {
    permissionCode: PermissionCode;
    requiredScopeType: 'STATION';
    assuranceRequirement: 'STANDARD' | 'STEP_UP';
    requiresExpectedVersion: boolean;
    requiresAttendantEligibility?: boolean;
  }
>;

export type ForecourtCommandType = keyof typeof FORECOURT_COMMAND_POLICY;

export type ForecourtTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type ForecourtTransactionPort = {
  run<T>(
    context: ForecourtCommandContext,
    work: (transaction: ForecourtTransaction) => Promise<T>,
  ): Promise<T>;
};

/** Production transaction adapter: A1's trusted context sets fail-closed DB GUCs. */
export const databaseForecourtTransactionPort: ForecourtTransactionPort = {
  run<T>(
    context: ForecourtCommandContext,
    work: (transaction: ForecourtTransaction) => Promise<T>,
  ) {
    return withTenantTransaction(context.authority.transaction, work);
  },
};

export type IdempotencyPort = {
  run<T>(
    transaction: ForecourtTransaction,
    request: IdempotencyRequest,
    effect: () => Promise<T>,
  ): Promise<T>;
};

export type ForecourtAuditPort = {
  append(input: {
    transaction: ForecourtTransaction;
    context: ForecourtCommandContext;
    commandType: string;
    subjectType: string;
    subjectId: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    auditMetadata?: Readonly<Record<string, string | null>>;
    provenance: {
      actorId: string;
      membershipId: string;
      tenantId: string;
      stationId: string;
      requestId: string;
      responsibleAttendantId?: string;
    };
  }): Promise<void>;
};

export type ForecourtOutboxPort = {
  publish(input: {
    transaction: ForecourtTransaction;
    event: ForecourtEvent;
    context: ForecourtCommandContext;
  }): Promise<void>;
};

export type ForecourtCommandPorts = {
  transaction: ForecourtTransactionPort;
  idempotency: IdempotencyPort;
  attendantEligibility: (
    transaction: ForecourtTransaction,
    attendantId: string,
    stationId: string,
    tenantId: string,
  ) => Promise<void>;
  expectedVersion: (
    transaction: ForecourtTransaction,
    subjectType: ForecourtVersionSubject,
    subjectId: string,
    expectedVersion: number,
    stationId: string,
    tenantId: string,
  ) => Promise<void>;
  audit: ForecourtAuditPort;
  outbox: ForecourtOutboxPort;
};

export type ForecourtVersionSubject =
  | 'StationBusinessDay'
  | 'Shift'
  | 'MeterBoundary'
  | 'MeterSegment'
  | 'MeterInstallation'
  | 'SellingPrice'
  | 'Reconciliation'
  | 'ReconciliationRevision';

export const FORECOURT_VERSION_SUBJECT: Record<ForecourtCommandType, ForecourtVersionSubject> = {
  OpenBusinessDay: 'StationBusinessDay',
  CloseBusinessDay: 'StationBusinessDay',
  StartShift: 'Shift',
  CloseMeters: 'Shift',
  CompleteShift: 'Shift',
  MarkNotOperated: 'Shift',
  ConfirmBoundary: 'Shift',
  ConfirmPriceChangeBoundary: 'SellingPrice',
  ResetMeter: 'MeterInstallation',
  CorrectMeterSegment: 'MeterSegment',
  ReportMeterUnavailable: 'Shift',
  ResolveMeterException: 'Shift',
  HandoverAttendant: 'Shift',
  SealSegment: 'MeterSegment',
  ReplaceMeter: 'MeterInstallation',
  RequestPriceChange: 'SellingPrice',
  ApprovePriceChange: 'SellingPrice',
  ActivatePriceChange: 'SellingPrice',
  SubmitReconciliation: 'ReconciliationRevision',
  CreateCorrectedReconciliationRevision: 'ReconciliationRevision',
  ReturnReconciliation: 'ReconciliationRevision',
  ApproveReconciliation: 'ReconciliationRevision',
  PostReconciliation: 'ReconciliationRevision',
  LockReconciliation: 'ReconciliationRevision',
  LockBusinessDay: 'StationBusinessDay',
};

export type ForecourtCommandInput<T> = Readonly<{
  context: ForecourtCommandContext;
  commandType: ForecourtCommandType;
  idempotencyKey: string;
  requestHash: string;
  subjectType: string;
  subjectId: string;
  ports: ForecourtCommandPorts;
  before?: unknown;
  reason?: string;
  auditMetadata?: Readonly<Record<string, string | null>>;
  responsibleAttendantId?: string;
  expectedVersion?: number;
  /** The workflow lock subject may differ from the newly-created audit subject. */
  expectedVersionSubjectId?: string;
  execute: (
    transaction: ForecourtTransaction,
  ) => Promise<{ result: T; event?: ForecourtEvent; after?: unknown }>;
}>;

/** The complete authoritative command unit. */
export async function executeForecourtCommand<T>(input: ForecourtCommandInput<T>): Promise<T> {
  assertTrustedContext(input.context);
  const policy = FORECOURT_COMMAND_POLICY[input.commandType];
  if (!input.idempotencyKey.trim() || !input.requestHash.trim()) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Authoritative forecourt commands require idempotency and request hashes',
    );
  }

  return input.ports.transaction.run(input.context, async (transaction) => {
    authorize({
      actor: input.context.authority.authorization,
      permissionCode: policy.permissionCode,
      requestedScope: input.context.scope,
    });
    if (input.context.scope.scopeType !== policy.requiredScopeType) {
      throw new AppError('FORBIDDEN', 'The command policy requires station scope');
    }
    if (
      policy.assuranceRequirement === 'STEP_UP' &&
      input.context.authority.authorization.strongAuthenticationVerified !== true
    ) {
      throw new AppError('FORBIDDEN', 'The command requires step-up assurance');
    }
    if (
      'requiresAttendantEligibility' in policy &&
      policy.requiresAttendantEligibility === true &&
      input.responsibleAttendantId === undefined
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${input.commandType} requires a responsible attendant subject`,
      );
    }
    if (policy.requiresExpectedVersion && input.expectedVersion === undefined) {
      throw new AppError('VALIDATION_FAILED', `${input.commandType} requires an expected version`);
    }
    return input.ports.idempotency.run(
      transaction,
      {
        tenantId: input.context.tenantId,
        commandType: input.commandType,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
      async () => {
        if (input.responsibleAttendantId !== undefined) {
          await input.ports.attendantEligibility(
            transaction,
            input.responsibleAttendantId,
            input.context.stationId,
            input.context.tenantId,
          );
        }
        if (input.expectedVersion !== undefined) {
          await input.ports.expectedVersion(
            transaction,
            FORECOURT_VERSION_SUBJECT[input.commandType],
            input.expectedVersionSubjectId ?? input.subjectId,
            input.expectedVersion,
            input.context.stationId,
            input.context.tenantId,
          );
        }
        const outcome = await input.execute(transaction);
        await input.ports.audit.append({
          transaction,
          context: input.context,
          commandType: input.commandType,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          before: input.before,
          after: outcome.after,
          reason: input.reason,
          auditMetadata: input.auditMetadata,
          provenance: {
            actorId: input.context.actor.actorId,
            membershipId: input.context.actor.membershipId,
            tenantId: input.context.tenantId,
            stationId: input.context.stationId,
            requestId: input.context.requestId,
            ...(input.responsibleAttendantId &&
            input.responsibleAttendantId !== input.context.actor.membershipId
              ? { responsibleAttendantId: input.responsibleAttendantId }
              : {}),
          },
        });
        if (outcome.event) {
          await input.ports.outbox.publish({
            transaction,
            event: outcome.event,
            context: input.context,
          });
        }
        return outcome.result;
      },
    );
  });
}

function assertTrustedContext(context: ForecourtCommandContext): void {
  if (!context || typeof context !== 'object' || !trustedForecourtContexts.has(context)) {
    throw new AppError('FORBIDDEN', 'A server-resolved A1 station context is required');
  }
}
