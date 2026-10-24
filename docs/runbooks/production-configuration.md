# Production configuration and edge checklist

This checklist separates repository validation from provider/operator evidence.
Completing the repository checks does not prove that DNS, TLS, Vercel, Neon,
WAF, or secret-manager configuration exists.

## Repository checks

- `APP_ENV` is explicitly `staging` or `production` for deployed Node runtime.
- `APP_URL` is an HTTPS, non-loopback origin.
- `DATABASE_URL` is present for the deployed app runtime.
- `DATABASE_DIRECT_URL` is absent from the deployed app runtime. It is
  migration/deployment automation input only.
- `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `AUDIT_SIGNING_KEY_ID`, and a 32-character-or-longer
  `AUDIT_SIGNING_KEY` are present in both deployed environments.
- Clerk is the only authentication provider. Follow [Clerk-only cutover](clerk-only-cutover.md)
  when upgrading an existing environment; preserve internal user IDs and verify identity mappings.
- Staging and production use distinct secret-manager entries, database
  projects, storage credentials, and auth origins. The application can validate
  each environment's completeness, but it cannot compare two provider projects
  from inside one deployment.
- Migration `0020` is applied through the restricted direct migration path and
  the runtime-role proof confirms that the rate-limit backing table is not
  directly readable by `app_runtime`.

## DNS and TLS provider evidence

Record the following without recording credentials:

| Check | Required evidence |
| --- | --- |
| Production hostname | Approved hostname and deployment/project identifier |
| DNS ownership | DNS lookup showing the approved Vercel target; no accidental staging target or wildcard overlap |
| Certificate | Provider-managed certificate active for the exact hostname and valid chain/expiry |
| HTTPS redirect | HTTP requests redirect to HTTPS without redirect loops |
| TLS posture | Provider endpoint check confirms the approved TLS baseline and no mixed-content dependency |
| Origin headers | `/api/health` and `/api/readiness` return the expected security headers and no secret/body leakage |
| Environment binding | Deployment shows `APP_ENV=production`, production `APP_URL`, production database, and production secret references |

Do not paste secret values, connection strings, cookies, or private provider
screenshots into repository evidence.

## Edge and rate-limit provider prerequisites

- The edge/WAF is enabled for the production hostname and has an owner,
  alerting path, and documented emergency traffic-control procedure.
- The provider normalizes a trusted client-address header before the Node
  runtime. Do not allow arbitrary client-supplied forwarding headers to defeat
  the PostgreSQL buckets.
- The deployed release has migration `0020`, and authenticated smoke verifies
  that repeated auth/command POSTs eventually return `429` with bounded
  `Retry-After` metadata.
- PostgreSQL-backed limiting protects application abuse across Vercel
  instances; it is not a replacement for volumetric DDoS/WAF controls.

## Rollback/configuration safety

1. Record the immutable deployment ID, commit, migration state, and operator.
2. If only application behavior is defective and schema compatibility is
   confirmed, point traffic to the last compatible deployment.
3. Do not reverse migration `0020` during an incident. If the new application
   cannot use the limiter capability, stop rollout and use the database/provider
   incident path rather than granting broad table access.
4. Re-run health, readiness, runtime-role denial, and the approved authenticated
   smoke before sign-off.
