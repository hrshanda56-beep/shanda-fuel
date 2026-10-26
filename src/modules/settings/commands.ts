import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getAuditSigningKey } from '../../platform/config/env';
import { withTenantTransaction } from '../../platform/db/transaction';
import { forecourtIdempotencyRecords } from '../../platform/db/schema/a3';
import { AppError } from '../../platform/errors';
import { authorize, type PermissionCode } from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantExecutionContext } from '../tenancy/authority';

/**
 * Owner self-service for the business structure: companies (legal entities) and stations.
 * A station is created in ONBOARDING; the existing station activation flow makes it live, so
 * nothing here lets a half-set-up station trade. Station codes never change once made.
 * Runs through the same idempotency ledger and signed audit event as the other command modules.
 */

const uuid = z.string().uuid();

export const SETTINGS_COMMAND_TYPES = [
  'CreateLegalEntity',
  'UpdateLegalEntity',
  'CreateStation',
  'UpdateStation',
] as const;
export type SettingsCommandType = (typeof SETTINGS_COMMAND_TYPES)[number];

export function assertSettingsCommandType(value: unknown): SettingsCommandType {
  if (!SETTINGS_COMMAND_TYPES.includes(value as SettingsCommandType)) {
    throw new AppError('VALIDATION_FAILED', 'A supported settings commandType is required');
  }
  return value as SettingsCommandType;
}

const timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid time zone, for example Africa/Harare.');

const createLegalEntitySchema = z.object({
  commandType: z.literal('CreateLegalEntity'),
  tenantId: uuid,
  legalName: z.string().trim().min(1, 'Enter the company name.').max(240),
  registrationReference: z.string().trim().max(120).optional(),
});

const updateLegalEntitySchema = z.object({
  commandType: z.literal('UpdateLegalEntity'),
  tenantId: uuid,
  legalEntityId: uuid,
  legalName: z.string().trim().min(1, 'Enter the company name.').max(240),
  registrationReference: z.string().trim().max(120).nullable().optional(),
});

const createStationSchema = z.object({
  commandType: z.literal('CreateStation'),
  tenantId: uuid,
  legalEntityId: uuid,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Use 2 to 20 letters, numbers or dashes for the code.'),
  name: z.string().trim().min(1, 'Enter the station name.').max(160),
  timezone: timezone.default('Africa/Harare'),
});

const updateStationSchema = z.object({
  commandType: z.literal('UpdateStation'),
  tenantId: uuid,
  stationId: uuid,
  name: z.string().trim().min(1, 'Enter the station name.').max(160),
  timezone,
});

const SCHEMAS = {
  CreateLegalEntity: createLegalEntitySchema,
  UpdateLegalEntity: updateLegalEntitySchema,
  CreateStation: createStationSchema,
  UpdateStation: updateStationSchema,
} as const;

const POLICY: Record<SettingsCommandType, { permission: PermissionCode; actionCode: string }> = {
  CreateLegalEntity: { permission: 'legal_entity.manage', actionCode: 'LEGAL_ENTITY.CREATED' },
  UpdateLegalEntity: { permission: 'legal_entity.manage', actionCode: 'LEGAL_ENTITY.UPDATED' },
  CreateStation: { permission: 'station.manage', actionCode: 'STATION.CREATED' },
  UpdateStation: { permission: 'station.manage', actionCode: 'STATION.UPDATED' },
};

type Executor = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

async function assertLegalEntity(transaction: Executor, tenantId: string, legalEntityId: string) {
  const rows = await transaction.execute<{ id: string }>(sql`
    select id from app.legal_entities
    where tenant_id = ${tenantId} and id = ${legalEntityId} and status = 'ACTIVE'
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'That company was not found.');
}

async function run(
  transaction: Executor,
  tenantId: string,
  input: z.infer<(typeof SCHEMAS)[SettingsCommandType]>,
): Promise<{ subjectType: string; subjectId: string; result: Record<string, unknown> }> {
  switch (input.commandType) {
    case 'CreateLegalEntity': {
      const id = randomUUID();
      await transaction.execute(sql`
        insert into app.legal_entities (id, tenant_id, legal_name, registration_reference)
        values (${id}, ${tenantId}, ${input.legalName}, ${input.registrationReference || null})
      `);
      return { subjectType: 'LegalEntity', subjectId: id, result: { legalEntityId: id } };
    }
    case 'UpdateLegalEntity': {
      await assertLegalEntity(transaction, tenantId, input.legalEntityId);
      await transaction.execute(sql`
        update app.legal_entities
        set legal_name = ${input.legalName},
            registration_reference = ${
              input.registrationReference === undefined
                ? sql`registration_reference`
                : sql`${input.registrationReference || null}`
            },
            updated_at = now()
        where tenant_id = ${tenantId} and id = ${input.legalEntityId}
      `);
      return {
        subjectType: 'LegalEntity',
        subjectId: input.legalEntityId,
        result: { legalEntityId: input.legalEntityId },
      };
    }
    case 'CreateStation': {
      await assertLegalEntity(transaction, tenantId, input.legalEntityId);
      const taken = await transaction.execute<{ id: string }>(sql`
        select id from app.stations where tenant_id = ${tenantId} and code = ${input.code}
      `);
      if (taken[0]) {
        throw new AppError(
          'CONFLICT',
          `The code ${input.code} is already used by another station.`,
        );
      }
      const id = randomUUID();
      await transaction.execute(sql`
        insert into app.stations (id, tenant_id, legal_entity_id, code, name, timezone, status)
        values (${id}, ${tenantId}, ${input.legalEntityId}, ${input.code}, ${input.name},
                ${input.timezone}, 'ONBOARDING')
      `);
      return { subjectType: 'Station', subjectId: id, result: { stationId: id, code: input.code } };
    }
    case 'UpdateStation': {
      const updated = await transaction.execute<{ id: string }>(sql`
        update app.stations
        set name = ${input.name}, timezone = ${input.timezone}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${input.stationId}
        returning id
      `);
      if (!updated[0]) throw new AppError('NOT_FOUND', 'That station was not found.');
      return {
        subjectType: 'Station',
        subjectId: input.stationId,
        result: { stationId: input.stationId },
      };
    }
  }
}

export async function runSettingsCommandFromRequest(request: Request, body: unknown) {
  const commandType = assertSettingsCommandType(
    typeof body === 'object' && body !== null
      ? (body as { commandType?: unknown }).commandType
      : undefined,
  );
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) {
    throw new AppError(
      'VALIDATION_FAILED',
      'This request could not be sent safely. Reload the page and try again.',
    );
  }
  const parsed = SCHEMAS[commandType].safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsed.error.issues[0]?.message ?? 'The details could not be read.',
    );
  }
  const input = parsed.data;
  const authority = await resolveTenantExecutionContext({
    request,
    requestedTenantId: input.tenantId,
  });
  const policy = POLICY[commandType];
  authorize({
    actor: authority.authorization,
    permissionCode: policy.permission,
    requestedScope: { tenantId: input.tenantId, scopeType: 'TENANT' },
  });
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const ledgerType = `Settings.${commandType}`;

  return withTenantTransaction(authority.transaction, async (transaction) => {
    const inserted = await transaction
      .insert(forecourtIdempotencyRecords)
      .values({
        tenantId: input.tenantId,
        commandType: ledgerType,
        idempotencyKey: key,
        requestHash,
        status: 'IN_PROGRESS',
        resultPayload: {},
      })
      .onConflictDoNothing({
        target: [
          forecourtIdempotencyRecords.tenantId,
          forecourtIdempotencyRecords.commandType,
          forecourtIdempotencyRecords.idempotencyKey,
        ],
      })
      .returning({ id: forecourtIdempotencyRecords.id });
    if (inserted.length === 0) {
      const existing = await transaction
        .select({
          requestHash: forecourtIdempotencyRecords.requestHash,
          status: forecourtIdempotencyRecords.status,
          resultPayload: forecourtIdempotencyRecords.resultPayload,
        })
        .from(forecourtIdempotencyRecords)
        .where(
          and(
            eq(forecourtIdempotencyRecords.tenantId, input.tenantId),
            eq(forecourtIdempotencyRecords.commandType, ledgerType),
            eq(forecourtIdempotencyRecords.idempotencyKey, key),
          ),
        )
        .for('update');
      const row = existing[0];
      if (!row || row.status !== 'COMPLETED') {
        throw new AppError(
          'CONFLICT',
          'This request is already being processed. Reload and check.',
        );
      }
      if (row.requestHash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'This request was already sent with different details. Reload the page and try again.',
        );
      }
      return (row.resultPayload as { value: Record<string, unknown> }).value;
    }

    const outcome = await run(transaction, input.tenantId, input);
    await appendSecurityEvent(
      {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        membershipId: authority.membership.membershipId,
        actorId: authority.actor.identityId,
        actorType: 'HUMAN',
        actionCode: policy.actionCode,
        subjectType: outcome.subjectType,
        subjectId: outcome.subjectId,
        requestId: authority.transaction.requestId ?? randomUUID(),
        occurredAt: new Date().toISOString(),
        after: outcome.result,
      },
      getAuditSigningKey(),
      transaction,
    );
    await transaction
      .update(forecourtIdempotencyRecords)
      .set({
        status: 'COMPLETED',
        resultPayload: { value: outcome.result },
        completedAt: new Date(),
      })
      .where(eq(forecourtIdempotencyRecords.id, inserted[0]!.id));
    return outcome.result;
  });
}
