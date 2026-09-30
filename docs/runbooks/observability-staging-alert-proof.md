# Staging alert-delivery proof

## Purpose and safety boundary

This rehearsal proves that a configured alert can reach its intended owner
without creating, changing, reversing, or deleting business data. It must run
against staging only. It uses the existing protected read-only operations
route and sends no cookie, password, token, request body, tenant ID, station ID,
or business command.

The stimulus script is checked in at
`scripts/staging-observability-alert-proof.ts`. It generates random UUID query
values and expects an unauthenticated `401` or `403` response. The application
therefore emits the existing redacted `http_error` and `http_request` events;
no database-backed business workflow is entered. The script requires an HTTPS
origin with no username, password, path, query, or fragment, requires the
explicit `--confirm-staging-alert-proof` flag, uses manual redirects, and
aborts each request after a bounded timeout. Response bodies are cancelled and
never printed or persisted.

For a Vercel deployment protected by a preview/deployment access check, the
operator may load `VERCEL_AUTOMATION_BYPASS_SECRET` from the approved secret
manager into the process environment for this one command. The script sends it
only as the `x-vercel-protection-bypass` request header. Never pass the secret
as a CLI argument, echo it, put it in the evidence record, or include it in
logs/output. Omit the variable when the staging deployment does not need the
Vercel bypass.

## Preconditions

- staging deployment URL and deployment/commit identifier;
- sink and dashboard access for the operator;
- alert owner and secondary/security owner available during the rehearsal;
- the `auth_security_failures` rule already exists in staging;
- current rule configuration and retention setting captured before changes; and
- a separate evidence location approved for the rehearsal.

## Procedure

1. Confirm the URL is staging and record the environment, deployment ID, commit
   SHA, operator, and UTC start time. Stop if the URL is production.
2. Capture the current `auth_security_failures` rule and delivery policy.
3. In staging only, create a temporary proof override for that alert:
   threshold `>= 1`, window `10m`, environment `staging`, with the same
   notification destination and runbook link. Record the override start time.
   Do not change the production rule.
4. From a machine with network access to staging, run:

   ```sh
   APP_ENV=staging pnpm exec tsx scripts/staging-observability-alert-proof.ts \
     --confirm-staging-alert-proof \
     --base-url "$STAGING_BASE_URL" \
     --count 1
   ```

   If Vercel protection requires the bypass, load the secret without placing it
   in shell history or command arguments, then run the same command with the
   process environment set, for example through the operator's secret-manager
   injection mechanism. The command prints only generated request IDs and HTTP
   statuses. A successful stimulus prints HTTP `401` or `403` and must not print
   response bodies or the bypass secret.
5. In the sink, search for the printed request ID and verify an event with
   `signal=http_error`, `errorClassification=unauthenticated` or `forbidden`,
   `environment=staging`, the expected deployment, and no sensitive fields.
   Verify the matching `http.request.completed` event has the same request ID
   and a `4xx` status class.
6. Confirm the dashboard panel updates and the temporary alert fires. The
   intended primary owner must receive the notification, acknowledge it, and
   record the acknowledgement time. If the escalation schedule requires a
   secondary path, allow the approved timer to elapse only if the operator has
   explicitly approved that test; otherwise record the secondary path as not
   exercised.
7. Restore the original staging threshold/window and verify the temporary
   override is deleted or disabled. Confirm no equivalent change exists in
   production. Record the cleanup time and the provider's final rule state.
8. Attach the evidence record and mark the result **passed**, **failed**, or
   **partial**. A partial result is not provider verification.

## Evidence capture template

Copy this block into the approved evidence location. Use UTC. Do not include
cookies, tokens, passwords, raw payloads, database URLs, tenant/station data, or
personal contact details beyond the owner/team identifier needed to prove
delivery.

```yaml
evidenceVersion: 1
result: passed | failed | partial
environment: staging
deploymentId: "<provider deployment id>"
commitSha: "<deployed commit sha>"
baseUrl: "<staging origin only>"
operator: "<name or team id>"
startedAtUtc: "<timestamp>"
finishedAtUtc: "<timestamp>"
alertId: auth_security_failures
temporaryOverride:
  threshold: ">= 1"
  window: 10m
  startedAtUtc: "<timestamp>"
  restoredAtUtc: "<timestamp>"
stimulus:
  command: "staging-observability-alert-proof --count 1"
  route: /api/forecourt/operations/overview
  requestIds: ["<generated request id>"]
  responseStatuses: [401]
sinkObservation:
  provider: "<provider>"
  eventTimestampUtc: "<timestamp>"
  signal: http_error
  errorClassification: unauthenticated
  environment: staging
  searchableRequestId: "<request id>"
  dashboardUrl: "<provider dashboard link>"
notification:
  destinationRole: "<primary on-call team>"
  deliveredAtUtc: "<timestamp>"
  acknowledgedAtUtc: "<timestamp>"
  secondaryPath: exercised | not_exercised | failed
retention:
  runtimeLogDays: "<approved value>"
  alertHistoryDays: "<approved value>"
  evidenceRetentionDays: "<approved value>"
cleanupConfirmed: true
notes: "<redacted findings, deviations, or follow-up>"
```

## Failure handling

If the script receives anything other than `401` or `403`, stop and investigate
without retrying business routes. If the event is absent from the sink, treat
the drain/parser as failed. If the event is searchable but no notification is
received, treat alert delivery as failed. Restore the temporary rule before
leaving the staging console and record the missing evidence; do not claim the
provider integration is verified.
