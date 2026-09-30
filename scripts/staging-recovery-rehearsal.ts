import 'dotenv/config';

import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getServerEnv } from '../src/platform/config/env';
import { runDatabaseReadOnlyValidation } from '../src/platform/recovery/database-validation';
import { runStagingR2RecoveryDrill } from '../src/platform/recovery/r2-drill';
import {
  assertSafeEvidencePath,
  createRecoveryEvidence,
  createRecoveryStartState,
  RECOVERY_TARGET_LABEL,
  RecoveryRehearsalError,
  type DatabaseRecoveryCheck,
  type ObjectRecoveryCheck,
  type RecoveryStartState,
  validateRecoveryAppTarget,
  validateRecoveryTarget,
} from '../src/platform/recovery/rehearsal';
import {
  runReadOnlyVerification,
  type ReadOnlySmokeEvidence,
} from '../src/platform/smoke/read-only';

const confirmationFlag = '--confirm-recovery-rehearsal';
const valueOptions = new Set([
  '--phase',
  '--environment',
  '--target-label',
  '--target-app-url',
  '--last-known-good-at',
  '--recovered-through-at',
  '--state-file',
  '--evidence-file',
  '--run-id',
]);
const usage =
  'Usage: --phase <start|complete> --environment staging --target-app-url <https-origin> ' +
  `--target-label ${RECOVERY_TARGET_LABEL} --state-file <path> --evidence-file <path> ${confirmationFlag}`;

type CliOptions = {
  phase: 'start' | 'complete';
  environment: 'staging';
  targetAppUrl: string;
  targetLabel: string;
  stateFile: string;
  evidenceFile: string;
  lastKnownGoodAt?: string;
  recoveredThroughAt?: string;
  runId?: string;
  confirmed: boolean;
};

export function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  let confirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === confirmationFlag) {
      confirmed = true;
      continue;
    }
    if (!argument?.startsWith('--') || !valueOptions.has(argument)) {
      throw new RecoveryRehearsalError('invalid_configuration', 'Unknown command-line option.');
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new RecoveryRehearsalError('invalid_configuration', usage);
    }
    values.set(argument, value);
    index += 1;
  }

  const phase = values.get('--phase');
  const environment = values.get('--environment');
  const targetAppUrl = values.get('--target-app-url');
  const targetLabel = values.get('--target-label');
  const stateFile = values.get('--state-file');
  const evidenceFile = values.get('--evidence-file');
  if (
    (phase !== 'start' && phase !== 'complete') ||
    environment !== 'staging' ||
    !targetAppUrl ||
    !targetLabel ||
    !stateFile ||
    !evidenceFile ||
    !confirmed
  ) {
    throw new RecoveryRehearsalError('invalid_configuration', usage);
  }
  if (phase === 'start' && !values.get('--last-known-good-at')) {
    throw new RecoveryRehearsalError(
      'invalid_configuration',
      '--last-known-good-at is required for the start phase.',
    );
  }
  if (phase === 'complete' && !values.get('--recovered-through-at')) {
    throw new RecoveryRehearsalError(
      'invalid_configuration',
      '--recovered-through-at is required for the complete phase.',
    );
  }
  return {
    phase,
    environment,
    targetAppUrl,
    targetLabel,
    stateFile,
    evidenceFile,
    lastKnownGoodAt: values.get('--last-known-good-at'),
    recoveredThroughAt: values.get('--recovered-through-at'),
    runId: values.get('--run-id'),
    confirmed,
  };
}

async function writeNewJson(path: string, value: unknown): Promise<void> {
  assertSafeEvidencePath(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

async function readStartState(path: string): Promise<RecoveryStartState> {
  assertSafeEvidencePath(path);
  try {
    const raw = await readFile(path, 'utf8');
    const state = JSON.parse(raw) as RecoveryStartState;
    if (
      state.schemaVersion !== 'shanda-fuel.recovery-rehearsal-start.v1' ||
      state.environment !== 'staging' ||
      state.targetLabel !== RECOVERY_TARGET_LABEL ||
      !state.runId ||
      !state.targetAppOrigin ||
      !state.startedAt ||
      !state.lastKnownGoodAt
    ) {
      throw new Error('invalid state');
    }
    return state;
  } catch {
    throw new RecoveryRehearsalError(
      'invalid_configuration',
      'The recovery start state could not be read or is invalid.',
    );
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new RecoveryRehearsalError('invalid_configuration', `${name} is required.`);
  return value;
}

function uuidEnvironment(name: string): string {
  const value = requiredEnvironment(name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new RecoveryRehearsalError('invalid_configuration', `${name} must be a UUID.`);
  }
  return value;
}

function safeFailureCode(error: unknown): string {
  if (error instanceof RecoveryRehearsalError) return error.code;
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return /^[a-z0-9_-]{1,80}$/.test(error.code) ? error.code : 'provider_failure';
  }
  return 'rehearsal_failed';
}

function safeApplicationChecks(evidence: ReadOnlySmokeEvidence): Array<Record<string, unknown>> {
  return evidence.checks.map((check) => ({
    name: check.name,
    status: check.status,
    required: check.required,
    ...(check.httpStatus === undefined ? {} : { httpStatus: check.httpStatus }),
    ...(check.requestId === undefined ? {} : { requestId: check.requestId }),
    elapsedMs: check.elapsedMs,
    ...(check.code === undefined ? {} : { code: check.code }),
  }));
}

async function start(options: CliOptions): Promise<void> {
  const target = validateRecoveryAppTarget({
    appEnvironment: process.env.APP_ENV,
    targetEnvironment: options.environment,
    targetLabel: options.targetLabel,
    appUrl: options.targetAppUrl,
  });
  const state = createRecoveryStartState({
    target,
    lastKnownGoodAt: options.lastKnownGoodAt!,
    runId: options.runId,
  });
  await writeNewJson(options.stateFile, state);
  process.stdout.write(
    `Recovery rehearsal started: run ${state.runId}; startedAt ${state.startedAt}; isolated staging target recorded.\n`,
  );
}

async function complete(options: CliOptions): Promise<void> {
  const state = await readStartState(options.stateFile);
  if (options.runId && options.runId !== state.runId) {
    throw new RecoveryRehearsalError(
      'invalid_configuration',
      'The run ID does not match the start state.',
    );
  }
  const target = validateRecoveryTarget({
    appEnvironment: process.env.APP_ENV,
    targetEnvironment: options.environment,
    targetLabel: options.targetLabel,
    appUrl: options.targetAppUrl,
    databaseUrl: requiredEnvironment('RECOVERY_DATABASE_URL'),
    sessionCookie: process.env.RECOVERY_SESSION_COOKIE,
    tenantA: {
      tenantId: uuidEnvironment('RECOVERY_TENANT_A_ID'),
      stationId: uuidEnvironment('RECOVERY_STATION_A_ID'),
    },
    tenantB: {
      tenantId: uuidEnvironment('RECOVERY_TENANT_B_ID'),
      stationId: uuidEnvironment('RECOVERY_STATION_B_ID'),
    },
  });
  if (target.appOrigin !== state.targetAppOrigin) {
    throw new RecoveryRehearsalError(
      'ambiguous_target',
      'The complete target does not match the start state.',
    );
  }

  let database: DatabaseRecoveryCheck = {
    status: 'failed',
    readOnlyTransaction: false,
    expectedTables: 0,
    availableTables: 0,
  };
  let application: { status: 'passed' | 'failed'; checks: Array<Record<string, unknown>> } = {
    status: 'failed',
    checks: [],
  };
  let objectStorage: ObjectRecoveryCheck = { status: 'failed' };
  let failureCode: string | undefined;

  try {
    database = await runDatabaseReadOnlyValidation(target.databaseUrl);
    if (database.status !== 'passed')
      throw new RecoveryRehearsalError(
        'invalid_configuration',
        database.code ?? 'database_validation_failed',
      );

    const appEvidence = await runReadOnlyVerification(
      {
        environment: 'staging',
        baseUrl: target.appOrigin,
        sessionCookie: target.sessionCookie,
        tenantA: target.tenantA,
        tenantB: target.tenantB,
      },
      {
        vercelAutomationBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      },
    );
    application = {
      status: appEvidence.pass ? 'passed' : 'failed',
      checks: safeApplicationChecks(appEvidence),
    };
    if (!appEvidence.pass) {
      throw new RecoveryRehearsalError(
        'invalid_configuration',
        'application_read_only_validation_failed',
      );
    }

    const r2Evidence = await runStagingR2RecoveryDrill({ env: getServerEnv() });
    objectStorage = r2Evidence;
  } catch (error) {
    failureCode = safeFailureCode(error);
  }

  const evidence = createRecoveryEvidence({
    state,
    endedAt: new Date().toISOString(),
    recoveredThroughAt: options.recoveredThroughAt!,
    database,
    application,
    objectStorage,
    failureCode,
  });
  await writeNewJson(options.evidenceFile, evidence);
  process.stdout.write(
    `Recovery rehearsal ${evidence.pass ? 'passed' : 'failed'}: run ${evidence.runId}; RTO ${evidence.rtoSeconds}s; RPO upper bound ${evidence.rpo.upperBoundSeconds}s.\n`,
  );
  if (!evidence.pass) process.exitCode = 1;
}

export async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.phase === 'start') await start(options);
    else await complete(options);
  } catch (error) {
    const message =
      error instanceof RecoveryRehearsalError ? error.message : 'Recovery rehearsal failed closed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
