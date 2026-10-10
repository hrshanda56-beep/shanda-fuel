// Unit and integration fixtures exercise the Better Auth path unless a test
// explicitly selects Clerk. Production configuration must set AUTH_PROVIDER;
// this harness default is not application fallback behavior.
process.env.AUTH_PROVIDER ??= 'BETTER_AUTH';
