import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { seedDevelopmentOwner } from '../../scripts/seed-development';
import { signUpFromInvitation } from '../../src/modules/staff/commands';
import { hashInvitationToken } from '../../src/modules/staff/domain';
import { POST as staffCommand } from '../../src/app/api/staff/commands/route';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for Clerk cutover integration tests');
const db = postgres(url, { max: 1, prepare: false });
const seed = {
  clerkUserId: 'user_developmentseed18',
  tenantSlug: 'clerk-cutover-test',
  tenantName: 'Synthetic Clerk Test',
  email: 'clerk-seed@example.test',
  displayName: 'Synthetic Owner',
};
const key = { keyId: 'integration-seed', secret: 'integration-seed-signing-secret' };
let owner: Awaited<ReturnType<typeof seedDevelopmentOwner>>;
describe('Clerk-only development setup', () => {
  it('reserves a custom staff number case-insensitively and resolves activation', async () => {
    const invitation = randomUUID(),
      second = randomUUID();
    const staffNumber = `E${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const hash = hashInvitationToken(randomUUID());
    for (const id of [invitation, second])
      await db`insert into app.staff_invitations(id,tenant_id,invited_name,assigned_role,scope_type,token_hash,expires_at,created_by_user_id,created_by_membership_id) values(${id},${owner.tenantId},'Custom number','ADMINISTRATOR','TENANT',${id === invitation ? hash : hashInvitationToken(randomUUID())},now()+interval '1 day',${owner.userId},${owner.membershipId})`;
    await db.begin(async (tx) => {
      await tx`set local role app_runtime`;
      await tx`select set_config('app.actor_id',${owner.userId},true),set_config('app.tenant_id',${owner.tenantId},true),set_config('app.membership_id',${owner.membershipId},true)`;
      const rows =
        await tx`select app.reserve_staff_number(${invitation},${staffNumber.toLowerCase()}) as id`;
      await tx`update app.staff_invitations set delivery_method='MANUAL',staff_number_registry_id=${rows[0]!.id} where id=${invitation}`;
    });
    await expect(
      db.begin(async (tx) => {
        await tx`set local role app_runtime`;
        await tx`select set_config('app.actor_id',${owner.userId},true),set_config('app.tenant_id',${owner.tenantId},true),set_config('app.membership_id',${owner.membershipId},true)`;
        await tx`select app.reserve_staff_number(${second},${staffNumber})`;
      }),
    ).rejects.toMatchObject({ code: '23505' });
    await db.begin(async (tx) => {
      await tx`set local role app_runtime`;
      expect(
        (
          await tx`select staff_number from app.resolve_manual_staff_invitation(${hash},${staffNumber.toLowerCase()})`
        )[0]!.staff_number,
      ).toBe(staffNumber);
    });
  });
  it('permanently burns the code after five wrong guesses and allows a manager replacement', async () => {
    const staffNumber = `SF-${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
    const invitationId = randomUUID(),
      registryId = randomUUID();
    const originalHash = hashInvitationToken('7k3m-9r2x');
    await db`insert into app.staff_invitations(id,tenant_id,invited_name,assigned_role,scope_type,token_hash,expires_at,created_by_user_id,created_by_membership_id) values(${invitationId},${owner.tenantId},'Lockout Test','ADMINISTRATOR','TENANT',${originalHash},now()+interval '1 day',${owner.userId},${owner.membershipId})`;
    await db`insert into app.staff_number_registry(id,staff_number,normalized_staff_number,reserved_invitation_id) values(${registryId},${staffNumber},${staffNumber},${invitationId})`;
    await db`update app.staff_invitations set delivery_method='MANUAL',staff_number_registry_id=${registryId} where id=${invitationId}`;
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await staffCommand(
        new Request('http://localhost/api/staff/commands', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-real-ip': `activation-test-${randomUUID()}`,
          },
          body: JSON.stringify({
            commandType: 'ActivateManualStaff',
            staffNumber,
            activationCode: attempt === 5 ? '7K3M-9R2X' : '2ABC-3DEF',
            password: 'fixture-only-password-18',
          }),
        }),
      );
      expect(response.status).toBe(403);
    }
    const locked =
      await db`select token_hash,activation_failed_attempts from app.staff_invitations where id=${invitationId}`;
    expect(locked[0]!.activation_failed_attempts).toBe(5);
    expect(locked[0]!.token_hash).not.toBe(originalHash);
    expect(
      await db`select * from app.resolve_manual_staff_invitation(${originalHash},${staffNumber})`,
    ).toHaveLength(0);
    // No time-based reset: moving updated_at into the past changes nothing.
    await db`update app.staff_invitations set updated_at=now()-interval '1 day' where id=${invitationId}`;
    expect(
      (
        await db`select app.check_manual_activation_attempt(${staffNumber},${originalHash}) as allowed`
      )[0]!.allowed,
    ).toBe(false);
    const replacement = hashInvitationToken(randomUUID());
    await db`update app.staff_invitations set token_hash=${replacement},expires_at=now()+interval '3 days' where id=${invitationId}`;
    expect(
      (
        await db`select activation_failed_attempts from app.staff_invitations where id=${invitationId}`
      )[0]!.activation_failed_attempts,
    ).toBe(0);
    await db.begin(async (tx) => {
      await tx`set local role app_runtime`;
      expect(
        (
          await tx`select app.check_manual_activation_attempt(${staffNumber},${replacement}) as allowed`
        )[0]!.allowed,
      ).toBe(true);
    });
    const concurrent = postgres(url!, { max: 8, prepare: false });
    try {
      await Promise.all(
        Array.from(
          { length: 10 },
          () =>
            concurrent`select app.check_manual_activation_attempt(${staffNumber},${'f'.repeat(64)})`,
        ),
      );
      expect(
        (
          await db`select activation_failed_attempts from app.staff_invitations where id=${invitationId}`
        )[0]!.activation_failed_attempts,
      ).toBe(5);
      expect(
        (
          await db`select app.check_manual_activation_attempt(${staffNumber},${replacement}) as allowed`
        )[0]!.allowed,
      ).toBe(false);
    } finally {
      await concurrent.end();
    }
  });
  beforeAll(async () => {
    owner = await seedDevelopmentOwner(db, seed, key);
  });
  afterAll(async () => {
    await db.end();
  });
  it('has no legacy credential tables or provider mappings', async () => {
    const tables =
      await db`select tablename from pg_tables where schemaname in ('auth','legacy_auth')`;
    expect(tables).toHaveLength(0);
    expect(await db`select id from app.auth_identities where provider <> 'CLERK'`).toHaveLength(0);
    await expect(
      db`insert into app.auth_identities(internal_user_id,provider,provider_user_id) values(${owner.userId},'BETTER_AUTH','unused')`,
    ).rejects.toThrow();
  });
  it('seeds one mapping, membership and Owner assignment idempotently with audit', async () => {
    expect(await seedDevelopmentOwner(db, seed, key)).toEqual({ ...owner, changed: false });
    expect(
      await db`select id from app.auth_identities where internal_user_id=${owner.userId}`,
    ).toHaveLength(1);
    expect(
      await db`select id from app.membership_role_assignments where membership_id=${owner.membershipId}`,
    ).toHaveLength(1);
    expect(
      await db`select id from platform.security_events where tenant_id=${owner.tenantId} and event_code='ACCESS.DEVELOPMENT_OWNER_SEEDED'`,
    ).toHaveLength(1);
  });
  it('denies application directory reads without identity/tenant context', async () => {
    await db.begin(async (tx) => {
      await tx`set local role app_runtime`;
      expect(await tx`select id from app.users`).toHaveLength(0);
      await tx`select set_config('app.actor_id',${owner.userId},true)`;
      expect(await tx`select id from app.users`).toEqual([{ id: owner.userId }]);
    });
  });
  it('supports username-only Owners without invented email and is repeatable', async () => {
    const input = {
      ...seed,
      clerkUserId: 'user_usernameonly18',
      email: null,
      displayName: 'e12345',
    };
    const result = await seedDevelopmentOwner(db, input, key);
    expect(await seedDevelopmentOwner(db, input, key)).toEqual({ ...result, changed: false });
    expect(await db`select email,email_verified from app.users where id=${result.userId}`).toEqual([
      { email: null, email_verified: false },
    ]);
    expect(result.userId).not.toEqual(owner.userId);
  });
  it('refuses to relink the seeded internal user to another Clerk account', async () => {
    await expect(
      seedDevelopmentOwner(db, { ...seed, clerkUserId: 'user_different18' }, key),
    ).rejects.toThrow('another Clerk account');
  });
  it('creates an invited Clerk account mapping without granting membership before acceptance', async () => {
    const token = 'cutover-invitation-token'.padEnd(43, 'x');
    await db`insert into app.staff_invitations(id,tenant_id,invited_email,invited_name,assigned_role,scope_type,token_hash,expires_at,created_by_user_id,created_by_membership_id) values(${randomUUID()},${owner.tenantId},'new-invite@example.test','New invite','ADMINISTRATOR','TENANT',${hashInvitationToken(token)},now()+interval '1 day',${owner.userId},${owner.membershipId})`;
    const result = await signUpFromInvitation(
      { token, password: 'fixture-only-password-18' },
      {
        createClerkIdentity: async () => ({ providerUserId: 'user_newinvite18' }),
        deleteClerkIdentity: async () => {},
      },
    );
    expect(result).toEqual({ email: 'new-invite@example.test' });
    const links = await db<
      { internal_user_id: string }[]
    >`select internal_user_id from app.auth_identities where provider_user_id='user_newinvite18'`;
    expect(links).toHaveLength(1);
    expect(
      await db`select id from app.memberships where identity_id=${links[0]!.internal_user_id}`,
    ).toHaveLength(0);
  });
  it('denies invitation registration with an unknown token under app_runtime', async () => {
    await expect(
      db.begin(async (tx) => {
        await tx`set local role app_runtime`;
        await tx`select app.register_invited_clerk_identity(${'f'.repeat(64)},${randomUUID()}::uuid,'user_unknown18')`;
      }),
    ).rejects.toThrow('invitation unavailable');
  });
});
