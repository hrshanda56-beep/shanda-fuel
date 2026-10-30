/**
 * Checks the Clerk keys before the app talks to Clerk, so a wrong pair is reported in plain words
 * instead of as Clerk's own "the secret key given with this proxy request is invalid". Only the
 * shape of each key is read; no key is ever returned or logged.
 *
 * A publishable key is `pk_<mode>_<base64 of the instance host>$`; a secret key is
 * `sk_<mode>_<random>`. Both must come from the same Clerk instance, so they must have the same
 * mode (test or live).
 */
type Env = Readonly<Record<string, string | undefined>>;

const ENV_HELP =
  'Copy both keys from the same Clerk instance (Clerk dashboard, API keys) into your environment. See .env.example.';

function keyMode(key: string, prefix: 'pk' | 'sk'): 'test' | 'live' | null {
  const match = new RegExp(`^${prefix}_(test|live)_.+`).exec(key);
  return match ? (match[1] as 'test' | 'live') : null;
}

function publishableHost(key: string): string | null {
  const encoded = key.replace(/^pk_(test|live)_/, '');
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    return decoded.endsWith('$') ? decoded.slice(0, -1) : null;
  } catch {
    return null;
  }
}

export function clerkEnvProblems(env: Env): string[] {
  const publishable = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const secret = env.CLERK_SECRET_KEY?.trim();
  const problems: string[] = [];
  if (!publishable) {
    problems.push(`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set. ${ENV_HELP}`);
  }
  if (!secret) {
    problems.push(`CLERK_SECRET_KEY is not set. ${ENV_HELP}`);
  }
  if (!publishable || !secret) return problems;

  const publishableMode = keyMode(publishable, 'pk');
  const secretMode = keyMode(secret, 'sk');
  if (!publishableMode) {
    problems.push(
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY does not look like a Clerk publishable key (it should start with pk_test_ or pk_live_). ${ENV_HELP}`,
    );
  }
  if (!secretMode) {
    problems.push(
      `CLERK_SECRET_KEY does not look like a Clerk secret key (it should start with sk_test_ or sk_live_). ${ENV_HELP}`,
    );
  }
  if (publishableMode && secretMode && publishableMode !== secretMode) {
    problems.push(
      `The Clerk keys are not from the same Clerk instance: the publishable key is a ${publishableMode} key and the secret key is a ${secretMode} key. ${ENV_HELP}`,
    );
  }
  const expectedHost = env.CLERK_EXPECTED_FRONTEND_HOST?.trim();
  const host = publishableMode ? publishableHost(publishable) : null;
  if (expectedHost && host && host !== expectedHost) {
    problems.push(`The publishable key belongs to ${host}, not ${expectedHost}. ${ENV_HELP}`);
  }
  return problems;
}

let reported = false;

/** Logs the problems once per server process. Safe to call from any server module. */
export function reportClerkEnvProblems(env: Env = process.env): string[] {
  const problems = clerkEnvProblems(env);
  if (problems.length > 0 && !reported) {
    reported = true;
    for (const problem of problems) console.error(`[clerk-config] ${problem}`);
  }
  return problems;
}
