import 'dotenv/config';

import { createInterface } from 'node:readline';
import postgres from 'postgres';
import { getServerEnv } from '../src/platform/config/env';
import { assertStagingSmokeAllowed } from '../src/platform/config/staging-smoke';
import {
  assertExactSyntheticIds,
  createSqlStagingAuthSmokeRepository,
  runStagingAuthSmokeBootstrap,
  STAGING_AUTH_SMOKE_IDS,
  type StagingAuthSmokeMode,
} from '../src/platform/staging/auth-smoke-bootstrap';

const PASSWORD_ENVIRONMENT_VARIABLE = 'STAGING_AUTH_SMOKE_PASSWORD';

type CliOptions = {
  mode: StagingAuthSmokeMode;
  confirmation: boolean;
  tenantId?: string;
  stationId?: string;
  legalEntityId?: string;
  membershipId?: string;
  actorId?: string;
  email?: string;
  passwordEnvironmentVariable: string;
};

function usage(): string {
  return [
    'Usage:',
    '  node --conditions=react-server --import tsx scripts/staging-auth-smoke-bootstrap.ts --check --tenant-id <Tenant A> --station-id <Station A>',
    '  node --conditions=react-server --import tsx scripts/staging-auth-smoke-bootstrap.ts --confirm-staging-auth-bootstrap --tenant-id <Tenant A> --station-id <Station A> --email <synthetic-email>',
    '',
    `Bootstrap reads the password from ${PASSWORD_ENVIRONMENT_VARIABLE} or a name supplied with --password-env.`,
  ].join('\n');
}

function takeValue(args: string[], index: number, flag: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'bootstrap',
    confirmation: false,
    passwordEnvironmentVariable: PASSWORD_ENVIRONMENT_VARIABLE,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--check') {
      options.mode = 'check';
    } else if (arg === '--confirm-staging-auth-bootstrap') {
      options.confirmation = true;
    } else if (arg === '--tenant-id') {
      [options.tenantId, index] = takeValue(args, index, arg);
    } else if (arg === '--station-id') {
      [options.stationId, index] = takeValue(args, index, arg);
    } else if (arg === '--legal-entity-id') {
      [options.legalEntityId, index] = takeValue(args, index, arg);
    } else if (arg === '--membership-id') {
      [options.membershipId, index] = takeValue(args, index, arg);
    } else if (arg === '--actor-id') {
      [options.actorId, index] = takeValue(args, index, arg);
    } else if (arg === '--email') {
      [options.email, index] = takeValue(args, index, arg);
    } else if (arg === '--password-env') {
      [options.passwordEnvironmentVariable, index] = takeValue(args, index, arg);
      if (!/^[A-Z_][A-Z0-9_]*$/.test(options.passwordEnvironmentVariable)) {
        throw new Error('--password-env must be an uppercase environment variable name');
      }
    } else if (arg === '--help') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.mode === 'bootstrap' && !options.confirmation) {
    throw new Error('Bootstrap requires --confirm-staging-auth-bootstrap');
  }
  if (!options.tenantId || !options.stationId) {
    throw new Error('Bootstrap and check require explicit --tenant-id and --station-id values');
  }
  if (options.mode === 'bootstrap' && !options.email) {
    throw new Error('Bootstrap requires an explicit --email value');
  }

  return options;
}

async function readHiddenPassword(environmentVariable: string): Promise<string> {
  const fromEnvironment = process.env[environmentVariable];
  if (fromEnvironment) return fromEnvironment;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Bootstrap requires ${environmentVariable} when stdin is not interactive`);
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolve, reject) => {
      process.stdout.write('Synthetic staging password: ');
      const stdin = process.stdin;
      stdin.setRawMode?.(true);
      stdin.resume();
      let password = '';
      const onData = (chunk: Buffer) => {
        const value = chunk.toString('utf8');
        if (value === '\u0003') {
          cleanup();
          reject(new Error('Password input cancelled'));
        } else if (value === '\r' || value === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(password);
        } else if (value === '\u007f') {
          password = password.slice(0, -1);
        } else {
          password += value;
        }
      };
      const cleanup = () => {
        stdin.off('data', onData);
        stdin.setRawMode?.(false);
        readline.close();
      };
      stdin.on('data', onData);
    });
  } finally {
    readline.close();
  }
}

function printResult(result: Awaited<ReturnType<typeof runStagingAuthSmokeBootstrap>>): void {
  const grantStatuses = Object.entries(result.permissionGrants)
    .map(([permission, status]) => `${permission}=${status}`)
    .join(', ');
  console.log(
    `Staging auth smoke ${result.mode}: hierarchy=${result.hierarchyValid ? 'valid' : 'invalid'}, membership=${result.membershipValid ? 'valid' : 'invalid'}, auth-user=${result.authUser}, credential-account=${result.credentialAccount}, grants=[${grantStatuses}]${result.expiresAt ? `, expires=${result.expiresAt.toISOString()}` : ''}.`,
  );
}

async function main(): Promise<void> {
  try {
    assertStagingSmokeAllowed(process.env.APP_ENV);
    const options = parseOptions(process.argv.slice(2));
    const ids = {
      tenantId: options.tenantId!,
      stationId: options.stationId!,
      legalEntityId: options.legalEntityId ?? STAGING_AUTH_SMOKE_IDS.legalEntityId,
      membershipId: options.membershipId ?? STAGING_AUTH_SMOKE_IDS.membershipId,
      actorId: options.actorId ?? STAGING_AUTH_SMOKE_IDS.actorId,
    };
    assertExactSyntheticIds(ids);
    const env = getServerEnv();
    const password =
      options.mode === 'bootstrap'
        ? await readHiddenPassword(options.passwordEnvironmentVariable)
        : undefined;
    const databaseUrl = env.DATABASE_DIRECT_URL ?? env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL is required');

    const client = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      const result = await client.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${ids.tenantId}, true)`;
        await transaction`select set_config('app.actor_id', ${ids.actorId}, true)`;
        await transaction`select set_config('app.membership_id', ${ids.membershipId}, true)`;
        const repository = createSqlStagingAuthSmokeRepository(transaction);
        return runStagingAuthSmokeBootstrap({
          repository,
          ids,
          mode: options.mode,
          email: options.email,
          password,
          auditKey:
            options.mode === 'bootstrap' && env.AUDIT_SIGNING_KEY_ID && env.AUDIT_SIGNING_KEY
              ? { keyId: env.AUDIT_SIGNING_KEY_ID, secret: env.AUDIT_SIGNING_KEY }
              : undefined,
        });
      });
      printResult(result);
    } finally {
      await client.end({ timeout: 1 });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Staging auth smoke failed.');
    process.exitCode = 1;
  }
}

void main();
