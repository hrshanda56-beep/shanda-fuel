/**
 * The design-system reference (`/design-system`) is an internal development
 * tool for visual, theme, and accessibility QA. It is intentionally
 * unavailable in production builds (`next build` / `next start`), where the
 * route renders the standard 404. It is available under `next dev`, which is
 * also how Playwright runs the E2E suite locally and in CI.
 */
export function isDesignSystemReferenceAvailable(
  nodeEnv: string | undefined = process.env.NODE_ENV,
) {
  return nodeEnv !== 'production';
}
