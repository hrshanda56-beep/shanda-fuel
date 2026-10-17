import { createHash, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import { NextResponse } from 'next/server';
import { getAuditSigningKey } from '../../../../platform/config/env';
import { AppError } from '../../../../platform/errors';
import {
  createSqlStagingAuthSmokeRepository,
  runStagingAuthSmokeBootstrap,
  STAGING_AUTH_SMOKE_IDS,
  STAGING_AUTH_SMOKE_PERMISSIONS,
  type StagingAuthSmokeResult,
} from '../../../../platform/staging/auth-smoke-bootstrap';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const runtime = 'nodejs';

const EXPECTED_VERCEL_PROJECT_ID = 'prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4';
const EXPECTED_DATABASE_HOST = 'ep-empty-boat-b1wong3k.c-5.eu-central-1.aws.neon.tech';
const EXPECTED_DATABASE_NAME = 'shanda_fuel';
const STAGING_AUTH_SMOKE_EMAIL = 'operator+smoke@staging.shandafuel.invalid';
const STAGING_AUTH_SMOKE_ADVISORY_LOCK_KEY = 20_260_930;

function unavailable(): AppError {
  return new AppError('FORBIDDEN', 'Staging auth bootstrap is unavailable');
}

function assertSecureToken(expected: string | undefined, received: string | null): void {
  if (!expected || expected.length < 32 || !received) throw unavailable();
  const expectedDigest = createHash('sha256').update(expected).digest();
  const receivedDigest = createHash('sha256').update(received).digest();
  if (!timingSafeEqual(expectedDigest, receivedDigest)) throw unavailable();
}

function parseStagingDatabaseUrl(value: string | undefined): string {
  if (!value) throw unavailable();

  try {
    const url = new URL(value);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (
      (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
      url.hostname !== EXPECTED_DATABASE_HOST ||
      url.hostname.includes('-pooler') ||
      databaseName !== EXPECTED_DATABASE_NAME
    ) {
      throw unavailable();
    }
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable();
  }
}

function assertStagingConfiguration(): string {
  if (process.env.APP_ENV !== 'staging') throw unavailable();
  if (
    process.env.VERCEL_PROJECT_ID !== undefined &&
    process.env.VERCEL_PROJECT_ID !== EXPECTED_VERCEL_PROJECT_ID
  ) {
    throw unavailable();
  }
  if (process.env.DATABASE_DIRECT_URL !== undefined) throw unavailable();
  return parseStagingDatabaseUrl(process.env.STAGING_AUTH_BOOTSTRAP_DATABASE_URL);
}

function assertRefreshPreconditions(result: StagingAuthSmokeResult): void {
  if (
    !result.hierarchyValid ||
    !result.membershipValid ||
    result.authUser !== 'present' ||
    result.credentialAccount !== 'present' ||
    Object.values(result.permissionGrants).some((status) => status !== 'expired')
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Staging auth bootstrap preconditions are not satisfied',
    );
  }
}

function assertSuccessfulBootstrapResult(result: StagingAuthSmokeResult): void {
  if (
    result.mode !== 'bootstrap' ||
    !result.expiresAt ||
    Object.keys(result.permissionGrants).length !== STAGING_AUTH_SMOKE_PERMISSIONS.length ||
    STAGING_AUTH_SMOKE_PERMISSIONS.some(
      (permissionCode) => result.permissionGrants[permissionCode] !== 'created',
    )
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Staging auth bootstrap did not return four created grants and an expiry',
    );
  }
}

function safeSuccessResponse(result: StagingAuthSmokeResult): Response {
  return NextResponse.json(
    {
      success: true,
      grantStatuses: result.permissionGrants,
      expiresAt: result.expiresAt!.toISOString(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const POST = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const databaseUrl = assertStagingConfiguration();
    assertSecureToken(
      process.env.STAGING_AUTH_BOOTSTRAP_TOKEN,
      request.headers.get('x-staging-bootstrap-token'),
    );
    const auditKey = getAuditSigningKey();
    const client = postgres(databaseUrl, { max: 1, prepare: false });

    try {
      const result = await client.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${STAGING_AUTH_SMOKE_IDS.tenantId}, true)`;
        await transaction`select set_config('app.actor_id', ${STAGING_AUTH_SMOKE_IDS.actorId}, true)`;
        await transaction`select set_config('app.membership_id', ${STAGING_AUTH_SMOKE_IDS.membershipId}, true)`;
        await transaction`select pg_advisory_xact_lock(${STAGING_AUTH_SMOKE_ADVISORY_LOCK_KEY})`;
        const repository = createSqlStagingAuthSmokeRepository(transaction);
        const checked = await runStagingAuthSmokeBootstrap({
          repository,
          ids: STAGING_AUTH_SMOKE_IDS,
          mode: 'check',
          email: STAGING_AUTH_SMOKE_EMAIL,
        });
        assertRefreshPreconditions(checked);
        const bootstrapped = await runStagingAuthSmokeBootstrap({
          repository,
          ids: STAGING_AUTH_SMOKE_IDS,
          mode: 'bootstrap',
          email: STAGING_AUTH_SMOKE_EMAIL,
          requireExistingCredentialAccount: true,
          auditKey,
        });
        assertSuccessfulBootstrapResult(bootstrapped);
        return bootstrapped;
      });
      return safeSuccessResponse(result);
    } finally {
      await client.end({ timeout: 1 });
    }
  } catch (error) {
    return apiErrorResponse(request, error, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});
