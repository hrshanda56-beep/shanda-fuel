# Owner demo — DEMO ONLY, independent preparation

This package is for a disposable local PostgreSQL 18 cluster only. It is not
production/staging data, release acceptance, or evidence for the integrated
operational candidate. Base: `99bbe34cd9e978288f4ffb55fcad9f144e127922`
(`origin/main` at preparation; local `main` was older). No workflow, financial,
authentication, authorization, MFA, RLS, or migration implementation is changed.

## Start and reset

Prerequisites: Node 24–26, pnpm 11.25.0, PostgreSQL **18** binaries. No Docker,
provider account, paid service, production secret or existing cluster is needed.
From the isolated checkout:

```sh
pnpm install --frozen-lockfile --offline
node scripts/demo/owner-demo.mjs setup
node scripts/demo/owner-demo.mjs check
node scripts/demo/owner-demo.mjs dev
```

If the dependency store is not populated, use the ordinary locked install
without `--offline`. PostgreSQL binaries default to
`/opt/homebrew/opt/postgresql@18/bin`; set `DEMO_PG_BIN` to another PG18 bin
directory if needed. The runner rejects other major versions.
Open <http://127.0.0.1:3215/login>. Ctrl-C stops the app. Then:

```sh
# Stop the app FIRST. Reset refuses to force-disconnect live database clients.
node scripts/demo/owner-demo.mjs reset
node scripts/demo/owner-demo.mjs check
# Restart app, then rehearse from the initial fixture again.
node scripts/demo/owner-demo.mjs dev
# Stop the app first, then stop only this private cluster:
node scripts/demo/owner-demo.mjs stop
```

`setup` is idempotent: it does not rewind an already seeded demo, refresh its
business date, or overwrite activity/MFA enrollment. `reset` drops and recreates
ONLY `shanda_owner_demo` on the marked private cluster, reapplies the unchanged
canonical migration journal and recreates the synthetic fixture. All local demo
sessions, MFA enrollment and activity are lost on reset. Re-enroll MFA through
the normal UI before any privileged-action rehearsal. Do not reuse this reset
procedure for any other database. `status` prints the synthetic ID manifest.

The cluster lives at `/private/tmp/shanda-owner-demo-<uid>/data`, with a private
0700 socket directory alongside it, port number 55479 for the Unix socket and
**no TCP listener**. The owner is the current OS user. No database URL argument
or inherited database configuration can redirect the runner. It checks the
server data directory/version, local directory ownership/mode, PG_VERSION and
marker before use. A reset additionally requires the demo database comment.
Do not manually remove an unknown/partially initialized directory to get past
a refusal; inspect it first. The harness uses a local PostgreSQL `postgres`
bootstrap connection; migrations run under `SET ROLE migration_owner`, with local database CREATE/CONNECT prerequisites. The application uses restricted `app_runtime`. The fixture check verifies the ownership-sensitive A3 meter-exception function owner.

## Environment and credentials

The launcher supplies process-local configuration; no `.env` file is created.
It rejects `.env`, `.env.local`, `.env.development` and
`.env.development.local` so that external configuration cannot leak into the
demo. It does not inherit service credentials, PG variables or NODE_OPTIONS.

| Variable | Demo setting/source |
| --- | --- |
| `APP_ENV` | `local` (never test navigation fixtures) |
| `APP_URL` | `http://127.0.0.1:3215` |
| `AUTH_PROVIDER` | `BETTER_AUTH` |
| `DATABASE_URL` | `postgresql:///shanda_owner_demo` (driver resolves controlled socket below) |
| `PGHOST`, `PGPORT`, `PGUSER` | Launcher-controlled private socket, `55479`, `app_runtime`; inherited values discarded |
| `DATABASE_DIRECT_URL` | Not passed to the web application |
| `REQUIRE_LOGIN_MFA` | `true`, unchanged secure policy |
| `REQUIRE_PRIVILEGED_STEP_UP` | `true`, unchanged invariant |
| `BETTER_AUTH_SECRET` | Public synthetic local-only signing value in launcher |
| `AUDIT_SIGNING_KEY_ID`, `AUDIT_SIGNING_KEY` | Public synthetic local-only values in launcher |
| R2, Resend, Clerk, cron | Absent; those integrations are outside this demo |

All five emails are `<actor>@owner-demo.example.test` where actor is `owner`,
`supervisor`, `attendant1`, `attendant2`, `attendant3`. All have the deliberately
public, synthetic password `DEMO-ONLY-Local-Fuel-2026!`. Never use it elsewhere.
There are no seeded sessions, TOTP secrets, backup codes or step-up grants.
Enroll actors through the existing Security UI when required; never insert a
session or bypass MFA to make a demonstration work. Do not capture MFA setup,
QR codes, session cookies, backup codes or password fields in screenshots.

## Fixture and exact integration inputs

All IDs use prefix `d0000000-0000-4000-8000-` plus the 12-digit zero-padded
suffix below. `node scripts/demo/owner-demo.mjs status` prints full IDs.

| Object | ID suffix / value |
| --- | --- |
| Tenant / legal entity / station | `1` / `2` / `3` |
| Station | DEMO-01, DEMO ONLY — Acacia Station, Africa/Harare |
| Owner user / membership | `101` / `201`; canonical OWNER, TENANT scope |
| Supervisor user / membership | `102` / `202`; canonical SUPERVISOR, station scope |
| Attendants user / membership | `103`–`105` / `203`–`205`; ATTENDANT, station scope |
| Diesel / Petrol product | `401` / `402` |
| Diesel / Petrol tank | `411` / `412`; capacity 20000.000 L each; synthetic opening stock 5000.000 L each valued at USD 7750.0000 / 8000.0000 |
| Diesel / Petrol active price | `421` / `422`; USD 1.550000 / 1.600000 |
| Pumps / nozzles / meters / installations | `501`–`503` / `511`–`513` / `521`–`523` / `531`–`533` |
| Shift template / business day / open shift | `701` / `702` / `703` |
| Opening boundaries | `711`–`713`; 10000.000 / 20000.000 / 30000.000 L |
| Till / safe | `801` / `802`; initial balances have no custody evidence |

The fixture date is the station-local date at first seed. The template is
06:00–14:00 station time. Reset on the presentation day. Pumps 1 and 3 are
Diesel; pump 2 is Petrol. Each opening reading belongs to its matching
attendant. The fixture includes clearly labelled synthetic opening stock and
matching opening cost evidence so the normal inventory valuation guard can
authorize canonical sale posting during approval. No deliveries, posted sale,
reconciliation, payment declaration, settlement, bank account or approved close
is fabricated. Opening readings, opening stock and active prices are labeled
fixture setup, not a demonstrated approval history.

Existing A5 payment methods include CASH, POS, ECOCASH and BANK_TRANSFER; these
are contract enums, not new database-configurable methods. The A3 reconciliation
uses canonical declarations JSON (ADR-005), with CASH/ELECTRONIC categories.
The integration agent must use its verified UI/API contract for declaration
entry; do not insert a parallel payment-method/declaration table.

Suggested exact-string inputs for the main agent's normal workflow rehearsal:

| Pump / attendant | Opening | Closing | Litres | Price | Sales |
| --- | --- | --- | --- | --- | --- |
| 1 / attendant1 | 10000.000 | 10100.000 | 100.000 | 1.550000 | 155.0000 |
| 2 / attendant2 | 20000.000 | 20080.000 | 80.000 | 1.600000 | 128.0000 |
| 3 / attendant3 | 30000.000 | 30050.000 | 50.000 | 1.550000 | 77.5000 |

Expected sales are **360.5000 USD**. Proposed payment evidence is CASH 200.0000,
POS 100.0000, ECOCASH 60.5000 (electronic total 160.5000). This is rehearsal input,
not preseeded revenue. For a clearly labeled discrepancy rehearsal use CASH
195.0000: accounted total 355.5000, shortfall 5.0000. Confirm the candidate's
variance sign/labels from its actual calculation; do not alter them. Do not
manufacture expense, account-sale or approved-fuel evidence to balance a shift.
Do not equate declared cash with deposited/banked cash.

Main integration agent needs this commit/files, exact candidate SHA, the five
actor accounts/scopes, manifest, station date/timezone, meter/price IDs and inputs,
and the app URL. It must independently verify its changed shift flow, required
stock evidence, operator-vs-Supervisor separation, read/command permissions,
reconciliation entry, MFA enrollment/step-up, approval, Reports and Cash before
calling the integrated demo ready. Cherry-pick only this demo tooling/docs;
never copy `.next`, node_modules, cluster data or another agent's worktree.
Do not share this running cluster across concurrent integration rehearsals.

## 18-minute Owner walkthrough

1. **0–2 min — Owner sign-in.** Show the DEMO ONLY label and synthetic email.
   Complete normal MFA if enrolled. Select Fictional Fuel → Fictional Energy →
   DEMO-01. Explain the station timezone. Do not expose enrollment secrets.
2. **2–4 min — Dashboard.** Explain the operational overview and available
   evidence. Empty/unavailable figures remain truthful until activity exists.
   Do not describe seeded reference data as live production performance.
3. **4–7 min — Daily Operations / Supervisor.** Use a separate browser profile
   for Supervisor. Show the open day/shift and the three station-eligible attendants. Assign attendants in the normal reconciliation draft flow; the initial shift board shows zero assigned attendants.
   This fixture starts open; demonstrate opening a new shift only on a reset
   or a separately verified path, not by editing state in SQL.
4. **7–10 min — Meter readings and payment declaration.** Follow the integrated
   agent's verified input flow using the table above. Explain litres × active
   price and preserve exact decimal strings. Submit through ordinary commands.
5. **10–13 min — Reconciliation and variance.** Show source readings and expected
   360.5000 versus declared payments. If rehearsed, show the 5.0000 shortfall and
   the normal investigate/return/correct path. Keep recorder and reviewer distinct.
6. **13–16 min — Secure approval, conditional.** Only execute if the main agent
   has verified the exact candidate's separate Supervisor approval and normal
   MFA step-up. Otherwise show the review page and explicitly state approval is
   pending verification. Never bypass a challenge or force an approved state.
7. **16–18 min — Reports and Cash.** Show date/station filters and what evidence
   is available. Distinguish recorded/declared cash from custody/deposits and
   operational totals from profit. Explain any truthful empty/unavailable state.
   Finish with logout. The local demo URL is not a production owner handoff URL.

## Visual preparation

Use screenshots at **375×812**, **768×1024**, **1440×1000**. Best pages: login
(branding and form), dashboard after context selection (summary and shell),
Daily Operations with station/date selected (shift and readings), reconciliation
review only after a real candidate submission (source evidence, payments,
variance), Reports (filters/read results), Cash (custody evidence or truthful
empty state). At 375px verify navigation/account controls and no horizontal
scroll; at 768px inspect tables and context controls; at 1440px capture overview.

Any captures must say **independent 99bbe34 + demo fixture**, not final integrated
candidate. Do not use request mocks, test navigation headers, dev-preview pages
or fabricated numbers to fill screenshot panels. No secure-approval screenshot
is evidence until the main integration agent verifies it on the exact candidate.


## Context URLs for the independent baseline

The shell can display a selected station while a page still requires explicit
route context. Use the selector in a normal walkthrough; the exact reproducible
fixture links below are also useful to the integration agent. Changing IDs does
not bypass server authorization.

```text
Dashboard: http://127.0.0.1:3215/
Daily control room: http://127.0.0.1:3215/operations/daily?tenantId=d0000000-0000-4000-8000-000000000001&stationId=d0000000-0000-4000-8000-000000000003&businessDayId=d0000000-0000-4000-8000-000000000702
Daily workspace: http://127.0.0.1:3215/operations/daily?tenantId=d0000000-0000-4000-8000-000000000001&stationId=d0000000-0000-4000-8000-000000000003&businessDayId=d0000000-0000-4000-8000-000000000702&shiftId=d0000000-0000-4000-8000-000000000703
Reports: http://127.0.0.1:3215/reports?tenantId=d0000000-0000-4000-8000-000000000001
Cash: http://127.0.0.1:3215/stations/d0000000-0000-4000-8000-000000000003/cash
```


## Verification and remaining gates

Verified on the independent baseline with PostgreSQL 18.6:

- Fresh setup, repeat setup with unchanged manifest/counts, and guarded reset
  with canonical migrations under `migration_owner` passed.
- Reset refused an active app connection with PostgreSQL `55006`; no forced
  session termination is implemented.
- Fixture integrity check passed: five credential hashes/role scopes, one
  station, two products/tanks/prices, three pumps/meters/opening readings,
  restricted runtime attributes, ownership-sensitive A3 function owner, and
  all 73 app tables retaining RLS plus FORCE RLS.
- All five synthetic accounts returned 200 from normal password sign-in.
  Owner sign-in reached the authenticated
  dashboard. No session was injected. New accounts are not MFA-enrolled;
  enrollment and secure approval remain normal UI prerequisites, not seeded proof.
- Dashboard, Daily control room, initial Daily workspace, Reports with tenant
  context and Cash returned 200. At 375, 768 and 1440px the captured states had
  no document-level horizontal overflow. These are development-server captures,
  not production-build or integrated-candidate acceptance screenshots.
- Production build passed with the explicit local provider configuration below.
- Repository unit suite: 840 tests / 111 files passed. Repository lint and
  typecheck passed; scoped Prettier and `git diff --check` passed.
- Independent code review GREEN after the migration-owner correction; reviewer
  inspected actual files and dependency socket behavior, but could not separately
  execute database/browser checks due sandbox socket restrictions.

Screenshots and JSON manifests are local, outside Git, at
`/private/tmp/shanda-owner-demo-captures-20261015`. Prefer `independent-dashboard-*`,
`independent-daily-control-*`, `independent-daily-workspace-*`,
`independent-reports-context-*`, and `independent-cash-*`. The shorter
`independent-daily-*` and `independent-reports-*` names show context-required
states, not filled workspaces. Login captures contain blank credential fields.
Development tooling indicators may appear in these captures.

The initial workspace intentionally offers **Create Daily Draft**. The shift
board initially shows **0 attendants** because its count comes from
`reconciliation_attendants`, not station role assignments or meter boundaries.
Assign all three through the ordinary draft workflow during the integration
rehearsal. No reconciliation, submission, payment evidence, secure approval,
posted report, custody transfer or bank deposit has been preseeded or claimed
verified. The main agent must validate those actions on its exact integrated SHA.
No production/staging contact, push, merge or deployment was performed.


For a production build of this independent checkout, supply the same explicit
local provider configuration (no database or external-service credentials are
needed for the build). A bare `pnpm build` without `AUTH_PROVIDER` fails closed
during prerendering; that is an environment prerequisite, not a demo source fix.

```sh
APP_ENV=local APP_URL=http://127.0.0.1:3215 AUTH_PROVIDER=BETTER_AUTH BETTER_AUTH_SECRET=DEMO-ONLY-public-local-signing-key-2026 AUDIT_SIGNING_KEY_ID=DEMO-ONLY AUDIT_SIGNING_KEY=DEMO-ONLY-public-local-audit-key-2026 REQUIRE_LOGIN_MFA=true REQUIRE_PRIVILEGED_STEP_UP=true pnpm build
```
