# Station-selection acceptance procedure

**Status: STATION ACCEPTANCE READY**

This is a targeted, read-only browser acceptance procedure for the Shanda Fuel
station-selection flow. It is intended for an approved staging deployment or
release candidate only. It does not authorize production execution, business
transactions, staff changes, setup/configuration writes, database changes,
MFA enrolment, deployment, merge, or hotfix-branch edits.

## 1. Released route contract

The released application baseline is
`2c7304916c191c66907d9582a3e7c26225c6eb59` (the release identity recorded in
`docs/CURRENT_STATUS.md`). The route contract is:

| Stage | Released route/operation | Expected behavior |
| --- | --- | --- |
| Sign-in | `/login` | A successful Better Auth sign-in, including the required TOTP challenge when enabled, lands at `/workplace`. A crafted `next` is not allowed to bypass this default. |
| Chooser | `/workplace` | The server discovers the authenticated actor's authorised organisation → legal entity → station tree. With more than one valid station and no valid remembered choice, it shows **Where are you working today?**. It must not use a hard-coded station list. |
| Choose | `POST /api/context` | The browser submits `{ pathname: "/", selection: { organisationId, legalEntityId, stationId, allStations: false } }`. The server revalidates membership, scope, station status, `tenant.context.select`, and `station.view` before accepting it. |
| Landing | `/` | A valid choice is persisted as the HTTP-only `shanda-fuel-context` cookie and the browser is pushed to `/`. The Owner's workspace loads there; the station must be shown by the resolved work-context control/data, not inferred from a browser-only value. |
| Reuse | `/workplace` after a valid remembered choice | The server validates the remembered choice and continues to `/`; it does not show the chooser again until the choice is absent or no longer valid. |
| Switch | `POST /api/context`, then `buildContextHref(...)` | The shared header **Work context** control opens **Switch station**. A valid switch updates the cookie and preserves the current route. On query routes, the resulting URL carries `tenantId`, `legalEntityId`, and `stationId`; on a dynamic station route the station ID is replaced in `/stations/{stationId}/...`. |
| Protected denial | `/`, `/reports`, or a station route after sign-out | The request must not render product UI or data. A signed-out protected page redirects to `/login`; an unauthenticated context/API request is denied (normally HTTP 401). |

The released station-scoped destination templates are:

```text
/stations/{authorisedStationId}/cash?tenantId={tenantId}&legalEntityId={legalEntityId}
/stations/{authorisedStationId}/settlements?tenantId={tenantId}&legalEntityId={legalEntityId}
/stations/{authorisedStationId}/reconciliations?tenantId={tenantId}&legalEntityId={legalEntityId}
```

`{...}` values are supplied by the authorised staging fixture or live
server response. Do not invent UUIDs, station records, tenant records, or
legal-entity records. The chooser's normal success destination is `/`, not
`/login` and not a station-code URL.

## 2. Four-station regression matrix

Use the already provisioned Owner account and the approved staging data. The
four expected authorised options are:

| Code | Station | Choose result | Refresh result | Switch result |
| --- | --- | --- | --- | --- |
| ARC | Arcturus | `/` loads with Arcturus context; no login redirect | Arcturus remains selected | Can switch away and back |
| BND | Bindura | `/` loads with Bindura context; no login redirect | Bindura remains selected | Can switch away and back |
| GAZ | Gazebo | `/` loads with Gazebo context; no login redirect | Gazebo remains selected | Can switch away and back |
| MRT | Maruta | `/` loads with Maruta context; no login redirect | Maruta remains selected | Can switch away and back |

For each row, PASS requires all of the following:

- The option is visible once, with the expected station name/code and no
  unrelated station.
- Choosing the option produces one successful context-selection response and
  lands at `/`.
- The application shell/workspace is visible and the resolved station label
  matches the selected station.
- No `login` page, generic error page, stack trace, or stale previous-station
  label appears.
- A browser reload keeps the same station.

The critical BND regression is explicit: **Bindura must follow the same
successful `/api/context` → `/` path as ARC, GAZ, and MRT. A redirect to
`/login` is FAIL unless the Owner session had genuinely expired and a fresh
sign-in reproduces a valid session.**

## 3. Exact 12-minute browser checklist

Run on an approved staging URL or release-candidate URL in a clean browser
profile. Keep DevTools Network open with request payload/response bodies
redacted in captured evidence. Do not submit any financial or setup command.

### 0:00–1:00 — Preconditions

1. Confirm the target is non-production and record URL, deployment/commit, CAT
   start time, browser, and operator.
2. Confirm the Owner account is an existing authorised account with MFA already
   enrolled. Obtain the current TOTP code only from the authorised human; do
   not record it.
3. Confirm the station fixture contains exactly Arcturus (ARC), Bindura (BND),
   Gazebo (GAZ), and Maruta (MRT) for the Owner's authorised tenant/legal
   entity. If this is not true, stop and record the fixture mismatch; do not
   add or edit master data.

### 1:00–3:00 — Sign-in and chooser

4. Open `/login`. Sign in through the normal provider flow. Complete the
   existing Owner MFA challenge if the environment requires login MFA.
5. PASS: the browser reaches `/workplace`, and the heading is **Where are you
   working today?**. PASS: all four station options appear; no station is
   hard-coded by the test operator.
6. Select **Arcturus**. In Network, verify the context POST is `POST
   /api/context`, returns success, and is followed by navigation to `/`.
   PASS: the workspace loads with Arcturus context and does not redirect to
   `/login`.

### 3:00–7:00 — Four stations, refresh, and switch

7. Reload the page. PASS: Arcturus remains selected and the workspace remains
   usable.
8. Use the visible **Work context** control → **Switch station** and select
   **Bindura**. PASS: the workspace reloads in Bindura context, the URL/query
   contains only server-returned context IDs where applicable, and no login
   redirect occurs.
9. Reload. PASS: Bindura remains selected. This is the primary reported
   regression check.
10. Repeat the same switch-and-refresh pair for **Gazebo**, then **Maruta**.
    PASS: each selected station is displayed after switch and after refresh.
11. Switch once more to **Arcturus** and confirm the chooser/context control
    does not retain Maruta, Gazebo, or Bindura as stale context.

If the requirement is specifically to exercise the initial chooser row for
each station rather than the authenticated switcher, remove only the
`shanda-fuel-context` cookie in the staging browser's cookie inspector, open
`/workplace`, and repeat steps 5–6 for the remaining rows. Do not clear the
auth/session cookie, and do not alter any server data.

### 7:00–8:30 — Logout and protected-route denial

12. Open the existing account menu and select **Sign out**. PASS: the browser
    lands at `/login` and the session cookie is no longer usable.
13. In the same browser, directly open `/` and then one protected route such
    as `/reports`. PASS: neither renders the product shell or station data;
    each returns to `/login` (or the documented signed-out denial behavior).
14. Optional read-only API check: request `GET /api/context?pathname=/` while
    signed out. PASS: HTTP 401/denial and no authorised context data.

### 8:30–10:00 — Owner privilege and station-role behavior

15. Re-authenticate only if needed for the remaining staging checks. As Owner,
    confirm the navigation projection and settings/account controls are
    consistent with the Owner's live permissions. The Owner may work across
    the four authorised stations because the Owner assignment is tenant-scoped
    in the provisioned fixture, but the role is not a security bypass.
16. If existing station-scoped test accounts are provisioned, repeat the
    chooser and one direct deep-link check for each available role:

    - **Administrator:** only its granted tenant/legal-entity/station scope;
      no assumption of Owner-only authority.
    - **Finance:** only its granted finance/reporting and context scope; no
      Owner/administration controls unless separately granted.
    - **Supervisor:** only the assigned station(s) and operational views.
    - **Attendant:** only the assigned station/shift workspace; no tenant-wide
      management or Owner actions.

    A lower-role chooser must omit stations outside its live grants. A direct
    URL or context POST for an omitted station must be denied. Do not create
    users or change role assignments for this test.

### 10:00–11:00 — Owner-only privileged MFA step-up (staging only)

17. Use an existing Owner-only high-risk screen in staging that presents the
    released **Verify step-up** control, such as the lock-business-day
    step-up panel at `/operations/daily` when the existing fixture exposes it.
    Do not click the final irreversible/business command.
18. Enter an intentionally invalid password or current-code value once. PASS:
    the server returns a generic forbidden/step-up failure; no business state
    changes; no secret is echoed.
19. If the approved test owner authorises the positive check, enter the real
    current password and TOTP once. PASS: the existing `/api/auth/step-up`
    path returns active assurance for the current tenant, the UI says step-up
    is verified, and the final business action remains unsubmitted. Stop
    immediately after verification. Never enrol, reset, or change MFA.

If the staging fixture does not expose a safe separate Verify step-up control,
record **NOT CONFIGURED — Owner step-up UI fixture unavailable** and attach the
existing automated/unit evidence; do not force a production or irreversible
workflow merely to obtain a browser result.

### 11:00–12:00 — Evidence and disposition

20. Capture the final URL and redacted result for each station, refresh, switch,
    logout denial, role denial, and step-up check. Do not capture passwords,
    TOTP codes, session cookies, backup codes, or full response bodies.
21. Mark the run PASS only when all required checks pass, or when a documented
    NOT CONFIGURED item is explicitly accepted by the release owner. Any
    chooser-to-login redirect for an authorised station, cross-tenant data,
    missing protected-route denial, or bypass of Owner-only step-up is FAIL and
    must stop the run.

## 4. Security and negative scenarios

These are staging/non-production tests. They must use existing authorised
fixtures or already provisioned accounts; never weaken permissions or add a
test bypass.

### Unauthorized station in the same tenant

Use a station ID that exists but is not in the test user's live station grant
(a station-scoped Supervisor/Attendant is the preferred account). Directly
open:

```text
/?tenantId={tenantA}&legalEntityId={entityA}&stationId={stationNotGranted}
```

Expected: HTTP 403/404, an access-denied state, or a safe redirect to `/login`
according to the route; never a workspace showing that station. A tampered
`POST /api/context` with the same ungranted station must also be denied and
must not establish a new persisted context.

### Cross-tenant station

Use a real approved Tenant B / Station B fixture and the Owner or lower-role
session that is not a member of Tenant B. Directly test the root and one
station-scoped template:

```text
/?tenantId={tenantB}&legalEntityId={entityB}&stationId={stationB}
/stations/{stationB}/cash?tenantId={tenantB}&legalEntityId={entityB}
```

Expected: denial (HTTP 403/404 or safe login redirect), no Tenant B name,
station data, navigation projection, or context cookie for Tenant B. The
existing production-readonly smoke contract also treats HTTP 200 for a
Tenant-B denial as a mismatch; reuse that evidence when it already covers the
same target instead of repeating production traffic.

### Fail-closed requirements

- A URL, query parameter, cookie, client state, or station code never grants
  access by itself.
- The server must revalidate tenant, legal entity, station, active membership,
  `tenant.context.select`, and `station.view`.
- Do not replace an unauthorized test with an invented station, a modified
  role, a disabled RLS policy, a fixture header, or a production-only bypass.
- A failure is not fixed by hiding a link; the direct route and context API
  must also deny it.

## 5. Existing automation to reuse

Run these in the approved non-production test environment only, using the
repository's existing fixtures. Do not add a duplicate production smoke test
for a check already evidenced by the release owner.

| Existing evidence/test | Reuse for |
| --- | --- |
| `tests/e2e/login-mfa.spec.ts` | Normal sign-in handoff to `/workplace`, MFA challenge behavior, wrong-code rejection, and successful session establishment. |
| `tests/e2e/mobile-station-context.spec.ts` | Context API contract, station switching, URL propagation, mobile/desktop selector behavior, and context links after a switch. Its station IDs and mocked API are test-only; do not mistake it for live authorization evidence. |
| `tests/e2e/auth-entry.spec.ts` | Signed-out protected-route redirect, entry accessibility, and no product-shell flash before authentication. |
| `tests/e2e/account-menu.spec.ts` | Better Auth sign-out control, sign-out failure handling, and landing at `/login`; live staging still needs the human account check above. |
| `src/modules/context/*` tests and `src/design-system/entry/entry-logic.test.ts` | Server-side context validation, persisted-choice planning, route-policy behavior, and prevention of unsafe post-sign-in redirects. |
| `tests/integration/a1-isolation.test.ts`, `tests/integration/security-step-up.test.ts`, and existing authorization tests | Tenant/RLS denial and privileged assurance behavior when the approved PostgreSQL test environment is available. |
| `scripts/production-readonly-smoke.ts` / `docs/runbooks/production-readonly-smoke.md` | Existing health/readiness/one read-only endpoint and optional cross-tenant denial evidence. Do not rerun production unless the deployment owner explicitly schedules it; this procedure is not a replacement for that controlled harness. |

The existing browser tests are primarily database-free or mocked. They prove
the route/UI contract, not that the four live station records or a real Owner
session are provisioned. The live staging acceptance therefore remains
necessary for the reported BND redirect.

## 6. PASS/FAIL record template

```text
SHANDA FUEL — STATION-SELECTION ACCEPTANCE
Disposition: PASS / FAIL / BLOCKED / NOT CONFIGURED
Environment: staging / approved release candidate
Base URL:
Release/deployment ID and commit:
Operator and CAT start/end time:
Browser/profile:
Owner account reference (non-secret):
MFA mode confirmed: login challenge / step-up / other

ROUTE CONTRACT
[ ] /login -> /workplace after normal sign-in
[ ] /workplace shows exactly ARC, BND, GAZ, MRT for this Owner
[ ] POST /api/context accepted only the selected authorised station
[ ] successful selection -> /

STATIONS
ARC Arcturus: choose [ ] workspace [ ] refresh [ ] switch [ ] result:
BND Bindura:  choose [ ] workspace [ ] refresh [ ] switch [ ] result:
GAZ Gazebo:   choose [ ] workspace [ ] refresh [ ] switch [ ] result:
MRT Maruta:   choose [ ] workspace [ ] refresh [ ] switch [ ] result:

SESSION
[ ] logout -> /login
[ ] direct / denial after logout
[ ] direct /reports denial after logout
[ ] optional GET /api/context denial after logout

PRIVILEGE / SECURITY
[ ] Owner navigation/workspace matches live permissions
[ ] station-role account(s) restricted to provisioned station scope
[ ] unauthorized same-tenant station denied
[ ] cross-tenant station denied with no data disclosure
[ ] wrong Owner step-up factor denied with no business change
[ ] positive Owner step-up verified in staging only; final command not submitted

AUTOMATION REUSED
Tests/commands and result:
Existing production evidence reused (if any):

FAILURE / EVIDENCE
Failed check, exact URL, timestamp, request ID if available:
Redacted screenshot/log link:
No secrets/cookies/TOTP codes recorded: YES / NO

REMAINING INPUTS
Existing account permissions needed:
Authorized human actions needed:
Tenant B / ungranted station fixture available: YES / NO
Safe step-up fixture available: YES / NO
Onboarding data still required (not a code blocker):
Release-owner disposition and next owner:
```

## 7. Required human inputs and current disposition

The procedure is **READY**, but execution needs an existing authorised human
and approved non-production fixtures:

- Owner credentials and current MFA/TOTP interaction; the operator must not
  record these secrets.
- The exact server-returned UUIDs for Tenant, legal entity, and each station;
  these are read from the approved staging response/fixture, never guessed.
- At least one station-scoped role account for lower-role restriction checks,
  if those roles have already been provisioned.
- A Tenant B or same-tenant ungranted station fixture for negative testing,
  if available. If no second tenant exists, record that negative case as
  **NOT CONFIGURED — no second tenant fixture**, not as a security pass.
- A safe Owner-only staging screen that exposes the existing step-up form. MFA
  enrolment, reset, secret rotation, staff creation/deactivation, and all
  business/configuration commands remain out of scope.

Missing client master data or a missing optional negative fixture is not a
development blocker. It is an explicit acceptance input and must not be
manufactured to make the checklist pass.
