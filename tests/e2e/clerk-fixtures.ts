import { clerk, clerkSetup } from '@clerk/testing/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import type { Sql } from 'postgres';
import { readFile } from 'node:fs/promises';
import { totpCode, totpSetupKeyFor } from './totp';

type ClerkUserFixture = { userId: string; email: string; storageState?: string };
let setup: Promise<void> | undefined;

/** Existing users in a dedicated Clerk development instance, keyed by app UUID. */
function fixture(id: string): ClerkUserFixture {
  if (
    !(process.env.CLERK_TEST_SECRET_KEY ?? process.env.CLERK_SECRET_KEY)?.startsWith('sk_test_')
  ) {
    throw new Error(
      'Authenticated E2E requires a dedicated Clerk development instance (sk_test_ key).',
    );
  }
  const users = JSON.parse(process.env.E2E_CLERK_USERS ?? '{}') as Record<string, ClerkUserFixture>;
  const user = users[id];
  if (!user?.userId?.startsWith('user_') || !user.email) {
    throw new Error(
      `E2E_CLERK_USERS must map app user ${id} to an existing Clerk { userId, email, storageState? }.`,
    );
  }
  return user;
}

export async function seedClerkIdentity(client: Sql, internalUserId: string) {
  const user = fixture(internalUserId);
  await client`
    insert into app.auth_identities (provider, provider_user_id, internal_user_id)
    values ('CLERK', ${user.userId}, ${internalUserId})
    on conflict (provider, provider_user_id) do update set internal_user_id = excluded.internal_user_id
  `;
}

type SignInAttempt = {
  status: string | null;
  createdSessionId: string | null;
  attemptSecondFactor: (input: { strategy: 'totp'; code: string }) => Promise<SignInAttempt>;
};

/**
 * A user with an authenticator stops at "needs second factor" when signed in with a ticket, which
 * is what Clerk's own test helper does. This signs in with a one-time ticket and then completes the
 * second factor with the authenticator code, as a person would. Test users only.
 */
async function signInWithAuthenticator(page: Page, user: ClerkUserFixture) {
  const secretKey = process.env.CLERK_TEST_SECRET_KEY ?? process.env.CLERK_SECRET_KEY;
  const response = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: user.userId, expires_in_seconds: 120 }),
  });
  if (!response.ok) throw new Error(`Clerk sign-in ticket failed (${response.status})`);
  const { token } = (await response.json()) as { token: string };
  await clerk.loaded({ page });
  const code = totpCode(totpSetupKeyFor(user.email)!);
  await page.evaluate(
    async ({ ticket, authenticatorCode }) => {
      const client = (
        window as unknown as {
          Clerk: {
            client: { signIn: { create: (input: object) => Promise<SignInAttempt> } };
            setActive: (input: { session: string | null }) => Promise<void>;
          };
        }
      ).Clerk;
      let attempt = await client.client.signIn.create({ strategy: 'ticket', ticket });
      if (attempt.status === 'needs_second_factor')
        attempt = await attempt.attemptSecondFactor({ strategy: 'totp', code: authenticatorCode });
      if (attempt.status !== 'complete') throw new Error(`Sign-in ended as ${attempt.status}`);
      await client.setActive({ session: attempt.createdSessionId });
    },
    { ticket: token, authenticatorCode: code },
  );
}

/** Use Clerk's supported helper or a real, previously authenticated MFA state. */
export async function authenticateClerk(context: BrowserContext, internalUserId: string) {
  const user = fixture(internalUserId);
  setup ??= clerkSetup({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_TEST_SECRET_KEY ?? process.env.CLERK_SECRET_KEY,
  });
  await setup;
  await context.clearCookies();
  if (user.storageState) {
    // This is Playwright's exported state from real Clerk authentication, never
    // a fabricated cookie. Privileged suites require fresh MFA in that state.
    const state = JSON.parse(await readFile(user.storageState, 'utf8')) as Awaited<
      ReturnType<BrowserContext['storageState']>
    >;
    await context.addCookies(state.cookies);
  } else {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('/login');
    const setupKey = totpSetupKeyFor(user.email);
    if (setupKey) await signInWithAuthenticator(page, user);
    else await clerk.signIn({ page, emailAddress: user.email });
  }
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('/');
  await clerk.loaded({ page });
  const authenticatedUser = await page.evaluate(
    () => (window as unknown as { Clerk: { user: { id: string } | null } }).Clerk.user?.id,
  );
  if (authenticatedUser !== user.userId)
    throw new Error(`Clerk E2E state does not match app user ${internalUserId}`);
}

type StepUpSession = {
  startVerification: (input: { level: 'second_factor' }) => Promise<unknown>;
  attemptSecondFactorVerification: (input: { strategy: 'totp'; code: string }) => Promise<unknown>;
  getToken: (input: { skipCache: boolean }) => Promise<string | null>;
};

/**
 * Completes a real Clerk second-factor reverification in the browser with an authenticator code
 * worked out from the user's setup key (E2E_TOTP_SECRETS), then refreshes the session token so the
 * server sees the fresh second factor. Without a key the caller's saved MFA state must be fresh.
 */
async function reverifyWithAuthenticator(context: BrowserContext, internalUserId: string) {
  const setupKey = totpSetupKeyFor(fixture(internalUserId).email);
  if (!setupKey) return;
  const page = context.pages()[0] ?? (await context.newPage());
  const code = totpCode(setupKey);
  await page.evaluate(async (authenticatorCode) => {
    const session = (window as unknown as { Clerk: { session: StepUpSession | null } }).Clerk
      .session;
    if (!session) throw new Error('No Clerk session to reverify.');
    await session.startVerification({ level: 'second_factor' });
    await session.attemptSecondFactorVerification({ strategy: 'totp', code: authenticatorCode });
    await session.getToken({ skipCache: true });
  }, code);
}

export async function establishClerkStepUp(
  context: BrowserContext,
  tenantId: string,
  action: 'LOCK_BUSINESS_DAY' | 'DEACTIVATE_STAFF_MEMBER' = 'LOCK_BUSINESS_DAY',
  internalUserId?: string,
) {
  const input = { data: { tenantId, action } };
  const challenge = await context.request.post('/api/auth/step-up', input);
  if (
    challenge.status() !== 403 ||
    !challenge.headers()['set-cookie']?.includes('clerk-step-up-challenge')
  ) {
    throw new Error(`Expected a real Clerk step-up challenge, received ${challenge.status()}`);
  }
  if (internalUserId) await reverifyWithAuthenticator(context, internalUserId);
  const verified = await context.request.post('/api/auth/step-up', input);
  if (verified.status() !== 200) {
    throw new Error(
      `Clerk step-up failed (${verified.status()}); provide a fresh real MFA storageState for this privileged E2E user.`,
    );
  }
}

export async function clerkSessionStatus(internalUserId: string) {
  const user = fixture(internalUserId);
  const response = await fetch(
    `https://api.clerk.com/v1/sessions?user_id=${encodeURIComponent(user.userId)}&status=active`,
    {
      headers: {
        Authorization: `Bearer ${process.env.CLERK_TEST_SECRET_KEY ?? process.env.CLERK_SECRET_KEY}`,
      },
    },
  );
  if (!response.ok) throw new Error(`Clerk session verification failed (${response.status})`);
  const sessions = (await response.json()) as { id: string }[];
  return sessions;
}
