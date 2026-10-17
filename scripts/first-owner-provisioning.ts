import { randomUUID } from 'node:crypto';

import postgres, { type Sql, type TransactionSql } from 'postgres';

import {
  ACCEPTED_PROVISIONING_DB_ROLE,
  assertPrivilegedDirectConnection,
  formatSafeError,
  validateClerkUserId,
  verifyExistingClerkUser,
  ProvisioningError,
} from './first-user-provisioning';
import { signSecurityEvent } from '../src/platform/security/audit-signing';

export const OWNER_BOOTSTRAP_EMAIL = 'hrshanda56@gmail.com';
export const OWNER_BOOTSTRAP_DISPLAY_NAME = 'Shanda Admin';
export const OWNER_BOOTSTRAP_TENANT_ID = 'a8852b9f-c490-4a72-a3f3-8662aeb14a8a';
export const OWNER_BOOTSTRAP_LEGAL_ENTITY_ID = 'cb5789ea-0979-450e-83d1-9834135cbedf';
export const OWNER_BOOTSTRAP_STATION_IDS = [
  'd8913b4d-7bb8-48cb-bb46-a741cea1f6c5',
  'c4954604-2bcb-4e59-96e9-12e35449545c',
  'ae3bf2a5-7ff0-42a3-832c-ae8f49a14b9f',
  '68ef219f-6baa-442a-8465-6d52e505d1f3',
] as const;

export const TOOL_NAME = 'first-production-owner-provisioning';

export const OWNER_BOOTSTRAP_SCOPE = {
  tenantId: OWNER_BOOTSTRAP_TENANT_ID,
  legalEntityId: OWNER_BOOTSTRAP_LEGAL_ENTITY_ID,
  stationIds: OWNER_BOOTSTRAP_STATION_IDS,
} as const;

type OwnerProvisionResult = {
  operationId: string;
  userId: string;
  membershipId: string;
  roleCode: 'OWNER';
  scopeType: 'TENANT';
  stationCount: number;
};

type CliMode = 'dry-run' | 'provision';

export type OwnerCliOptions = {
  mode: CliMode;
  environment: 'production';
  confirmed: true;
};

export function parseCli(args: readonly string[]): OwnerCliOptions {
  let mode: CliMode | undefined;
  let environment: string | undefined;
  let confirmed = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run' || arg === '--provision') {
      const nextMode = arg.slice(2) as CliMode;
      if (mode && mode !== nextMode) {
        throw new ProvisioningError('Select exactly one of --dry-run or --provision');
      }
      mode = nextMode;
    } else if (arg === '--environment') {
      environment = args[index + 1];
      if (!environment || environment.startsWith('--')) {
        throw new ProvisioningError('--environment requires a value');
      }
      index += 1;
    } else if (arg === '--confirm-production-provisioning') {
      confirmed = true;
    } else {
      throw new ProvisioningError(`Unknown OWNER bootstrap option: ${arg}`);
    }
  }

  if (!mode) throw new ProvisioningError('--dry-run or --provision is required');
  if (environment !== 'production') {
    throw new ProvisioningError('--environment production is required');
  }
  if (!confirmed) {
    throw new ProvisioningError('--confirm-production-provisioning is required');
  }

  return { mode, environment: 'production', confirmed: true };
}

function databaseUrlFromProductionEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (environment.APP_ENV !== 'production') {
    throw new ProvisioningError('This production OWNER bootstrap requires APP_ENV=production');
  }
  const url = environment.DATABASE_DIRECT_URL;
  if (!url) throw new ProvisioningError('DATABASE_DIRECT_URL is required');
  return url;
}

function one<T>(rows: readonly T[], message: string): T {
  const row = rows[0];
  if (!row) throw new ProvisioningError(message);
  return row;
}

function auditEvent(input: {
  eventCode: 'ACCESS.PROVISIONING_INITIATED' | 'ACCESS.PROVISIONING_COMPLETED';
  userId: string;
  membershipId: string;
  operationId: string;
  auditKey: { keyId: string; secret: string };
}): ReturnType<typeof signSecurityEvent> {
  return signSecurityEvent(
    {
      eventId: randomUUID(),
      tenantId: OWNER_BOOTSTRAP_TENANT_ID,
      membershipId: input.membershipId,
      eventCode: input.eventCode,
      requestId: randomUUID(),
      occurredAt: new Date().toISOString(),
      details: {
        actorType: 'SUPPORT',
        initiatedBy: TOOL_NAME,
        subjectType: 'app.users',
        subjectId: input.userId,
        metadata: {
          operationId: input.operationId,
          legalEntityId: OWNER_BOOTSTRAP_LEGAL_ENTITY_ID,
          stationIds: [...OWNER_BOOTSTRAP_STATION_IDS],
          roleCode: 'OWNER',
          scopeType: 'TENANT',
          outcome: 'success',
        },
      },
    },
    input.auditKey,
  );
}

function failureEvent(auditKey: { keyId: string; secret: string }) {
  return signSecurityEvent(
    {
      eventId: randomUUID(),
      tenantId: OWNER_BOOTSTRAP_TENANT_ID,
      eventCode: 'ACCESS.PROVISIONING_FAILED',
      requestId: randomUUID(),
      occurredAt: new Date().toISOString(),
      details: {
        actorType: 'SUPPORT',
        initiatedBy: TOOL_NAME,
        subjectType: 'access.first_owner_provisioning.request',
        subjectId: 'provision',
        metadata: {
          legalEntityId: OWNER_BOOTSTRAP_LEGAL_ENTITY_ID,
          stationIds: [...OWNER_BOOTSTRAP_STATION_IDS],
          roleCode: 'OWNER',
          scopeType: 'TENANT',
          outcome: 'failure',
        },
      },
    },
    auditKey,
  );
}

async function readOnly<T>(
  client: Sql,
  callback: (transaction: TransactionSql) => Promise<T>,
): Promise<T> {
  return (await client.begin(async (transaction) => {
    await transaction.unsafe('set transaction read only');
    return callback(transaction);
  })) as T;
}

async function main(): Promise<void> {
  let client: Sql | undefined;
  let auditKey: { keyId: string; secret: string } | undefined;

  try {
    const options = parseCli(process.argv.slice(2));
    if (options.environment !== 'production')
      throw new ProvisioningError('Environment is not production');
    const url = databaseUrlFromProductionEnvironment();
    client = postgres(url, { max: 1, prepare: false });
    await assertPrivilegedDirectConnection(client);

    const plan = await readOnly(client, async (transaction) => {
      const rows = await transaction<{ value: Record<string, unknown> }[]>`
        select platform.first_owner_provisioning_plan(
          ${OWNER_BOOTSTRAP_TENANT_ID}::uuid,
          ${OWNER_BOOTSTRAP_LEGAL_ENTITY_ID}::uuid,
          ${client!.array([...OWNER_BOOTSTRAP_STATION_IDS])}::uuid[],
          ${OWNER_BOOTSTRAP_EMAIL},
          ${OWNER_BOOTSTRAP_DISPLAY_NAME}
        ) as value
      `;
      return one(rows, 'Database returned no first-owner plan').value;
    });

    if (options.mode === 'dry-run') {
      console.log(
        JSON.stringify({
          mode: 'dry-run',
          email: OWNER_BOOTSTRAP_EMAIL,
          roleCode: 'OWNER',
          scopeType: 'TENANT',
          stationCount: OWNER_BOOTSTRAP_STATION_IDS.length,
          writes: plan.writes,
          authProvider: 'CLERK',
        }),
      );
      return;
    }

    auditKey = {
      keyId: process.env.AUDIT_SIGNING_KEY_ID ?? '',
      secret: process.env.AUDIT_SIGNING_KEY ?? '',
    };
    if (!auditKey.keyId || !auditKey.secret) {
      throw new ProvisioningError('AUDIT_SIGNING_KEY_ID and AUDIT_SIGNING_KEY are required');
    }

    const clerkUserId = validateClerkUserId(process.env.CLERK_USER_ID ?? '');
    await verifyExistingClerkUser(clerkUserId, OWNER_BOOTSTRAP_EMAIL);
    {
      const userId = randomUUID();
      const membershipId = randomUUID();
      const operationId = randomUUID();
      const initiated = auditEvent({
        eventCode: 'ACCESS.PROVISIONING_INITIATED',
        userId,
        membershipId,
        operationId,
        auditKey,
      });
      const completed = auditEvent({
        eventCode: 'ACCESS.PROVISIONING_COMPLETED',
        userId,
        membershipId,
        operationId,
        auditKey,
      });
      const rows = await client.begin(
        async (transaction) =>
          transaction<{ value: OwnerProvisionResult }[]>`
          select platform.first_owner_provisioning_provision(
            ${userId}::uuid,
            ${membershipId}::uuid,
            ${operationId}::uuid,
            ${OWNER_BOOTSTRAP_TENANT_ID}::uuid,
            ${OWNER_BOOTSTRAP_LEGAL_ENTITY_ID}::uuid,
            ${client!.array([...OWNER_BOOTSTRAP_STATION_IDS])}::uuid[],
            ${OWNER_BOOTSTRAP_EMAIL},
            ${OWNER_BOOTSTRAP_DISPLAY_NAME},
            ${clerkUserId},
            ${transaction.json(JSON.parse(JSON.stringify(initiated)))}::jsonb,
            ${transaction.json(JSON.parse(JSON.stringify(completed)))}::jsonb
          ) as value
        `,
      );
      const result = one(rows, 'Database returned no first-owner result').value;
      if (
        result.roleCode !== 'OWNER' ||
        result.scopeType !== 'TENANT' ||
        result.stationCount !== 4
      ) {
        throw new ProvisioningError('Database returned an unexpected OWNER scope');
      }
      console.log(
        JSON.stringify({
          status: 'provisioned',
          email: OWNER_BOOTSTRAP_EMAIL,
          roleCode: 'OWNER',
          scopeType: 'TENANT',
          stationCount: 4,
          operationId: result.operationId,
          userId: result.userId,
          membershipId: result.membershipId,
          authProvider: 'CLERK',
        }),
      );
    }
  } catch (error) {
    if (client && auditKey) {
      try {
        const event = failureEvent(auditKey);
        await client.begin(async (transaction) => {
          await transaction`
            select platform.first_owner_provisioning_append_failure(
              ${OWNER_BOOTSTRAP_TENANT_ID}::uuid,
              ${transaction.json(JSON.parse(JSON.stringify(event)))}::jsonb
            )
          `;
        });
      } catch {
        // Preserve the original safe error; failure-audit persistence is
        // fail-closed and must never expose connection or credential details.
      }
    }
    console.error(formatSafeError(error));
    process.exitCode = 1;
  } finally {
    await client?.end({ timeout: 1 });
  }
}

if (process.argv[1]?.endsWith('first-owner-provisioning.ts')) {
  void main();
}

export { ACCEPTED_PROVISIONING_DB_ROLE };
