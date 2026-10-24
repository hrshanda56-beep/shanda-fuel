import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import postgres, { type Sql } from 'postgres';
import { createClerkClient } from '@clerk/backend';
import { z } from 'zod';
import { signSecurityEvent } from '../src/platform/security/audit-signing';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

export const developmentSeedSchema = z.object({
  clerkUserId: z.string().regex(/^user_[a-zA-Z0-9]+$/),
  tenantSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  tenantName: z.string().trim().min(1).max(160),
  email: z.email().nullable(),
  displayName: z.string().trim().min(1).max(160),
});

export async function seedDevelopmentOwner(
  client: Sql,
  input: z.infer<typeof developmentSeedSchema>,
  auditKey: { keyId: string; secret: string },
) {
  const seed = developmentSeedSchema.parse(input);
  return client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`dev-owner:${seed.tenantSlug}`}, 0))`;
    const tenants = await tx<
      { id: string; name: string; status: string }[]
    >`select id,name,status from app.tenants where slug=${seed.tenantSlug} for update`;
    if (tenants[0] && (tenants[0].name !== seed.tenantName || tenants[0].status !== 'ACTIVE'))
      throw new Error('Existing tenant does not match the active seed company');
    const tenantId = tenants[0]?.id ?? randomUUID();
    if (!tenants[0])
      await tx`insert into app.tenants(id,name,slug) values(${tenantId},${seed.tenantName},${seed.tenantSlug})`;
    const mapped = await tx<
      { internal_user_id: string }[]
    >`select internal_user_id from app.auth_identities where provider='CLERK' and provider_user_id=${seed.clerkUserId}`;
    const existing = seed.email
      ? await tx<
          { id: string }[]
        >`select id from app.users where lower(btrim(email))=${seed.email.toLowerCase()}`
      : [];
    if (mapped[0] && existing[0] && mapped[0].internal_user_id !== existing[0].id)
      throw new Error('Email and Clerk mapping refer to different users');
    const userId = mapped[0]?.internal_user_id ?? existing[0]?.id ?? randomUUID();
    if (!mapped[0] && !existing[0])
      await tx`insert into app.users(id,name,email,email_verified) values(${userId},${seed.displayName},${seed.email?.toLowerCase() ?? null},${seed.email !== null})`;
    const otherMapping = await tx<
      { provider_user_id: string }[]
    >`select provider_user_id from app.auth_identities where provider='CLERK' and internal_user_id=${userId}`;
    if (otherMapping[0] && otherMapping[0].provider_user_id !== seed.clerkUserId)
      throw new Error('Internal identity already belongs to another Clerk account');
    if (!mapped[0])
      await tx`insert into app.auth_identities(internal_user_id,provider,provider_user_id) values(${userId},'CLERK',${seed.clerkUserId})`;
    const memberships = await tx<
      { id: string; status: string }[]
    >`select id,status from app.memberships where tenant_id=${tenantId} and identity_id=${userId} for update`;
    if (memberships[0] && memberships[0].status !== 'ACTIVE')
      throw new Error('Seed refuses to reactivate an inactive membership');
    const membershipId = memberships[0]?.id ?? randomUUID();
    if (!memberships[0])
      await tx`insert into app.memberships(id,tenant_id,identity_id,status) values(${membershipId},${tenantId},${userId},'ACTIVE')`;
    const roles =
      await tx`select id from app.membership_role_assignments where tenant_id=${tenantId} and membership_id=${membershipId} and role_code='OWNER' and scope_type='TENANT' and expires_at is null`;
    if (!roles[0])
      await tx`insert into app.membership_role_assignments(tenant_id,membership_id,role_code,scope_type) values(${tenantId},${membershipId},'OWNER','TENANT')`;
    if (!roles[0] || !mapped[0]) {
      const event = signSecurityEvent(
        {
          eventId: randomUUID(),
          tenantId,
          membershipId,
          actorId: userId,
          eventCode: 'ACCESS.DEVELOPMENT_OWNER_SEEDED',
          requestId: randomUUID(),
          occurredAt: new Date().toISOString(),
          details: {
            actorType: 'SUPPORT',
            initiatedBy: 'development-seed',
            subjectType: 'ApplicationUser',
            subjectId: userId,
          },
        },
        auditKey,
      );
      await tx`insert into platform.security_events(id,tenant_id,membership_id,actor_id,event_code,request_id,occurred_at,details,key_id,algorithm,signature) values(${event.eventId},${tenantId},${membershipId},${userId},${event.eventCode},${event.requestId},${event.occurredAt},${tx.json(event.details as never)},${event.keyId},${event.algorithm},${event.signature})`;
    }
    return { tenantId, userId, membershipId, role: 'OWNER', changed: !roles[0] || !mapped[0] };
  });
}

async function main() {
  if (!['local', 'test'].includes(process.env.APP_ENV ?? 'local'))
    throw new Error('Development seed cannot run in staging or production');
  const key = process.env.CLERK_SECRET_KEY;
  if (!key?.startsWith('sk_test_'))
    throw new Error('A Clerk development key (sk_test_) is required');
  const clerkUserId = process.env.SEED_CLERK_USER_ID;
  if (!clerkUserId)
    throw new Error('Set SEED_CLERK_USER_ID to your existing Clerk development user ID');
  const user = await createClerkClient({ secretKey: key }).users.getUser(clerkUserId);
  const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  if (email && email.verification?.status !== 'verified')
    throw new Error('Verify the primary email on the Clerk development account first');
  if (!email && !user.username)
    throw new Error('A Clerk username or verified primary email is required');
  const input = developmentSeedSchema.parse({
    clerkUserId,
    tenantSlug: process.env.SEED_TENANT_SLUG,
    tenantName: process.env.SEED_TENANT_NAME,
    email: email?.emailAddress ?? null,
    displayName:
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.username ||
      email?.emailAddress,
  });
  const apply = process.argv.includes('--apply');
  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'preview',
      tenant: input.tenantName,
      role: 'OWNER',
      clerkUserId,
    }),
  );
  if (!apply) {
    console.log('Preview only. Add --apply to create the development records.');
    return;
  }
  const url = process.env.DATABASE_DIRECT_URL;
  if (!url) throw new Error('DATABASE_DIRECT_URL is required');
  const keyId = process.env.AUDIT_SIGNING_KEY_ID,
    secret = process.env.AUDIT_SIGNING_KEY;
  if (!keyId || !secret)
    throw new Error('Configure the audit signing key before applying the seed');
  const db = postgres(url, { max: 1, prepare: false });
  try {
    console.log(JSON.stringify(await seedDevelopmentOwner(db, input, { keyId, secret })));
  } finally {
    await db.end();
  }
}
if (process.argv[1]?.endsWith('seed-development.ts'))
  main().catch(() => {
    console.error(
      'Development seed failed. Check the supplied Clerk user, seed configuration, migration state and database privileges. No credentials were logged.',
    );
    process.exitCode = 1;
  });
