/**
 * Development-only surfaces (`/design-system`, `/design-system/entry`,
 * `/dev-preview/**`) hold synthetic content and exist for visual, theme and
 * accessibility QA. They are available only under `next dev`, which is how
 * Playwright and the isolated runner serve the app. The check is fail-closed:
 * any other NODE_ENV, including a mistyped or unexpected one on `next start`,
 * renders the standard 404.
 */
export function isDevOnlySurfaceAvailable(nodeEnv: string | undefined = process.env.NODE_ENV) {
  return nodeEnv === 'development';
}

/**
 * True for a path that belongs to a development-only surface. The proxy answers these with a plain
 * 404 before any page renders, so the status never depends on a page's own not-found handling
 * (a loading screen can send a 200 status before a page gets to say "not found").
 */
export function isDevOnlyPath(pathname: string) {
  return /^\/(dev-preview|design-system|foundation)(\/|$)/.test(pathname);
}

/** The design-system reference uses the same fail-closed rule. */
export function isDesignSystemReferenceAvailable(
  nodeEnv: string | undefined = process.env.NODE_ENV,
) {
  return isDevOnlySurfaceAvailable(nodeEnv);
}
