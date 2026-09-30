# Production-safe read-only verification

## Purpose and boundary

This harness verifies application liveness, database readiness, one existing
authenticated read-only operations endpoint, and optional cross-tenant denial.
It is suitable for staging rehearsal and later controlled production
verification. It never runs migrations, authentication bootstrap, business-day
commands, financial commands, storage writes, email sends, grant changes, or
provider control-plane operations.

The implementation is in
`src/platform/smoke/read-only.ts`; the operator entry point is
`scripts/production-readonly-smoke.ts`.

## Safety rules

- `--environment staging` or `--environment production` is mandatory.
- The base URL must be an explicit HTTPS origin.
- Production additionally requires `--confirm-readonly-production`.
- Only `GET` and `HEAD` can be emitted by the shared HTTP client.
- The harness uses only the existing `GET /api/health`,
  `GET /api/readiness`, and `GET /api/forecourt/operations/overview` routes.
- Tenant B denial accepts only HTTP 403 or 404. HTTP 200 is a denial mismatch.
- No response body is written to evidence. Health/readiness bodies are parsed
  only in memory against a minimal shape.
- Never pass a session cookie, password, token, or other credential as a CLI
  argument. Do not print the secure process environment.

## Authentication

The repository has no automated sign-in client. Obtain a Better Auth session
through the normal HTTPS sign-in flow described by the staging auth runbook,
then ensure `READONLY_SMOKE_SESSION_COOKIE` is already exported or injected by
the approved secret manager or secure operator mechanism before starting the
harness. Never assign the cookie in the command, pass it as an argument, or
place it in shell history.

The harness does not construct, inspect, print, or persist the cookie. If the
variable is absent, health/readiness are still checked, but the required
Tenant A check fails as `authentication_not_configured`; no authenticated HTTP
request is issued.

## Staging rehearsal

Use a current approved staging deployment, synthetic Tenant A data, and an
approved Tenant B context when available:

```sh
: "${SMOKE_BASE_URL:?SMOKE_BASE_URL must already be set}"
: "${SMOKE_TENANT_A_ID:?SMOKE_TENANT_A_ID must already be set}"
: "${SMOKE_STATION_A_ID:?SMOKE_STATION_A_ID must already be set}"

SMOKE_ARGS=(
  --environment staging
  --base-url "$SMOKE_BASE_URL"
  --tenant-a-id "$SMOKE_TENANT_A_ID"
  --station-a-id "$SMOKE_STATION_A_ID"
)

if [[ -n "${SMOKE_TENANT_B_ID:-}" || -n "${SMOKE_STATION_B_ID:-}" ]]; then
  : "${SMOKE_TENANT_B_ID:?SMOKE_TENANT_B_ID must be set with SMOKE_STATION_B_ID}"
  : "${SMOKE_STATION_B_ID:?SMOKE_STATION_B_ID must be set with SMOKE_TENANT_B_ID}"
  SMOKE_ARGS+=(
    --tenant-b-id "$SMOKE_TENANT_B_ID"
    --station-b-id "$SMOKE_STATION_B_ID"
  )
fi

if [[ -n "${SMOKE_DEPLOYMENT_ID:-}" ]]; then
  SMOKE_ARGS+=(--deployment-id "$SMOKE_DEPLOYMENT_ID")
fi

if [[ -n "${SMOKE_COMMIT:-}" ]]; then
  SMOKE_ARGS+=(--commit "$SMOKE_COMMIT")
fi

APP_ENV=staging pnpm smoke:production-readonly -- "${SMOKE_ARGS[@]}"
```

Supply `SMOKE_BASE_URL`, `SMOKE_TENANT_A_ID`, `SMOKE_STATION_A_ID`, and any
optional Tenant B, deployment, or commit variables through the approved secure
operator mechanism. The command prints one redacted JSON evidence record to
stdout and returns non-zero if a required check fails.

## Later controlled production verification

Production requires the same explicit inputs plus the inline flag
`--confirm-readonly-production`.

Do not run this until the deployment owner approves the target URL, read-only
session method, tenant contexts, observation window, and evidence destination.
This repository task does not execute production verification.

## Evidence schema

The JSON record contains only:

- schema version and target environment;
- optional safe deployment and commit identifiers;
- timestamp;
- check name, pass/fail/skipped status, required flag;
- HTTP status, validated UUID-shaped request ID, and elapsed milliseconds; and
- a bounded failure code.

It never contains response bodies, cookies, authorization headers, credentials,
tenant business data, financial payloads, or secret values.

## Required owner/provider inputs

- approved current staging and production HTTPS origins;
- synthetic Tenant A and optional Tenant B/station IDs;
- secure Better Auth session acquisition and injection method;
- deployment/commit evidence identifiers;
- approved observation window and evidence retention location.

The canonical migration README and journal are kept in sync through `0020`.
This harness still does not provide provider-side DNS, TLS, WAF, secret-manager,
or CodeQL availability evidence.
