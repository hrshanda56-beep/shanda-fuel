import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const PRODUCTION_MARKER_PATTERN = /(^|[./_-])(prod|production|live)([./_-]|$)/i;
const STAGING_TARGET_LABEL = 'isolated-staging';
const RPO_TARGET_SECONDS = 15 * 60;
const RTO_TARGET_SECONDS = 4 * 60 * 60;

export type RecoveryTimestamp = string;

export type RecoveryTenantTarget = {
  tenantId: string;
  stationId: string;
};

export type RecoveryTargetInput = {
  appEnvironment: string | undefined;
  targetEnvironment: string | undefined;
  targetLabel: string | undefined;
  appUrl: string;
  databaseUrl: string;
  sessionCookie?: string;
  tenantA: RecoveryTenantTarget;
  tenantB: RecoveryTenantTarget;
};

export type ValidatedRecoveryTarget = {
  appEnvironment: 'staging';
  targetEnvironment: 'staging';
  targetLabel: typeof STAGING_TARGET_LABEL;
  appOrigin: string;
  databaseUrl: string;
  sessionCookie?: string;
  tenantA: RecoveryTenantTarget;
  tenantB: RecoveryTenantTarget;
};

export type ValidatedRecoveryAppTarget = Pick<
  ValidatedRecoveryTarget,
  'appEnvironment' | 'targetEnvironment' | 'targetLabel' | 'appOrigin'
>;

export type DatabaseRecoveryCheck = {
  status: 'passed' | 'failed';
  readOnlyTransaction: boolean;
  expectedTables: number;
  availableTables: number;
  tenantRows?: number;
  stationRows?: number;
  code?: string;
};

export type ObjectRecoveryCheck = {
  status: 'passed' | 'failed';
  backupId?: string;
  sha256?: string;
  byteLength?: number;
  code?: string;
};

export type RecoveryRpo = {
  measurement: 'bounded';
  lastKnownGoodAt: RecoveryTimestamp;
  recoveredThroughAt: RecoveryTimestamp;
  upperBoundSeconds: number;
  targetSeconds: number;
  withinTarget: boolean;
};

export type RecoveryRto = {
  measuredSeconds: number;
  targetSeconds: number;
  withinTarget: boolean;
};

export type RecoveryRehearsalEvidence = {
  schemaVersion: 'shanda-fuel.recovery-rehearsal.v1';
  runId: string;
  environment: 'staging';
  targetLabel: typeof STAGING_TARGET_LABEL;
  targetAppOrigin: string;
  startedAt: RecoveryTimestamp;
  endedAt: RecoveryTimestamp;
  rtoSeconds: number;
  rto: RecoveryRto;
  rpo: RecoveryRpo;
  database: DatabaseRecoveryCheck;
  application: {
    status: 'passed' | 'failed';
    checks: Array<Record<string, unknown>>;
  };
  objectStorage: ObjectRecoveryCheck;
  pass: boolean;
  failureCode?: string;
};

export type RecoveryStartState = {
  schemaVersion: 'shanda-fuel.recovery-rehearsal-start.v1';
  runId: string;
  environment: 'staging';
  targetLabel: typeof STAGING_TARGET_LABEL;
  targetAppOrigin: string;
  startedAt: RecoveryTimestamp;
  lastKnownGoodAt: RecoveryTimestamp;
};

export class RecoveryRehearsalError extends Error {
  constructor(
    readonly code:
      | 'ambiguous_target'
      | 'invalid_configuration'
      | 'invalid_timestamp'
      | 'production_target'
      | 'unsafe_evidence_path',
    message: string,
  ) {
    super(message);
    this.name = 'RecoveryRehearsalError';
  }
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function safeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER_PATTERN.test(value) && !CONTROL_CHARACTER_PATTERN.test(value);
}

function parseTimestamp(name: string, value: string): Date {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new RecoveryRehearsalError(
      'invalid_timestamp',
      `${name} must be an ISO-8601 timestamp with a UTC Z suffix.`,
    );
  }
  return parsed;
}

function parseOrigin(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RecoveryRehearsalError('ambiguous_target', `${name} is not a valid URL.`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new RecoveryRehearsalError(
      'ambiguous_target',
      `${name} must be an HTTPS origin without credentials, path, query, or fragment.`,
    );
  }
  if (PRODUCTION_MARKER_PATTERN.test(url.hostname)) {
    throw new RecoveryRehearsalError('production_target', `${name} resembles a production target.`);
  }
  return url.origin;
}

function validateDatabaseTarget(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RecoveryRehearsalError(
      'ambiguous_target',
      'The recovery database target is invalid.',
    );
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new RecoveryRehearsalError(
      'ambiguous_target',
      'The recovery database target must use PostgreSQL.',
    );
  }
  if (
    PRODUCTION_MARKER_PATTERN.test(url.hostname) ||
    PRODUCTION_MARKER_PATTERN.test(url.pathname)
  ) {
    throw new RecoveryRehearsalError(
      'production_target',
      'The recovery database resembles production.',
    );
  }
  return value;
}

function validateTenant(name: string, value: RecoveryTenantTarget): void {
  if (!isUuid(value.tenantId) || !isUuid(value.stationId)) {
    throw new RecoveryRehearsalError('invalid_configuration', `${name} IDs must be UUIDs.`);
  }
}

export function validateRecoveryTarget(input: RecoveryTargetInput): ValidatedRecoveryTarget {
  const appTarget = validateRecoveryAppTarget(input);
  if (!input.databaseUrl) {
    throw new RecoveryRehearsalError(
      'invalid_configuration',
      'RECOVERY_DATABASE_URL is required for restored-database validation.',
    );
  }

  const databaseUrl = validateDatabaseTarget(input.databaseUrl);
  validateTenant('Tenant A', input.tenantA);
  validateTenant('Tenant B', input.tenantB);
  if (input.tenantA.tenantId.toLowerCase() === input.tenantB.tenantId.toLowerCase()) {
    throw new RecoveryRehearsalError('invalid_configuration', 'Tenant A and Tenant B must differ.');
  }
  if (input.sessionCookie !== undefined && CONTROL_CHARACTER_PATTERN.test(input.sessionCookie)) {
    throw new RecoveryRehearsalError(
      'invalid_configuration',
      'RECOVERY_SESSION_COOKIE contains control characters.',
    );
  }

  return {
    ...appTarget,
    databaseUrl,
    sessionCookie: input.sessionCookie,
    tenantA: input.tenantA,
    tenantB: input.tenantB,
  };
}

export function validateRecoveryAppTarget(input: {
  appEnvironment: string | undefined;
  targetEnvironment: string | undefined;
  targetLabel: string | undefined;
  appUrl: string;
}): ValidatedRecoveryAppTarget {
  if (input.appEnvironment !== 'staging' || input.targetEnvironment !== 'staging') {
    throw new RecoveryRehearsalError(
      'production_target',
      'The recovery rehearsal requires APP_ENV=staging and an explicit staging target.',
    );
  }
  if (input.targetLabel !== STAGING_TARGET_LABEL) {
    throw new RecoveryRehearsalError(
      'ambiguous_target',
      `The recovery target label must be ${STAGING_TARGET_LABEL}.`,
    );
  }
  return {
    appEnvironment: 'staging',
    targetEnvironment: 'staging',
    targetLabel: STAGING_TARGET_LABEL,
    appOrigin: parseOrigin('The recovery application target', input.appUrl),
  };
}

export function createRecoveryStartState(input: {
  target: ValidatedRecoveryAppTarget;
  lastKnownGoodAt: RecoveryTimestamp;
  startedAt?: RecoveryTimestamp;
  runId?: string;
}): RecoveryStartState {
  const lastKnownGood = parseTimestamp('lastKnownGoodAt', input.lastKnownGoodAt);
  const startedAt = input.startedAt ?? new Date().toISOString();
  const started = parseTimestamp('startedAt', startedAt);
  if (lastKnownGood.getTime() > started.getTime()) {
    throw new RecoveryRehearsalError(
      'invalid_timestamp',
      'lastKnownGoodAt cannot be after the recovery start time.',
    );
  }
  const runId = input.runId ?? randomUUID();
  if (!safeIdentifier(runId)) {
    throw new RecoveryRehearsalError('invalid_configuration', 'The rehearsal run ID is invalid.');
  }
  return {
    schemaVersion: 'shanda-fuel.recovery-rehearsal-start.v1',
    runId,
    environment: 'staging',
    targetLabel: input.target.targetLabel,
    targetAppOrigin: input.target.appOrigin,
    startedAt: started.toISOString(),
    lastKnownGoodAt: lastKnownGood.toISOString(),
  };
}

export function calculateRpo(input: {
  lastKnownGoodAt: RecoveryTimestamp;
  recoveredThroughAt: RecoveryTimestamp;
}): RecoveryRpo {
  const lastKnownGood = parseTimestamp('lastKnownGoodAt', input.lastKnownGoodAt);
  const recoveredThrough = parseTimestamp('recoveredThroughAt', input.recoveredThroughAt);
  const upperBoundSeconds = Math.max(
    0,
    Math.ceil((lastKnownGood.getTime() - recoveredThrough.getTime()) / 1000),
  );
  return {
    measurement: 'bounded',
    lastKnownGoodAt: lastKnownGood.toISOString(),
    recoveredThroughAt: recoveredThrough.toISOString(),
    upperBoundSeconds,
    targetSeconds: RPO_TARGET_SECONDS,
    withinTarget: upperBoundSeconds <= RPO_TARGET_SECONDS,
  };
}

export function createRecoveryEvidence(input: {
  state: RecoveryStartState;
  endedAt: RecoveryTimestamp;
  recoveredThroughAt: RecoveryTimestamp;
  database: DatabaseRecoveryCheck;
  application: { status: 'passed' | 'failed'; checks: Array<Record<string, unknown>> };
  objectStorage: ObjectRecoveryCheck;
  failureCode?: string;
}): RecoveryRehearsalEvidence {
  const startedAt = parseTimestamp('startedAt', input.state.startedAt);
  const endedAt = parseTimestamp('endedAt', input.endedAt);
  if (endedAt.getTime() < startedAt.getTime()) {
    throw new RecoveryRehearsalError('invalid_timestamp', 'endedAt cannot be before startedAt.');
  }
  if (input.failureCode !== undefined && !safeIdentifier(input.failureCode)) {
    throw new RecoveryRehearsalError('invalid_configuration', 'The failure code is invalid.');
  }
  const recoveredThroughAt = parseTimestamp('recoveredThroughAt', input.recoveredThroughAt);
  if (recoveredThroughAt.getTime() > endedAt.getTime()) {
    throw new RecoveryRehearsalError(
      'invalid_timestamp',
      'recoveredThroughAt cannot be after the rehearsal end time.',
    );
  }
  const databasePassed = input.database.status === 'passed';
  const applicationPassed = input.application.status === 'passed';
  const objectStoragePassed = input.objectStorage.status === 'passed';
  const rtoSeconds = Math.ceil((endedAt.getTime() - startedAt.getTime()) / 1000);
  const rto = {
    measuredSeconds: rtoSeconds,
    targetSeconds: RTO_TARGET_SECONDS,
    withinTarget: rtoSeconds <= RTO_TARGET_SECONDS,
  } satisfies RecoveryRto;
  const rpo = calculateRpo({
    lastKnownGoodAt: input.state.lastKnownGoodAt,
    recoveredThroughAt: recoveredThroughAt.toISOString(),
  });
  const pass =
    databasePassed &&
    applicationPassed &&
    objectStoragePassed &&
    rpo.withinTarget &&
    rto.withinTarget &&
    !input.failureCode;
  return {
    schemaVersion: 'shanda-fuel.recovery-rehearsal.v1',
    runId: input.state.runId,
    environment: 'staging',
    targetLabel: input.state.targetLabel,
    targetAppOrigin: input.state.targetAppOrigin,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    rtoSeconds,
    rto,
    rpo,
    database: input.database,
    application: input.application,
    objectStorage: input.objectStorage,
    pass,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  };
}

export function assertSafeEvidencePath(path: string): void {
  if (!path || CONTROL_CHARACTER_PATTERN.test(path)) {
    throw new RecoveryRehearsalError('unsafe_evidence_path', 'The evidence path is invalid.');
  }
}

export const RECOVERY_TARGET_LABEL = STAGING_TARGET_LABEL;
