# Staging durable HTTP rate-limit proof

## Purpose and safety boundary

This proof demonstrates that migration `0020_security_runtime_least_privilege_rate_limit`
is reachable through the deployed HTTP path and eventually returns an
application-limiter HTTP `429` for an authenticated request bucket. It targets only the staging-only
`GET /api/security/rate-limit-proof` route. That route accepts no tenant,
business, financial, or command input, performs no business write, and returns
`204` before the limiter is exhausted. The limiter runs before authentication;
denied requests do not reach authentication or any command parser.

The harness is fixed at 21 sequential `GET` requests because the route uses
the dedicated 20-request, 60-second proof policy. It requires the first 20
responses to be `204` and request 21 to be `429` with `x-ratelimit-limit: 20`,
`x-ratelimit-remaining: 0`, and a positive integer `retry-after` no greater
than 60 seconds. A status `429` without those application limiter headers is
not a passing proof. The only durable state it
intentionally touches is the PostgreSQL rate-limit window through the named
capability; it does not share the normal authentication bucket. It stops on
any other status, redirect, timeout, or network error. It never reads or prints
response bodies, cookies, tokens, tenant data, or secrets.

The harness requires `APP_ENV=staging`, an explicit confirmation flag, an
HTTPS origin without credentials/path/query/fragment, and refuses obvious
production-looking hostnames. The session cookie is read only from
`STAGING_RATE_LIMIT_PROOF_SESSION_COOKIE`. If Vercel Deployment Protection
requires a bypass, `VERCEL_AUTOMATION_BYPASS_SECRET` may be injected into the
process environment by the approved secret manager; it is never a CLI
argument or evidence field.

## Preconditions

- The deployed commit includes migration `0020`, the staging-only proof route,
  and the harness.
- The target is an approved staging HTTPS origin, not production or a local
  server.
- An operator has authenticated through the normal staging HTTPS sign-in flow
  and has a current session cookie. Do not construct a cookie or read one from
  PostgreSQL.
- The operator has an approved evidence location and can identify the deployed
  commit without recording secrets.
- The operator has confirmed that 21 requests from the current egress address
  can be made inside one 60-second fixed window. If another test has already
  saturated the same bucket, wait for the window to expire before starting.

## Exact later staging execution

Load the cookie through the approved secret manager or secure environment
injection mechanism. Do not put it in shell history or the command line.

```sh
: "${STAGING_BASE_URL:?STAGING_BASE_URL must already be set to the approved staging HTTPS origin}"
: "${STAGING_RATE_LIMIT_PROOF_SESSION_COOKIE:?Inject the current staging session cookie securely}"

APP_ENV=staging node --conditions=react-server --import tsx scripts/staging-rate-limit-proof.ts \
  --confirm-staging-rate-limit-proof \
  --base-url "$STAGING_BASE_URL"
```

If Vercel protection requires the bypass, inject
`VERCEL_AUTOMATION_BYPASS_SECRET` into the process environment before the same
command. Do not echo it or pass it as an argument.

The command prints redacted per-request metadata and one JSON evidence record:
route, request count, generated request IDs, HTTP statuses, timings, whether
`429` was observed, and pass/fail. A successful run must show 20 `204` statuses
followed by one `429` carrying the application limiter headers above. The later
`429` proves the durable HTTP path only when the first 20 requests were
authenticated successes in the same fixed window; a generic/provider/WAF `429`
does not pass.

## Failure handling

Stop immediately if the first 20 requests are not all `204`, if request 21 is
not a `429` with all required application limiter headers, if any request
redirects, or if a timeout/network error occurs. Do not retry a failed run
against a business command route. Record only redacted status/timing/request-ID
metadata and investigate the deployment, session, database migration, egress
bucket state, or Vercel protection separately.

This repository task does not execute the proof, deploy the route, change
Vercel/Neon, or access staging credentials.
