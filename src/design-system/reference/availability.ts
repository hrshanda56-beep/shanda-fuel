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

/** The design-system reference uses the same fail-closed rule. */
export function isDesignSystemReferenceAvailable(
  nodeEnv: string | undefined = process.env.NODE_ENV,
) {
  return isDevOnlySurfaceAvailable(nodeEnv);
}
