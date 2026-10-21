/**
 * The owner-demo UI is a synthetic, browser-local presentation surface.
 * It is available only in an explicitly named demo environment and never
 * participates in the authenticated application data path.
 */
export function isOwnerDemoBuildEnabled(appEnv = process.env.APP_ENV): boolean {
  return appEnv === 'demo';
}
