# Observability provider setup and launch gate

## Boundary

This procedure describes the exact provider/operator work still required after
the in-repository observability slice. It does not select a vendor, contain
credentials, or claim that any external setup has been performed.

The application already emits JSON log records through the hosting runtime.
The provider must preserve these fields without parsing request bodies:

| Field | Required use |
| --- | --- |
| `timestamp`, `level`, `message`, `component` | ordering and source identification |
| `signal` | `http_request`, `http_error`, `dependency_failure`, `security_audit_failure`, or `provider_failure` |
| `environment` | staging/production separation |
| `requestId`, `route`, `routeClass`, `method` | correlation and dashboard grouping |
| `status`, `statusClass`, `durationMs` | availability/error/latency panels |
| `errorClassification`, `dependency`, `service`, `errorCode` | alert dimensions when present |

The authoritative definitions are [`alerts.json`](../../config/observability/alerts.json)
and [`dashboard.json`](../../config/observability/dashboard.json). Validate them
first:

```sh
pnpm exec tsx scripts/validate-observability.ts
```

## Operator inputs required before setup

Record these values in the evidence record; do not put secrets in the
repository:

| Input | Required value |
| --- | --- |
| Hosting project/team | exact Vercel team and project identifiers |
| Approved sink | vendor, account/workspace, endpoint, and data-processing owner |
| Sink authentication | secret stored in the sink/provider secret manager; never in Git or a shell argument |
| Primary on-call | named person/team and reachable destination |
| Secondary/security owner | named person/team and reachable destination |
| Escalation schedule | operator-approved acknowledgement and escalation targets; do not imply 24/7 coverage unless funded |
| Retention approvals | days and deletion behavior for staging, production, security/audit, alert history, and rehearsal evidence |
| Backup-status source | exact dashboard/API/runbook link and owner |

## Deployed sink setup

1. Confirm the deployed application is the intended staging or production
   deployment and that `APP_ENV` is correct. Keep staging and production
   records and credentials separate.
2. In the hosting provider, open the project/team log-drain settings. For
   Vercel, use the team Log Drains page:
   `https://vercel.com/dashboard/<team>/~/settings/log-drains`.
3. Create a drain for the approved sink using JSON or NDJSON over HTTPS. Include
   the runtime/function source used by the deployed Next.js Node routes and the
   staging and production environments as separate, explicitly labelled
   selections. Do not enable unrelated build or access sources unless the sink
   owner has approved them.
4. Store the drain signing secret only in the receiving sink's secret manager.
   Verify the provider signature against the raw request body before parsing;
   reject missing or invalid signatures. Never log the signature, secret, raw
   request body, cookies, authorization headers, or database URL.
5. Use the provider's drain-test action. Confirm one test payload is ingested,
   the `environment` and source labels are correct, and all required fields
   above remain queryable. Record the test timestamp and provider event ID.
6. Import or recreate every alert in `alerts.json` and every panel in
   `dashboard.json`. Preserve the alert IDs, windows, thresholds, dimensions,
   and runbook links. If the provider cannot express a condition exactly, stop
   and record the deviation before launch; do not silently weaken it.
7. Configure alert delivery using the recorded primary and secondary owners.
   Set the provider's acknowledgement/escalation timers to the approved
   operating schedule. Verify that the alert message includes environment,
   deployment, severity, route/component, error code/classification,
   request/correlation ID, first/last seen time, and incident link, without
   raw payloads or credentials.
8. Configure retention only after the approved values are recorded. Capture the
   provider setting showing duration, timezone/clock basis, automated deletion,
   and whether alert history remains available after log expiry.
9. Execute the staging-only proof in
   [`observability-staging-alert-proof.md`](observability-staging-alert-proof.md).
   Do not use a production URL, production credentials, or a business write
   command.

## Launch evidence required

The setup is not verified until the operator has evidence for all of these:

- sink/drain exists for the intended environments and accepts a signed test;
- a real staging runtime event is searchable with its request ID;
- every catalog alert is enabled with the intended threshold and window;
- dashboard panels render the required dimensions;
- the primary owner receives and acknowledges a staging alert;
- escalation to the configured secondary path is demonstrated or explicitly
  recorded as a controlled follow-up;
- retention values and deletion behavior are recorded; and
- a backup-status source and owner are linked.

Use the evidence template in the staging proof runbook. Until this evidence is
attached by the operator, the repository status remains “defined, not
provider-verified.”
