import { describe, expect, it } from 'vitest';
import { clerkEnvProblems } from './clerk-env';

// Real keys look like pk_test_<base64 of the frontend host>$ and sk_test_<random>.
const host = (name: string) => Buffer.from(`${name}$`).toString('base64');
const publishable = (mode: 'test' | 'live', name = 'calm-fox-1.clerk.accounts.dev') =>
  `pk_${mode}_${host(name)}`;
const secret = (mode: 'test' | 'live') => `sk_${mode}_abcdefghijklmnopqrstuvwxyz`;

describe('clerkEnvProblems', () => {
  it('accepts a matching test pair', () => {
    expect(
      clerkEnvProblems({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable('test'),
        CLERK_SECRET_KEY: secret('test'),
      }),
    ).toEqual([]);
  });

  it('accepts a matching live pair', () => {
    expect(
      clerkEnvProblems({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable('live', 'clerk.fuel.example.com'),
        CLERK_SECRET_KEY: secret('live'),
      }),
    ).toEqual([]);
  });

  it('says which key is missing, in plain words', () => {
    const problems = clerkEnvProblems({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable('test') });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('CLERK_SECRET_KEY');
    expect(problems[0]).toContain('.env.example');
    expect(clerkEnvProblems({ CLERK_SECRET_KEY: secret('test') })[0]).toContain(
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    );
  });

  it('catches a test key paired with a live key (the "secret key is invalid" cause)', () => {
    const problems = clerkEnvProblems({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable('test'),
      CLERK_SECRET_KEY: secret('live'),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('same Clerk instance');
  });

  it('catches keys that are not Clerk keys at all, without echoing them', () => {
    const problems = clerkEnvProblems({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'placeholder',
      CLERK_SECRET_KEY: 'hunter2-not-a-key',
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).not.toContain('hunter2');
    expect(problems.join(' ')).not.toContain('placeholder');
  });

  it('reports the instance host so a mismatch can be traced without showing a secret', () => {
    const problems = clerkEnvProblems({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable('test', 'other.clerk.accounts.dev'),
      CLERK_SECRET_KEY: secret('test'),
      CLERK_EXPECTED_FRONTEND_HOST: 'calm-fox-1.clerk.accounts.dev',
    });
    expect(problems[0]).toContain('other.clerk.accounts.dev');
  });
});
