# Pilot-station operational acceptance checklist

Run against a disposable or approved pilot environment first. Mark **Verified**, **Not in scope**, or **Blocked** and attach the request/response, screenshot or record reference. A skipped check is not a pass.

## Owner

- [ ] Sign in through the configured Better Auth provider.
- [ ] Confirm tenant, legal entity and station context; cross-station access is denied.
- [ ] Confirm station readiness, approved prices, shift templates, payment accounts and staff scopes.
- [ ] Confirm opening stock count and valuation evidence before operations begin.
- [ ] Complete the authorized password + authenticator step-up and approve a submitted reconciliation.
- [ ] Confirm the approval changes the reconciliation/report state and creates no duplicate posting.
- [ ] Review daily reporting and exact totals against the signed source figures.

## Station Supervisor

- [ ] Sign in and remain within the assigned station context.
- [ ] Open the business day using the station timezone.
- [ ] Start a shift and capture each opening meter boundary from the physical reading.
- [ ] Confirm assigned attendants load in the station-scoped selector; an unassigned or other-station attendant is unavailable.
- [ ] Close meters with the responsible attendant(s), preserving the sealed boundary.
- [ ] Record payment declarations for each in-scope method.
- [ ] Record supported expenses only when the configured workflow and business policy are in scope; otherwise mark not in scope.
- [ ] Review stock dips/deliveries and variance evidence where used.
- [ ] Submit reconciliation without approving it.
- [ ] Confirm returned/corrected items follow the supported workflow and do not weaken authorization.

## Attendant

- [ ] Sign in using the assigned account and station scope.
- [ ] See only permitted shift and meter functions.
- [ ] Capture the assigned meter boundary accurately and preserve the physical evidence reference.
- [ ] Cannot submit Owner approval, change prices, manage staff, or access another station.
- [ ] Confirm a meter lower than the prior sealed reading is rejected or routed to the controlled exception path.

## Finance user

- [ ] Confirm provider and bank-account references are configured with masked values only.
- [ ] Confirm opening valuation and accounting treatment against source evidence.
- [ ] Review payment declarations, cash handover/deposit and settlement records where in scope.
- [ ] Review reconciliation totals, variance and reports using exact stored precision.
- [ ] Confirm finance approval permissions do not grant station setup or attendant functions unless explicitly assigned.
- [ ] Complete any required step-up; no MFA bypass or shared credentials are permitted.

## Acceptance evidence

Record environment, commit SHA, station/timezone, fixture IDs, actor IDs (synthetic or approved pilot only), timestamps, expected/actual litres, unit prices, payments, expenses, reconciliation total, approval result and authorization failures. Do not record secrets or full payment credentials.

## Exit criteria

The pilot is accepted only when all in-scope checks are Verified, every out-of-scope item is explicitly approved, cross-station and cross-role denials are demonstrated, and Owner/Finance sign the evidence pack. Real-account and real-data acceptance remains required before production opening.
