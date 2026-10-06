/**
 * The owner-demo UI is a synthetic, browser-local presentation surface.
 * Keeping this guard in a tiny dependency-free module makes the production
 * refusal testable without importing the application database or auth stack.
 */
export function isOwnerDemoBuildEnabled(appEnv = process.env.APP_ENV): boolean {
  return appEnv === 'demo';
}
