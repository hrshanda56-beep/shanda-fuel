# Staging performance verification runbook

## Objective

Measure the deployed RC with representative synthetic data before pilot
approval. This is an evidence procedure, not a new performance contract and
not authorization to use production data.

Blueprint planning goals are: ordinary commands usually below one second,
common useful pages around two seconds or better under reasonable regional
mobile conditions, large reports executed as background work, and truthful
retry/draft behavior on low bandwidth. Network latency outside the test
environment must be recorded separately.

## Preconditions

- Approved staging URL and deployment identifier for the RC commit.
- Synthetic/anonymized Tenant A and Tenant B data, with at least one station,
  open business day, shifts, meters, prices, reconciliation drafts, finalized
  revisions, inventory movements, cash/provider evidence, and reporting data.
- Approved operator credentials created through the staging auth bootstrap;
  do not use production accounts or copy production data.
- Browser/device profiles for a normal desktop and a representative mobile or
  throttled connection.
- A clean staging window, test timestamp/time zone, database/provider status,
  and a way to export redacted timing evidence.

## Procedure

1. Record commit, deployment, region, database tier, browser/device, network
   profile, dataset size, operator, and UTC start/end times.
2. Run the check-only staging auth bootstrap and platform smoke checks. Stop if
   the environment is not staging or if the deployed commit is not the RC.
3. Warm the application once, then discard the warm-up sample. Capture at least
   10 repetitions per ordinary flow and at least 5 per page flow; record p50
   and p95, plus errors and retries.
4. Measure these representative flows:
   - authenticated shell and station/day/shift context load;
   - deliberate daily-operations draft load, save, refresh, and conflict state;
   - reconciliation submit/review/approve read path;
   - inventory stock and valuation reads;
   - cash and provider settlement summaries;
   - management/daily reporting pages with filters; and
   - sign-in, step-up/MFA setup/verification, and permission-denial responses
     as deployed, without altering their behavior.
5. Repeat the critical entry flow with throttled bandwidth and one interrupted
   request. Confirm the UI communicates retry/conflict state and does not claim
   an authoritative write that was not confirmed.
6. Check database/provider logs for timeouts, pool exhaustion, slow queries,
   failed commands, duplicate effects, or noisy retries. Do not infer success
   from a browser spinner alone.
7. Repeat the Tenant B denial checks while authenticated as Tenant A. No
   performance result is acceptable if isolation or audit evidence fails.
8. Attach redacted timings, errors, deployment metadata, and owner disposition
   to the release record.

## Evidence and disposition

| Field | Result |
| --- | --- |
| RC commit/deployment/region |  |
| Dataset profile |  |
| Ordinary command p50/p95 |  |
| Common page p50/p95 |  |
| Mobile/throttled result |  |
| Error/conflict/retry result |  |
| Tenant-isolation result |  |
| Database/provider observations |  |
| Owner disposition and exceptions |  |

Any result above the planning goal, integrity failure, unexplained timeout,
duplicate effect, or misleading offline/retry state is an open release issue.
The release owner must classify it as a defect, environment capacity issue,
accepted pilot limitation, or post-release follow-up with a named owner; do not
silently waive it.
