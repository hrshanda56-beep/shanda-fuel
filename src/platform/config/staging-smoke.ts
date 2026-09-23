export function assertStagingSmokeAllowed(appEnv: string | undefined): void {
  if (appEnv !== 'staging') {
    throw new Error(
      appEnv === 'production'
        ? 'Refusing staging smoke in production'
        : 'Staging smoke requires APP_ENV=staging',
    );
  }
}
