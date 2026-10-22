# Shanda Fuel — Current Status

## v1 delivery baseline — 2026-10-21

Integration branch: `codex/clerk-only-auth-20261017` (contains all of `origin/main`,
55 commits ahead, clean at start). Scope and decisions are in DEC-044. Production
was not contacted. Nothing was committed, pushed, merged or deployed.

Verified locally on a disposable PostgreSQL 18.6 cluster (UTC, roles from
`scripts/db/bootstrap-test.sh`, migrations 0000–0040, migration-owner metadata
step applied), with `DATABASE_URL` pinned away from Neon:

| Gate | Result |
| --- | --- |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | PASS |
| `pnpm db:check` | PASS |
| `pnpm test:unit` | PASS: 170 files, 1,193 tests |
| `pnpm build` | PASS |
| `pnpm test:integration` | PASS: 222 passed, 40 intentionally skipped (first-user provisioning, role-specific read-performance and navigation-snapshot suites are opt-in); needed three fixes below |
| `pnpm test:e2e` | NOT GREEN: 259 passed, 77 failed, 21 did not run, 4 skipped. A rerun of the failures gave the same result, so it is not caused by the machine sleeping. |

Baseline defects found and fixed in this pass (all pre-existing on the branch):

- `a6-expenses` test read an `id` it never selected; the recurring-cost adjustment
  then failed with 404 because adjusting a recognition that had already been
  reversed was not allowed. `adjustRecurringCostRecognition` now corrects from the
  latest recognition for the date: an active one is reversed and replaced, a
  reversed one is only replaced. The later summary assertion now expects 73.3343.
- `profitability-api` seeded the second tenant's sale against the first tenant's
  product, so the product-grouped report correctly hid it. The fixture now gives
  the second tenant its own product.

### v1 build progress (2026-10-21, uncommitted on the branch)

Done and tested (unit 1,310 and integration 259 passing, 40 intentional opt-in skips; 15 browser checks on the new screens; lint,
format, `db:check`, typecheck green):

- Guided "Station setup" screen (Settings): fuel types, prices, tanks, pumps and nozzles, shifts,
  supervisor in charge; plain language, no codes shown. Browser tests run on sample API answers.
- Station responsible supervisor (migration 0041, `Setup.SetResponsibleSupervisor`).
- Credit and prepaid sales name the customer and are checked against the credit limit or prepaid
  balance when entered; approved fuel names its beneficiary (migration 0042). Approved fuel is shown
  as a benefit cost in the Profit statement.
- Cash handover between people (migration 0043): `SubmitCashHandover`, `AcceptCashHandover`,
  `ResolveCashHandover`, `CancelCashHandover`. The receiver must be a different person from the
  sender; a count that differs from the expected amount needs a reason and goes to review; accepted
  or settled handovers post a cash movement between the two locations. "Handing over cash" card on
  the station cash screen. Role permissions were already in place (attendant and supervisor submit;
  admin and owner accept and resolve).
- Tank calibration (migration 0044): `SetTankCalibration` stores a versioned dipstick chart
  (insert-only, older dips keep their litres); `RecordTankDip` accepts a dipstick reading and works
  the litres out by exact straight-line interpolation between chart rows, refusing readings outside
  the chart. Tank cards show a green, yellow or red stock-versus-book signal from each tank's
  acceptable difference.
- Landed cost build-up: `RecordReceiptCost` accepts fuel cost plus freight plus other direct costs
  and spreads the total over the litres that actually arrived; each tank gets its share.
- Supplier credit limits (migration 0045): `SetSupplierCreditLimit`, used/near (80%)/over status in
  the supplier summary, a credit-limit card on the supplier page and Action Center alerts. A limit
  warns; it never blocks a purchase.
- Supplier due-today, due-soon and 1-7/8-14/15-30/30+ day ageing in the summary data.
- Operations alerts in the Action Center: late reports, cash shortages, dip-versus-book stock with
  tolerance colours, low stock, overdue card/mobile settlement, supplier due dates and credit
  limits. Thresholds are defaults in code (7-day due soon, 3-day settlement lag, 1-day report
  grace) until the client chooses.
- Expenses screen now has "Regular costs" (add a monthly cost, add each month, count it in
  spending) and "Approval limits" (extra identity check and second-approver thresholds), on top of
  the commands that already existed.

- Activity log (Settings, organisation-level audit permission only): the signed audit log in plain
  words with who, when and the before/after values; secret-looking fields are never shown; paged
  and filterable by area. Station-level administrators and supervisors are refused.
- Reminder settings (migration 0046, `Setup.SetAlertSettings`, Settings > Reminders): when supplier
  invoices count as due soon, how late a card payment or daily report must be, and the smallest
  cash shortage worth flagging. Organisation-wide (needs organisation-level `tenant.manage`);
  defaults apply until saved; the Action Center and the supplier due-soon window read them.
- Offline drafts, stage 1: the daily operations screen keeps a copy of unsent entries on the device
  (24 hours, tied to the saved record version, cleared once the server save succeeds) and offers
  them back after a crash. The copy is kept per person (membership), station and shift. Not
  browser-tested; the storage rules are unit-tested.
- Offline drafts, stage 2 (narrow): if a daily-report save fails because there is no connection, the
  exact commands, idempotency keys and running record version are queued on the device
  (`src/platform/drafts/outbox.ts`, per person, 7 days, 20 entries) and sent again when the browser
  comes back online or on "Send now". A refused old version shows as a conflict for a person to
  resolve; nothing is overwritten and conflicts are never retried. Other screens (cash counts,
  handovers) are not queued yet. Queue rules are unit-tested; the offline-to-online flow has not
  been run in a browser.

- Documents (migration 0047): `app.documents`, append-only private files (photo, PDF, DOCX; 10 MB)
  attached to a fuel delivery, bank deposit, cash handover, daily report or expense at one station.
  Validated by the same checks as expense receipts, stored under a random private key, opened only
  through a short-lived link after the viewer's station access is checked, uploads audited. Reusable
  `DocumentAttachments` component, shown on new delivery drafts, bank deposit details and the daily report review step. Tested
  against the real database with a fake storage port; real R2 is not exercised locally.
- Net current position report (Reports > Financial Statements; CSV, PDF and XLSX): cash not yet
  banked + card/mobile payments not yet received + owed by credit customers, less owed to suppliers
  and prepaid customer balances. Shown as unavailable (never zero) for a single station, because
  customer balances are organisation-wide. Stock at cost and unpaid expenses are not included.
- Alert email, prepared but not enabled: digest wording and send rules plus the per-person run are
  built and unit-tested without any database change; the cross-organisation recipient list and
  scheduled trigger are written up in ADR-020 for security review.
- Browser checks (Playwright, sample API answers, no Clerk user needed) for the cash handover card,
  activity log, document attachments and reminder settings, including accessibility and overflow
  checks at 320, 390, 768 and 1280 px. These caught one real mistake (a function passed from a
  server page to a client component) before it reached a signed-in page.

Found already built while checking (not new work): CSV, PDF and XLSX report downloads with step-up,
and the report activity log. They have not been re-verified in a browser in this pass.

Not yet built: enabling alert email (needs ADR-020 approved), dashboard tiles (left alone: the
owner-approved dashboard already has a needs-attention area), offline queue for screens other than the
daily report, employee profiles polish, documents on supplier payments (they have no station, so
need a design choice) and handovers, a Clerk-backed run of the signed-in browser suite.

Open items for the owner: alert thresholds and default tank tolerance are placeholders; email
delivery needs a security design (a scheduled job must read across organisations); the browser
suite needs real Clerk development users.

E2E classification (harness/environment, not product regressions): the
authenticated specs need real users in a dedicated Clerk development instance
(`E2E_CLERK_USERS`), and several specs (for example `smoke`) still expect the old
unauthenticated "Demo user" shell that Clerk-only authentication removed. The
browser suite cannot be called green until those users exist and stale specs are
updated.

### Reports expansion (2026-10-22, committed on the integration branch)

Ten plain-table reports were added next to the original eight, through one shared layer
(`src/modules/reporting/table-reports/`): Tank Dip History, Stock Movement History, Delivery
Variance, Expenses by Category, Supplier Statement, Customer Statement, Cash Custody & Handovers,
Bank Deposits and Daily Reconciliation. Each uses the same tenant/station authorisation as the
management report and downloads as CSV, Excel or PDF through the existing step-up and audit path.
Statements carry exact running balances computed in SQL. Customer balances have no station
dimension (ADR-017), so a station-filtered customer statement shows an explanation, not figures.
Cash reports use the station's timezone for dates (the older banked-cash figure in the management
report still uses the UTC calendar date). Covered by `a10-management-reporting` (22 tests).

Not built, waiting for an owner rule: **sales by attendant** (how a shift's sales are split when
several attendants share it) and **customer ageing** (how payments are applied to older charges).
Supplier ageing already exists in the supplier summary.

## Finance backend completion candidate — 2026-10-19

The requested finance backend work is being implemented on branch
`codex/clerk-only-auth-20261017` in the clerk-only-auth worktree. The candidate
uses the existing expense recognition ledger for authoritative management
expense reporting, adds exact-decimal fuel-profit grouping with REV1/A12
lineage, extends browser exports to CSV/PDF/XLSX, adds immutable private expense
attachments (image/PDF/DOCX, multiple files, 10 MB per file, private R2 keys,
tenant/station authorization and audit evidence), and adds realistic recurring
expense demo scenarios plus append-only recurring recognition adjustments.

Till-to-expense payment, finance-wide period locking, tax treatment, role or
permission redesign, UI redesign, staging, and production deployment are not
part of this candidate. The 0039 attachment and 0040 recurring-adjustment
migrations are prepared but have not been applied. Database integration tests cannot run in this environment because
`DATABASE_URL` is unset, and R2 runtime credentials are not configured. Unit,
type, lint, schema, and generated-document checks are being run locally; this
candidate is not a production-release declaration.

## Finance read-path optimization candidate — 2026-10-18

Finance overview starts independent sign-off, cash, settlement and supplier
sections concurrently, reuses the shared shell's verified context tree and
streams its work list behind a truthful loading state. Partial restricted/error
states remain per section. Sign-off uses one SQL exchange for queues and existing
alternate-approver checks, preserving tenant-bound strong-authentication rules.
Cash summary batches five data reads into one permission-gated query. Customer
account summary batches account, product, station and recent-history sections
into one query and keeps monetary values as text. Finance read loaders use the
existing persisted authority snapshot rather than command-context station/entity
discovery transactions. Command loaders, schema, RLS and write behavior are
unchanged. The settlement workspace now requests /api/settlements/overview once;
the old summary and unmatched endpoints remain available with their array contracts.

Final checks: 954 unit tests, 8 focused runtime-role integration checks, and
23 synthetic browser checks passed. TypeScript, focused ESLint and the production
build passed. Browser checks used the installed Brave Chromium binary through a
temporary Playwright config because the bundled browser was absent.

Eight focused synthetic local integration checks passed with actual app_runtime
connections, including exact four-decimal Customer limits, context mismatch and
cross-tenant denial. The repeatable opt-in suite is:
`RUN_FINANCE_READ_TESTS=1 CONSOLIDATED_CONTEXT_READS=1 DATABASE_PREPARED_STATEMENTS=1 pnpm exec vitest run --config vitest.finance-read.config.ts`
It requires explicit local DATABASE_URL for fixture setup and a separate local
FINANCE_RUNTIME_DATABASE_URL using app_runtime. No Neon or production database
was contacted. Existing broad command suites also exposed owner/runtime harness
and write-ACL prerequisites; those attempts are not a passing command-suite gate
and no privileges or command code were changed to compensate. The focused read
suite avoids those command-fixture dependencies. Normal authenticated application
latency remains to be measured after restarting the rebuilt local server.

## Dashboard API read consolidation — 2026-10-18

The effective driver fix now adapts the exact unsafe(query, parameters) calls
used by Drizzle: Postgres.js otherwise defaults those calls to prepare=false,
even when the client enables preparation. A non-mutating adapter supplies the
per-query option on root and transaction/savepoint clients. SQL and parameters
are passed unchanged, and all BEGIN/context/COMMIT behavior remains unchanged.
Combining BEGIN with context establishment was rejected by automatic approval
review and was not applied. Identity mapping and navigation authority for GETs
are now one parameterized SELECT using the existing identity and RLS functions;
the verified actor carries that persisted snapshot to existing binding decoders.
Mutation authentication retains its original independent discovery behavior.
Six rolled-back local runtime/RLS integration tests passed, including the actual
Drizzle query path, cross-actor reuse, unprovisioned identity denial and a catalog
assertion that a named prepared plan exists. Neon warm/cold latency remains to
be verified through normal authenticated application requests.

Further local evaluation adds DATABASE_PREPARED_STATEMENTS=1 as an explicit
opt-in; the default runtime behavior remains prepare=false. This avoids the
installed Postgres.js driver repeating parameter-description exchanges on warm
prepared queries. Only the ignored local worktree environment enables it.
Five local synthetic snapshot/RLS isolation tests passed with prepare=true.
Operations now also batches shifts and permission-gated reconciliation data.
For the instrumented API routes, profileSql=1 explicitly repeats selected data
reads using EXPLAIN ANALYZE in the same RLS transaction and logs only durations.
This diagnostic is ignored outside APP_ENV=local. Diagnostic request totals are
not comparable to ordinary page totals because EXPLAIN executes reads again.
Authenticated Neon timing and pooler compatibility evaluation remains pending.

Operations overview and inventory read-context callers now reuse the existing
RLS navigation snapshot for fresh membership/permission authority when
CONSOLIDATED_CONTEXT_READS=1. Active station scope is established in the first
data transaction context exchange; inactive/historical stations retain the
original RLS station lookup. Operations station metadata and recent business
days are returned in one SQL exchange. Command authorization paths are unchanged.
Obsolete control-room effect requests are aborted; duplicate-request elimination
has not been verified in a browser. Local-only stage timings remain temporarily
enabled for evaluation, including separate Clerk-header and identity-mapping
stages. No new migration or production operation is part of this change.
Post-change authenticated latency measurements are still pending.

## Dashboard context reuse and consolidation candidate — 2026-10-18

The authenticated shared shell now passes its verified discovery snapshot to a
navigation-scoped client provider. The header, Customers list/detail, Suppliers
list/detail, Cash, Settlements, dashboard fallback and report station filters
consume it through the same route-selection validator as the server. No global
identity/permission cache is introduced; data endpoints still authorize every
request. Snapshot changes refresh consumer effects, and selector retry explicitly
requests fresh discovery. Live development Customers navigation issued no
/api/context requests; its server and data requests remain multi-second, so no
instant-navigation or database speedup claim is made.

Migration 0034 adds a SECURITY INVOKER navigation snapshot function, with fixed
search path, transaction-local context restoration, PUBLIC execution revoked and
existing RLS retained. It was applied through the canonical migration runner as
migration_owner to the explicitly confirmed Neon development endpoint
(ep-weathered-tooth-b200pl69, shanda_fuel, eu-central-1). The local worktree now
enables CONSOLIDATED_CONTEXT_READS=1. Identity mapping remains a separate existing
read; memberships, permissions and organisation/station rows share one snapshot
call. Application permission filtering and per-endpoint authorization remain.

The first Neon fixture run timed out; after timeout correction it exposed that
migration_owner cannot SET ROLE app_runtime. No Neon role grants were changed.
Automatic approval review blocked migration until the security gate passed.
With explicit user approval, an isolated PostgreSQL 18 cluster was created on
127.0.0.1:55438 with synthetic data and canonical migrations. All five snapshot
integration tests passed under app_runtime/FORCE RLS, including tenant/actor
isolation, expiry/revocation, caller-setting restoration and failure rollback.
The approved Neon migration then succeeded; its function is not SECURITY DEFINER
and app_runtime EXECUTE was verified. Runtime read probes succeeded.

895 unit tests, TypeScript and targeted ESLint passed before migration. Final
post-migration checks are recorded in the task report. Browser remeasurement was
blocked because local browser use was disabled in Work settings. No production
contact, commit, push, merge or deployment. No instant-navigation claim is made.

# Workplace all-stations default — 2026-10-18

Multi-station sign-in now offers All stations alongside individual stations.
The picker appears on each sign-in when more than one station is available,
including when a prior station context is remembered. A 10-second countdown
selects all stations for the remembered authorised organisation, or the first
authorised organisation when none is remembered. The existing `/api/context`
validation and reporting dashboard aggregation path remain in use; no auth,
permission, RLS, schema, or database behavior changed. Focused entry tests,
targeted ESLint, and TypeScript checking passed. Next route type generation could
not write `next-env.d.ts` in the managed worktree due filesystem permissions.
No production access, migration, merge, push, or deployment.

## Navigation redirect classification — 2026-10-18

Reproduced Daily Operations bouncing through login/workplace to Today in the
authenticated development browser. The shared shell no longer labels every
context/database/permission error as signed-out: only UNAUTHENTICATED redirects;
other failures are observed and thrown to the error boundary, without rendering
protected content. Clerk verification replaces the shell's unsuffixed-cookie
shortcut. Sidebar links use the server-verified remembered context when the URL
has no explicit scope; explicit URL selections never merge with old scope IDs.

Validated 880 unit tests, typecheck and targeted ESLint. In the live authenticated
browser, Bindura Daily Operations rendered its business day, shift board and
history and remained on its route. Other destinations share the corrected gate
but have not all been individually browser-verified. Database latency remains a
separate issue; no permission/RLS relaxation, migration or production change.

## Focused inventory valuation reads — 2026-10-18

The valuation page no longer starts a separate full management report for tank
cards. Its existing no-store valuation endpoint supplies tanks, cost streams and
revaluation history in one SQL statement. Tank data is restricted to the selected
station, uses station-local day boundaries, and excludes financial report sections
and movement/delivery identifier arrays. Exact numeric values are cast to text
before JSON aggregation. Tank cards consume this shared response; switching
stations remounts the workspace so prior-station data cannot remain visible.

The station lookup and authorized inventory snapshot share a tenant transaction;
legal-entity/station settings are applied after permission verification. This
reduces that portion from nine database exchanges to six (including transaction
boundaries), excluding identity/membership work, and eliminates the management
report request entirely. Commands, RLS, authentication and permissions are not
weakened. Context discovery and first connection latency still remain; no final
live page speedup is claimed.

Validation: 878 unit tests and eight valuation PostgreSQL integration tests pass,
including station isolation, persisted lineage and string-valued tank quantities.
Typecheck and targeted ESLint pass. Tests used a fresh isolated local database;
initial reruns against an older test database encountered retained fixture keys.
No migration or production change. Live authenticated browser timing remains to
be remeasured.

## Shared navigation read deduplication — 2026-10-18

All sidebar destinations share request/render-local reuse of verified identity
mapping and tenant membership reads. GET handlers receive isolated asynchronous
read stores; server renders use React request-local cache. No cross-request
authorization cache or command cache is introduced. Shell/context discovery also
reuses identical render inputs. Daily Operations obtains database time with its
station read and reuses a business day already loaded; daily reports authorize
and read within one scoped transaction instead of two. Permission checks and
tenant RLS remain enforced.

Validation: 878 unit tests passed; fresh PostgreSQL migration/integration run
passed 148 tests with 23 provisioning skips. Typecheck and targeted lint passed.
An explicitly opted-in read-only Neon development benchmark confirmed two
identical membership reads use 4 statements with reuse versus 8 without it.
This is a shared-read query budget, not a measured end-to-end navigation speedup.
Live authenticated timings across every sidebar destination remain unverified.
No production changes, database policy changes, merge or deployment.

Follow-up browser validation: all 10 account-menu/tablet-navigation fixture
checks passed, including keyboard/focus, mobile sizing and accessibility. The
first tablet run exposed the Next development badge covering the sidebar
control; it now renders bottom-right. These fixture tests do not establish
authenticated database latency or every destination's full data flow.

## Authentication/membership round-trip reduction — 2026-10-18

Clerk identity mapping now calls the existing explicit-argument SECURITY DEFINER
resolver as a single read, removing BEGIN/context-setting/COMMIT overhead. The
reviewed resolver does not consume those connection settings and its owner-only
RLS policy is unchanged. After verified membership and tenant context setup,
role assignments and temporary grants load via one UNION ALL query rather than
two sequential queries; expiry/revocation predicates and native timestamp types
are retained. Twenty focused tests, ten PostgreSQL isolation integration tests,
typecheck and targeted lint passed. No migration, policy/permission relaxation,
production access or deployment. Live station-switch timing remains unmeasured.

## Station-switch validation narrowing — 2026-10-18

The default context-switch validator now resolves membership for the requested
organisation directly and reads only the selected station/legal entity where
specified, rather than discovering every active company membership first.
It still filters rows through live permissions under tenant RLS and validates
the selection against route policy. The dependency-injected discovery path is
retained for existing tests. Spinner text now explains that access is being
checked before switching. Ten focused context tests, typecheck and targeted
lint passed. Live latency remains unmeasured; membership-resolution and server
navigation round trips still remain. No production or schema change.

## Consolidated Owner dashboard request — 2026-10-18

Dashboard cards/chart now load through one no-store /api/dashboard request.
An explicit AsyncLocalStorage scope reuses default tenant authority resolution
only for the identical Request object and tenant within that execution; injected
resolvers and time overrides bypass reuse. No global/cross-request identity
cache is introduced. Individual domain permission checks and RLS remain intact.
The chart reads only the existing authorized sales projection instead of all
management report sections. Independent section errors remain explicit, and
aborted station changes do not apply old results. Twenty-five focused tests,
typecheck and targeted ESLint passed. Live authenticated performance and database
integration for this new aggregate endpoint remain unverified; no speedup number
is claimed. Station selection/context-discovery waterfall is not yet optimized.
No migration, production contact, merge or deployment.

## Dashboard all-stations selector — 2026-10-18

The dashboard route now opts into the existing reporting all-stations context
policy. Its context selector can switch between All stations and individual
stations; the existing dashboard aggregate API path is used when no station is
selected. Station command routes remain station-required, and server report
authorization/RLS are unchanged. Twenty-two context/dashboard model tests,
typecheck and targeted lint passed. Live Owner browser aggregation was not
verified in this slice; permissions were not broadened and no data was invented.

## Tablet labeled navigation — 2026-10-18

Tablet icon rails now offer Expand menu, opening the existing accessible modal
with labeled navigation and expanded groups. Selecting a destination closes it;
Escape restores focus to the separate tablet trigger. Desktop collapse and phone
More controls are unchanged. The 1113px browser regression passed, including
label visibility, Escape/focus and navigation dismissal. Typecheck passed after
Next generated route files settled; no authorization or database changes.

## Automatic sign-in after manual activation — 2026-10-18

After successful activation, the browser attempts Clerk credential sign-in with
the password still in the submit handler's memory, activates completed sessions
and replaces the route with /workplace. Incomplete challenges go through Clerk's
SignIn component; failed automatic sign-in shows account-created messaging and
a login link without exposing the activation form for resubmission. No passwords
are persisted or logged. Three focused tests (success, fallback, second factor),
typecheck and targeted lint passed. Live employee activation was not repeated.
The existing workplace planner already skips choice for one available station.
Latency investigation found repeated sequential membership/context queries;
no cross-request authorization cache or security bypass was introduced.

## Staff-code regeneration verification handling — 2026-10-18

Regeneration now establishes existing PRIVILEGED_OPERATION Clerk assurance
before calling the command. A regression test also identified and fixed a missing
return of the transaction result: generated credentials had not reached the UI.
The verification takes place
before calling the membership.manage-protected command. The details sheet
remains open for errors and displays command feedback rather than hiding it
behind the backdrop; success closes details and opens the fresh code dialog.
Duplicate regeneration clicks are disabled while busy. MFA requirements remain
unchanged. Command regression for preserved staff number/new code/audit passed;
typecheck and targeted lint passed. Live authenticated UI acceptance remains
unverified; an Owner without MFA cannot satisfy the existing strict-MFA policy.

## Clerk manual activation name requirement repair — 2026-10-18

Actual development activation failed with Clerk form_data_missing: last_name is
required by this instance. Full names had been sent only as firstName. Provider
creation now splits a supplied full name into firstName and lastName while
preserving explicitly supplied names and never inventing a missing surname.
Provider failures log only stage, status and bounded error codes, not input,
credentials or raw provider messages. Activation UI distinguishes backend setup
failures from incorrect codes. Failed provider creation rolls back the attempt
transaction and does not spend an incorrect-code attempt. A disposable Clerk
development signup with the corrected name mapping succeeded and was removed;
no employee identity/password was changed. No migration or production action.

## Shareable staff invitation text — 2026-10-18

Copy invitation now produces labeled staff number, activation code, explicit
UTC expiry, the current application's /join link and password-setup instructions,
with one-time/five-failure and privacy guidance. Clipboard failures are surfaced
instead of silently ignored. No credentials are persisted or logged by formatting.

## Optional custom staff numbers — 2026-10-18

Staff invitation defaults to Staff number, with an optional number field;
blank input preserves automatic generation. The selector is now Invite using
with Staff number and Email options. Custom numbers normalize to uppercase,
accept 4–32 ASCII letters/digits/hyphens/underscores (starting alphanumeric),
and remain globally unique in the existing registry. Migration 0032 updates
registry constraints and reservation/activation capability validation without
changing ownership, grants or RLS. Duplicate numbers return a conflict.
Fourteen focused unit tests, typecheck and the PostgreSQL runtime-role custom
reservation/duplicate/activation regression passed. Real Clerk signup was not
exercised. Migration 0032 applied successfully to the configured Neon development
database. No production access or deployment.

## Settings account-context redirect repair — 2026-10-18

Settings now reads its authenticated account through a shared identity helper
that sets transaction-local actor context and clears tenant/scope context before
the self-only query. A mapped but missing account fails FORBIDDEN rather than
UNAUTHENTICATED, avoiding the Settings → login → workplace redirect cycle.
Audited other app.users reads/joins in Staff, Daily Operations, Operations
Overview and Costing: these already execute within authorized tenant
transactions. No equivalent unscoped account read was found there. Ten focused
unit tests, typecheck and targeted ESLint passed; live authenticated browser
verification is blocked because local browser use is disabled in Work settings.
No schema/security-policy change, production access, push, merge or deployment.

## Permanent activation lockout — 2026-10-18

The latest human decision supersedes the timed staff-number budget below:
five incorrect activation codes permanently burn that invitation's code hash.
Only issuing a replacement code starts a fresh attempt budget; time passing
does not unlock it. Migration 0031 stores the bounded failure counter, uses
row locking for concurrent attempts and an owner-only SECURITY DEFINER
capability under FORCE RLS. Incorrect attempts commit even when the command
returns an error. Existing manager replacement and audit flow is retained.
The per-client twenty-attempt/fifteen-minute throttle remains a separate layer.
Local fresh-migration, lockout/replacement/concurrency and runtime-capability
checks passed, as did historical upgrade tests, focused unit tests, typecheck,
ESLint and Drizzle metadata checks. Migration 0031 was applied to the configured
Neon development database; 32 migrations and the guard/counter were verified.
No production change or deployment.

## Friendly staff activation — 2026-10-18

New manual activation codes use eight unambiguous characters grouped as
`7K3M-9R2X`. Case, spaces and optional hyphens are normalized; existing 40-hex
codes remain valid until their existing expiry. Hash-only storage, 72-hour
expiry and one-time acceptance are unchanged. Activation now enforces persistent
limits in every environment: five attempts per staff number and twenty per
client address per fifteen-minute window, failing closed on database errors.
Login links directly to activation, with a return-to-login link on that form.
Focused domain/login/command/rate-limit tests passed (24 tests); the PostgreSQL
cross-client per-staff throttling regression passed, and browser navigation
login → activation → login passed. Real Clerk account creation/login was not
exercised by those browser checks. No schema migration or production action.

## Clerk-only development candidate — 2026-10-18

Human-authorized branch `codex/clerk-only-auth-20261017` replaces runtime
authentication with Clerk only. Candidate migration 0030 moves internal users
to `app.users`, preserves business relationships and removes disposable legacy
credentials and provider mappings. The hard-coded production Owner CLI is
removed; configurable development seeding supports preview and explicit apply.
See `docs/runbooks/clerk-only-cutover.md`. This is repository implementation,
not a production deployment or claim that Neon/provider acceptance is complete.
No production credentials, roles, data or deployments were changed by this work.

Local verification for this candidate: 857 unit tests passed; PostgreSQL
integration tests passed (145 passed, 23 explicitly opt-in provisioning tests
skipped); fresh migration and seeded upgrade rehearsals passed. Typecheck,
Drizzle consistency check, ESLint and production build passed.
Account-menu and business-day-lock browser UI checks passed (13 tests).
Authenticated
Clerk login/MFA browser acceptance still requires dedicated test users and fresh
MFA evidence; synthetic UI checks are not a substitute for that acceptance.
Neon development migration 0030 was subsequently applied with explicit human
approval: 31 journal entries verified and obsolete credential tables absent.
Username-only development Owner seeding now accepts NULL email, preserves the
Clerk identity mapping and records a signed audit event. The focused PostgreSQL
regression test, typecheck and targeted ESLint passed. No new migration was
needed: the existing user email column is already nullable.
Changes remain on the isolated branch and have not been pushed or deployed.

## 1. Snapshot

This file is a conservative status snapshot based on the latest project conversation. It is intentionally stricter than a progress report: discussion alone does not count as implementation, and implementation alone does not count as release completion.

Status labels:

- **VERIFIED COMPLETE** — directly validated by tests/review/production evidence.
- **REPORTED COMPLETE** — an implementation agent reported completion but final independent/integration evidence is not yet complete.
- **PARTIAL** — meaningful work exists, but a required gate remains.
- **NOT STARTED** — no implementation evidence.
- **UNKNOWN** — insufficient evidence.

## 2. Repository and release identity

### VERIFIED COMPLETE

- PR #95 merged the documentation-only canonical knowledge-base change.
- PR #96 merged the documentation-only canonical status synchronization at
  main `8b9d163763cb4fab52b96aed225f7553f0069e65`.
- The canonical knowledge base is `AGENTS.md`,
  `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`,
  `docs/CURRENT_STATUS.md`, and `docs/IMPLEMENTATION_PLAN.md`.
- No competing active repository-wide source of truth remains, and the
  temporary nested knowledge-base copy is absent.
- The documentation merge did not change deployed application behavior.

### Current production security closeout — 2026-10-09

The current production Stage 1 security closeout is **PASS**. The historical
Stage 1 failure is preserved as historical evidence and is **SUPERSEDED** by
the current verified result recorded in
[`docs/release-readiness.md`](release-readiness.md).

Current production release SHA:

`2c7304916c191c66907d9582a3e7c26225c6eb59`

Current production evidence:

- The migration journal ends at `0024`.
- Migrations `0022`, `0023`, and `0024` were each verified once with their
  expected hashes.
- Migration `0025` is **NOT APPLIED** and remains intentionally deferred.
- An active `OWNER` exists and OWNER MFA enrollment is verified.
- The `T.E.I Oils` tenant is active and four active stations are confirmed.
- `app_runtime` least privilege is verified.
- All 67 app tables use RLS and `FORCE ROW LEVEL SECURITY`.
- `/api/health` returns HTTP 200 and `/api/readiness` returns HTTP 200 with
  database readiness `ok`.

Still open and not implied closed by this documentation update:

- `job_runtime` temporary quarantine is effective: its password was rotated,
  the replacement credential was not exposed, post-rotation sessions were `0`,
  the deployed web app uses `app_runtime`, no active `job_runtime` consumer was
  found, and health/readiness/normal authenticated app load passed.
- Controlled release may proceed with a documented security exception. This
  does not fully remediate `job_runtime`; provider-level permanent hardening is
  mandatory, and the role must remain unbound until that hardening completes.
- Authenticated final production smoke remains open.
- The #114, #113, and #111 release work remains open as applicable.
- Final production release readiness is not declared complete.

## 3. Production application baseline

### VERIFIED COMPLETE

- The historical production application release before the documentation-only merge was
  `53cf4382487271bed68160386cc41c447ab542e2`.
- The current verified production release is
  `2c7304916c191c66907d9582a3e7c26225c6eb59`.
- The production Vercel deployment for that application release was reported
  READY and the production alias `https://fuel.shandahr.com` was verified.
- Do not treat the documentation merge SHA as a deployed application release.
- PR #94, which added the PostgreSQL 18 provider-membership preflight recognition/tests, was merged before this release.
- Production migration `0021_security_first_user_provisioning.sql` is applied
  exactly once with approved SHA-256
  `a51bee68bbfec23cfeabaa7a54039aca3672b7e8b4e386a5d2c36b01bd5d7caa`.
- Production PostgreSQL is Neon PostgreSQL 18.6.
- Security checks after migration reported:
  - Force RLS checks passing,
  - helper ACL checks passing,
  - fixed security-definer search paths passing,
  - no PUBLIC bootstrap access,
  - no app_runtime bootstrap access,
  - bootstrap sentinel not consumed,
  - the historical pre-provisioning checkpoint recorded no real production
    user at that time; the current active OWNER state above supersedes that
    checkpoint.

### Important release constraint

Production migrations are not automatic. A deployed web release must not be assumed to imply a database migration occurred.

## 4. First-user production access

### VERIFIED COMPLETE

- Migration 0021 security model has been validated locally on PostgreSQL 18.6.
- Exact Neon/PostgreSQL 18 provider membership behavior has been reproduced and covered by preflight tests.
- The selected temporary credential model is an ephemeral password assigned to `first_user_provisioner` and restored to `PASSWORD NULL` afterward.
- The runbook/operator procedure includes mandatory cleanup on both normal and abnormal exit.
- Security evidence is intentionally split across migration owner, provisioner, runtime, and supplemental diagnostics principals.
- Production connection handling was corrected for the actual Homebrew `psql` 16 behavior:
  - URI parsed into process-local libpq environment variables,
  - URL/password excluded from argv/files/logs,
  - duplicate query keys rejected,
  - `ssl`/`sslmode` conflicts rejected,
  - malformed/empty/out-of-range ports rejected,
  - unsupported parameters rejected,
  - parser and secret handling received independent Access Review GREEN.
- The read-only production role-discovery runner received Access Review GREEN.
- Human role discovery was executed against production and returned zero eligible unrelated-role candidates.
- The former unrelated-role spot check has been replaced by strictly stronger
  exhaustive `pg_proc` ACL-grantee validation, and the final Access Review is
  GREEN.

Verified production role state before provisioning:

- `first_user_provisioner` has LOGIN, NOSUPERUSER, NOINHERIT, NOCREATEROLE,
  NOCREATEDB, NOREPLICATION, and NOBYPASSRLS; its password is NULL.
- The approved Neon membership is `migration_owner` →
  `first_user_provisioner`, granted by `cloud_admin`, with `admin=true`,
  `inherit=false`, and `set=false`.
- No temporary provisioner password was assigned by the historical failed
  Stage 1 run.

The actual operator client is Homebrew `psql 16.15`. Human local validation
against PostgreSQL 18.6 verified success exit code 0, deliberate failure exit
code 3, fail-closed `ON_ERROR_STOP=1` behavior, and no false PASS continuation.

### Historical Stage 1 attempt — superseded by current PASS

The following entries preserve evidence from a prior fail-closed Stage 1
attempt. They are not the current Stage 1 result; the current verified result
is PASS as recorded above.

- The latest Stage 1 production run passed exact checkout/SHA and local
  migration-hash checks, migration-owner identity, provisioner attributes,
  password-NULL state, provider membership/capability checks, DB/schema
  capability checks, runtime-role assertions, migration 0021 exactly once,
  and nine expected relations with RLS plus FORCE RLS enabled.
- The run printed the production policy catalog and then failed closed with
  `FAIL: RLS/policy preflight failed` and `ERROR: division by zero`.
- Predicate-level evidence established nine valid policies, zero exact
  policies under the historical assertion, and zero unexpected prefixed
  policies. The historical assertion compared normalized `pg_policies.cmd`
  with raw `pg_policy.polcmd`: raw `'*'` is exposed as normalized `'ALL'`,
  so the exact-policy count was zero. This is a verified preflight
  normalization bug, not observed policy drift.
- The repository-local diagnostic now asserts `pg_policies.cmd = 'ALL'` and
  has regression coverage. The external operator helper was not modified;
  its owner must apply and review the one-line correction before a human
  Stage 1 retry.
- The failed run stopped before temporary provisioner password assignment.
  No cleanup is required from that historical run. Stage 2 had not run in
  that checkpoint, real-provisioning approval was not recorded there, and
  authenticated production smoke had not happened at that time.
- Stage 2 has **not** been run against production.
- The historical pre-provisioning snapshot recorded no real first production
  user; the current active OWNER is verified, while authenticated production
  smoke remains open.
- Authenticated production smoke (login/context/protected route/logout/re-login)
  has not been completed.

## 5. UI shell / PR #92 work

### REPORTED COMPLETE / PREPARED FOR INTEGRATION

A local integration candidate includes the reviewed PR #92 UI polish behavior, including:

- shared shell headings,
- removal of duplicate body titles where the shell owns the title,
- navigation groups closed by default,
- operation-child opening behavior,
- hidden children inert,
- route-title consistency,
- account-context clipping/wrapping fixes,
- responsive light/dark behavior.

Known test-only fixes from the earlier simulation were incorporated into local candidates.

### Not yet production-complete

PR #92 has not been treated as finally integrated/deployed in the latest production release state described here. Final integration must preserve current main’s first-user/security files and safeguards.

## 6. Customers Phase 0

### VERIFIED FUNCTIONAL BEHAVIOR

Customers Phase 0 implementation exists and has been exercised in local integration candidates with:

- Finance navigation entry,
- command/search entry,
- responsive list/detail,
- search,
- type/status,
- balances,
- prepaid litres,
- reservations,
- recent ledger/activity,
- tenant-authorised read API,
- loading/empty/no-match/permission/error handling.

Security/database evidence:

- tenant isolation passed,
- no cross-tenant leakage was observed,
- no new migration/RLS/auth/write semantics were introduced for Customers.

### A8 decimal-contract issue — VERIFIED FIX

A Customers summary integration assertion exposed monetary scale behavior.

Current confirmed contract:

- money uses `NUMERIC(20,4)`,
- derived balances serialize with four decimal places,
- verified example: `"125.3750"`.

Verification after the product fix reported:

- PostgreSQL 18.6 dedicated cluster used,
- 22 migrations passed,
- A8 integration: 1/1 PASS,
- real PostgreSQL customer summary coverage: PASS,
- tenant isolation: PASS,
- broader non-provisioning integration suite: 96 passed / 0 failed / 17 intentional provisioning skips,
- Customers unit tests: 15/15 PASS,
- lint: PASS,
- direct TypeScript check: PASS.

### PARTIAL integration state

The A8 product fix exists in the clean candidate worktree but final release integration/commit/deploy evidence is still pending. An unrelated existing edit in `src/platform/db/client.ts` was observed and must not be accidentally included unless separately justified/reviewed.

## 7. A3 meter-exception behavior

### VERIFIED COMPLETE — no product defect

Initial A3 failures (HTTP 500) were reproduced on both the candidate and exact main under a bad local harness.

Root cause:

- local migrations had been applied under the wrong role,
- a security-definer meter-exception trigger therefore had the wrong owner,
- PostgreSQL correctly rejected the operation.

With the expected PostgreSQL 18.6, UTC, bootstrap-role, migration-owner, and fixture setup:

- candidate focused A3: 5/5 PASS,
- exact main focused A3: 5/5 PASS.

Classification: **HARNESS/ENVIRONMENT**, not a candidate regression. No product fix is required.

## 8. Daily Operations Phase 0

### VERIFIED scope alignment

The Phase 0 Daily Operations scope is primarily UI/composition/workflow alignment, not new schema/accounting/ledger behavior.

The owner-workflow crosswalk includes:

- station/date/shift,
- supervisor/attendants,
- pump readings/litres/price,
- account/POS/EcoCash/approved fuel,
- expenses,
- dips/deliveries,
- reconciliation/variance,
- cash/banking/sign-off.

### Timezone correctness P0 — FIX READY / VERIFIED IN ISOLATION

A genuine P0 correctness issue was identified: shift times used browser-local `toLocaleTimeString` rather than station timezone.

A scoped fix was implemented and verified in isolation using the existing
`operation.station.timezone` / `app.stations.timezone` source.

Reported verification:

- no schema/migration change,
- no guessed timezone,
- invalid/missing timezone renders `—`,
- adjacent timestamps audited,
- focused tests 12/12 PASS,
- Daily Ops E2E 2/2 PASS,
- typecheck PASS,
- lint PASS,
- build PASS.

### PARTIAL

A clean timezone-only integration review/cherry-pick step is still required so
unrelated worktree edits do not leak into the release candidate. It is not
merged or deployed.

## 9. Clean Phase 0 integration candidate

### REPORTED COMPLETE / LOCAL CANDIDATE

A clean isolated candidate was created at documented HEAD:

`06447e1812d30d85532a593389bf35ab10e82422`

Base:

`53cf4382487271bed68160386cc41c447ab542e2`

It was reported to contain:

- PR #92 product work,
- the two known PR #92 test-only fixes,
- Customers implementation,
- Customers-present shell expectations,
- Daily Ops stale E2E expectation fixes,
- real PostgreSQL customer-summary coverage,
- no unrelated A12 delta.

Reported local checks at candidate creation:

- Prettier PASS,
- ESLint PASS,
- TypeScript PASS,
- focused unit PASS,
- full unit suite 513 tests PASS,
- build PASS.

### Important caveat

Subsequent verified A8 and timezone changes are newer than the clean candidate HEAD above unless/until they are deliberately integrated and committed. Do not assume that SHA alone contains every latest fix.

## 10. Integration/browser validation

### VERIFIED

Across the prepared candidate work:

- UI/navigation checks passed,
- shell consistency passed 14/14,
- Customers E2E passed 2/2,
- accessibility checks passed,
- mobile/responsive checks passed,
- A8/database verification passed after the decimal fix,
- broader non-provisioning integration suite passed 96/0 with 17 intentional provisioning-only skips.

### PARTIAL / CI browser gate pending

The combined Phase 0 candidate has passed the local unit, integration,
typecheck, lint, format, build, browser, accessibility, mobile, runtime-role,
and PostgreSQL 18.6 lifecycle checks. The remaining release gate is the
authoritative GitHub Actions quality job: its browser run continues to show
non-deterministic Next development-server/error-page and DB-backed E2E
failures despite local reproduction passing and the configured CI retry policy
being enabled.

## 11. Owner readiness

### VERIFIED assessment

A read-only Owner Gate audit found the Phase 0 owner journey complete enough for final QA.

Covered areas include:

- dashboard/navigation,
- Daily Operations,
- Customers,
- Finance/reporting surfaces,
- empty/context-required states,
- responsive shell.

### BLOCKED for handoff

Final owner handoff is not green because the following remain open:

1. keep `job_runtime` unbound and complete provider-level permanent hardening
   after controlled release under the documented security exception,
2. complete authenticated final production smoke,
3. complete the #114, #113, and #111 release work as applicable while keeping
   `0025` deferred,
4. integrate PR #92 and Customers plus the verified A8 fix,
5. integrate and review the Daily Operations timezone fix,
6. run final release gates, deploy, and verify the exact production SHA,
7. complete owner acceptance and remediate any P0/P1 finding.

Owner handoff must use only:

`https://fuel.shandahr.com`

## 12. Observability

### PARTIAL / temporary release exception

- Local observability definitions/panels/tests are reported PASS.
- Desired native production semantics remain constrained by the current Vercel plan.
- A paid alternative was declined.
- Technical status remains blocked/exception, not PASS.

## 13. Rate limiting

### PARTIAL / evidence exception

- Implementation is reported PASS.
- A staging E2E path is blocked because an upstream provider intercepts the relevant request before the application’s target behavior can be observed.
- This must remain an evidence exception, not be relabelled PASS.

## 14. Dependency advisory

### VERIFIED FOR THE CURRENT PHASE 0 CANDIDATE / time-bounded exception

The release-candidate dependency remediation updates the production-reachable
`source-map-js` and `sharp` dependency paths and moves Vitest to the patched
major line that removes the reported `tinypool` findings. The repository audit
script passes with the existing, explicitly scoped dev-only `braces@3.0.3`
exception; that exception remains time-bounded and is not a production waiver.

## 15. Known bugs/issues

### Active

1. **Historical production Stage 1 attempt (SUPERSEDED):** it failed closed in
   the RLS/policy preflight with a division-by-zero error caused by the
   historical `pg_policies.cmd = '*'` assertion. The current production Stage 1
   result is PASS; the historical evidence remains preserved above.
2. **`job_runtime` temporary quarantine is effective; provider-level permanent
   hardening remains open and is not a current role-specific release blocker
   under the documented security exception.**
3. **Daily Operations timezone and A8 decimal corrections are present in the
   overnight Phase 0 integration candidate;** final release evidence remains
   dependent on the combined-candidate gates below.

The frozen Phase 0 candidate also had an authorization-projection blocker:
the client shell received an all-visible synthetic navigation projection. The
current release candidate replaces that with a server-derived projection from
the authenticated actor and validated tenant/legal-entity/station context,
fails closed to an empty projection, and limits the synthetic projection to
the explicit non-production `APP_ENV=test` test fixture. This correction was
independently reviewed GREEN on the final candidate; that review did not
approve production release by itself. The CI quality/browser gate remains
open.

### Closed / not product bugs

- A3 meter-exception 500s — closed as harness/ownership issue.
- psql 16 URI-via-PGDATABASE behavior — fixed by reviewed process-local libpq parsing.

## 16. Technical debt / documentation debt

- Existing owner-readiness documents contain stale historical SHAs and pre-candidate status.
- Some implementation-status/parallel-execution/traceability documentation references older base SHAs.
- Local integration harness setup is ownership-sensitive and should be documented clearly to avoid future false regressions.
- The historical Stage 1 RLS/policy preflight normalization bug is diagnosed
  and preserved as superseded evidence; the current production Stage 1 result
  is PASS. The exhaustive function ACL-grantee validation is already Access
  Review GREEN.

## 17. Owner-resolved product decisions

The owner has resolved the previously open Daily Operations, account-sale,
approved-fuel, cash-custody, customer-account sequencing, workflow,
close-summary, and Phase 1 customer-lifecycle questions. Durable decisions
are recorded in DEC-032 through DEC-039 and DEC-041 and integrated into
`PRODUCT_SPEC.md` and `ARCHITECTURE.md`.

The fixed semantics include distinct operator/submitter and Supervisor
approver actors, required customer identity for account sales, auditable
approved-fuel attribution, core cash custody evidence, exception-first close
summaries, the stated Phase 1 customer-account priority order, and the
operational-control purpose and authorized scope of the home dashboard. The
home-dashboard decision is recorded in DEC-039.

DEC-041 now fixes customer credit, prepaid-value, statement, pricing,
vehicle/driver, benefits, tax-metadata, currency, lifecycle, and
customer-specific authorization semantics. The initial implementation slice
enforces positive hard-capped CREDIT accounts and blocks new account
transactions for non-active customers/accounts. No new accounting, tax, FX,
or broad role-grant behavior has been invented.

## 18. Remaining product and technical decisions

The following remain unresolved and must not be silently invented:

- complete human application role/permission matrix;
- detailed accounting/ledger behavior not already covered by the A8 customer
  contract; exact customer permission-code and migration alignment; and
  detailed authorization contracts for approved-fuel, cash, and close
  workflows;
- formal performance/SLO targets;
- which Phase 1 provider integrations are required first and their exact
  contracts;
- historical cause of the Stage 1 RLS/policy preflight division-by-zero failure
  and the exact predicate result that selected its intentional failure branch;
- current production release SHA is verified above as
  `2c7304916c191c66907d9582a3e7c26225c6eb59`.

### Newly unblocked planning work

- M3-T03 owner-decision documentation is VERIFIED COMPLETE.
- M4-T02 is READY FOR A BOUNDED FIRST SLICE: DEC-039 fixes the operational
  headline/status areas, audience, authorized scope, and bounded
  configurability. Existing A10 contracts support the initial read-only sales,
  cash-evidence/variance, account-credit, and fuel/stock variance facts.
  Unresolved-exception and shift approval/close presentation must use
  authoritative source state or remain truthfully unavailable until a reviewed
  read-model extension exists.
- M4-T03 has a bounded contract decomposition in
  `docs/architecture/phase1-contract-decomposition.md`; individual slices
  still require reviewed command/read-model contracts before implementation.
- M5-T01 is accepted for the DEC-041 customer lifecycle semantics. Its
  remaining sub-contract gates are exact permission/migration alignment,
  lifecycle transition commands, monthly statement read-model details, and
  later pricing, vehicle/driver, benefits, tax, and FX contracts.
- M5-T02 is IN PROGRESS for a bounded credit-guard slice: positive CREDIT
  limits are required and treated as hard caps, and suspended/closed
  customers or inactive accounts cannot initiate new account transactions.
  Full lifecycle writes remain gated by reviewed command, audit, permission,
  and migration contracts.

These decisions do not alter the historical M0-T03 production diagnostic
evidence. The current Stage 1 closeout is recorded above.

## 19. Open technical questions

### UNRESOLVED / needs verification

- Provider-level permanent hardening of `job_runtime` and its post-change
  verification; keep the role unbound until complete.
- Authenticated final production smoke and owner handoff.
- Whether the dev-only dependency advisory now has an upstream fix.
- Whether hosting/plan changes alter the observability exception.
- Full background-job topology and current production `job_runtime` presence.

## 20. Not started / deferred Phase 1 work

The following are explicitly not Phase 0 completion requirements unless promoted by a new human instruction:

- full customer lifecycle/write command set and permission/migration alignment,
- richer approved-fuel approval policy,
- complete expense approval/allocation lifecycle,
- full cash custody/banking workflow,
- provider integrations,
- interrupted delivery/calibration/transfer workflows,
- broader profitability/exports/Action Center work beyond the bounded finance
  backend candidate above,
- offline sync/interrupted drafts,
- alerts,
- full editable settings behavior,
- general ledger,
- tax treatment.

## 21. Current critical path / next recommended work

The Phase 1 customer lane may proceed in parallel with the parked M0-T03
production gate. The next customer steps are to independently review the
bounded credit/activity guard diff, integrate it through the A0 migration and
permission ownership process if needed, then specify lifecycle transitions and
the monthly statement read model separately. Do not invent accounting, tax, FX,
or customer-specific pricing behavior.

Use this order unless a current human instruction changes it:

1. Proceed with controlled release under the documented `job_runtime` security
   exception; keep the role unbound and complete provider-level permanent
   hardening post-launch.
2. Complete authenticated final production smoke and owner handoff.
3. Complete the #114, #113, and #111 release work as applicable; keep `0025`
   intentionally deferred.
4. Run final release gates, deploy through the approved workflow, verify the
   exact production SHA, and complete owner handoff.

## 22. Things agents must not assume

- Do not assume a discussed feature is implemented.
- Do not assume the clean candidate HEAD includes later uncommitted A8/timezone fixes.
- Do not assume an intentionally skipped provisioning suite is a passing provisioning suite.
- Do not assume `job_runtime` is fully remediated: the temporary quarantine is
  effective, but provider-level permanent hardening remains mandatory and the
  role must remain unbound until complete.
- Do not treat the historical Stage 1 fail-closed attempt as the current
  result; current verified Stage 1 status is PASS and the historical failure
  is superseded.
- Do not assume a temporary provisioner password was set by that historical
  failed Stage 1 run.
- Do not treat the earlier `\\quit 1`-ignored run as valid evidence.
- Do not assume a Vercel deploy runs database migrations.
- Do not assume environment-specific HTTP 500s are product defects without baseline/harness comparison.
- Do not mark observability or rate-limit evidence exceptions as PASS.

## Daily Operations Activity removal — 2026-10-18

Removed the Activity card, its overview audit-history query and response fields, and unused timeline styles. Updated integration assertions and browser fixtures. Audit recording and stored security events remain unchanged. No schema or authorization changes.
Validation: 91 forecourt unit tests and 6 local PostgreSQL integration tests passed; TypeScript and targeted ESLint passed. No production access, push, merge, or deployment.

Daily Operations heading cleanup: removed the repeated shift-board date and side-panel date/status; the side panel is now labelled “Day controls”. Timestamps and privileged actions are unchanged. Added browser regression assertions (not executed in this slice); 91 forecourt unit tests, TypeScript, and component lint passed.

Lock interaction: removed the separate Clerk verification button. The single Lock business day action confirms the irreversible operation, establishes provider-managed identity assurance, then posts the existing versioned command only after an active step-up response. Cancellation/failure prevents posting; server permission/assurance checks remain unchanged. Updated browser tests for the new entry point and failed-verification refusal; browser suite not run against a real Clerk verification challenge. 91 forecourt unit tests passed; component lint and TypeScript passed. No real business day was locked during verification.

Intermittent re-login investigation: the login form previously labelled all exceptions (including session activation/network errors) as rejected credentials. Separated credential, rate-limit, session-activation and other failures; added an immediate duplicate-submit guard. Seven focused tests, TypeScript and targeted lint passed. The reported intermittent failure has not been reproduced with current credentials and its root cause is unconfirmed; no password or Clerk configuration was changed.

Daily Operations simplification: removed the Needs Attention section and the Shifts / Waiting for review / Returned for changes summary cards, including their unused client-side calculations. The shift board, reconciliation workflows and server authorization remain unchanged. Browser regression assertions updated but not executed; 91 forecourt unit tests, TypeScript, targeted lint and CSS parsing passed. No production access, push, merge or deployment performed.


## 2026-10-18 — Server-loaded dashboard page data (local candidate)

Implemented in `codex/clerk-only-auth-20261017`, without contacting Neon or production:

- The main dashboard, Cash, Settlements, Customers list/detail, Suppliers list/detail,
  Operations overview/reconciliation list, Daily Operations, My Shift, valuation
  overview/stream/revaluation detail, and reporting pages load primary initial data
  through shared server query services. Client workspaces receive serialized initial
  results and skip duplicate mount-time data requests. Existing API refreshes and
  command endpoints remain available.
- A shared server page boundary validates URL context against the authorized tree,
  keeps navigation/context on the same selection, streams loading states, and keys
  boundaries by scope to prevent previous-station content persisting on navigation.
- Dashboard aggregation is shared between the server page and API. Chart range
  changes use `/api/dashboard/sales` and do not reload daily/customer/operations
  sections. Reporting station authorization reuses validated request snapshots;
  missing stations retain an RLS-backed lookup. Daily totals retain their existing
  date semantics independently of chart range.
- Request render caching now remains available after shell access resolves.
  Finance forwards its already-resolved actor into its existing request scope.
- No migrations, ACL/RLS changes, dependency changes, command semantics, or monetary
  calculation changes were introduced by this server-loading conversion.

Validation: 991 unit tests passed; 10 focused local `app_runtime` database checks
passed, including dashboard loading and foreign-station rejection; the combined
browser run passed 68 checks and intentionally skipped four authenticated reporting
checks without configured fixture credentials. TypeScript, production build and
focused lint passed. Browser fixtures were updated from obsolete individual
Dashboard endpoints to the existing bundled API and new chart-only refresh route.
The disposable local PostgreSQL cluster was stopped after testing.

Limits: these are synthetic browser checks plus real local runtime-role query
checks, not signed-in Neon latency measurements. The browser tool still reports
local browser access disabled, so no new time-to-data improvement is claimed.
Supplemental reconciliation-board detail reads still load in the browser; primary
operations overview loading moved to the server. The previously reported stream
closure was not reproduced or declared fixed. Earlier broad command-suite database
prerequisites remain as documented above. At initial local validation, no commit, push, merge or deployment had been
performed for this candidate. Independent review remains a release gate.


### PR #146 integration validation

Prepared this performance update on top of `8f25ac2a65faf189970b8a9c3484367c671ab1ed`,
preserving the eight intervening PR commits. The merged implementation keeps credit-limit
warnings, station-required Finance context, saved organisation reporting behavior, and
read-only approval visibility without a fresh step-up. Batched reconciliation sign-off
facts retain business-day/shift identifiers needed by the existing destination links.
Approval commands retain their existing assurance requirements.

The combined candidate passed 1,002 unit tests, 10 local runtime-role database checks,
and 68 browser checks (four authenticated reporting cases intentionally skipped without
fixture credentials). TypeScript, production build, targeted lint, formatting and
`git diff --check` passed. No Neon or production operation, migration, merge or deployment
was performed during this integration. This update is intended for the existing draft
PR #146; independent release review and live navigation latency verification remain open.


### 2026-10-18 — All stations viewing candidate (not pushed)

The clerk-only-auth worktree now preserves explicit All stations navigation and keeps the selector option visible on station record screens. Operations/reconciliation, Finance, Cash, Settlements and Valuation overviews stream station-labelled results through existing authorized query services. Customers retain tenant-wide reads; Suppliers show balances once per legal entity. Station record/action routes still require a station. Existing single-station server initial-data loaders, command handlers, RLS and schema remain unchanged. Station and legal-entity portfolio reads are limited to three concurrent loads per overview; larger portfolios still require live latency evaluation and potentially dedicated batched portfolio queries.

Validation: 1,026 unit tests passed, plus 70 synthetic browser checks; four authenticated reporting tests intentionally skipped without fixture credentials. New browser tests cover All → station → All on phone/desktop, including returning from station Cash to the All stations Cash overview. Type checking and focused lint passed. Signed-in live performance and the new portfolio screens against real development data remain unverified. No database migration, production contact, commit, push, merge or deployment was performed for this candidate.


### 2026-10-18 — Cross-station Operations presentation refinement

Replaced the tall raw-definition-list station cards on Daily Operations and Reconciliations with the existing shared table, status badges, formatted business dates and row links. The phone layout groups each station into two compact label/value columns. Other station overview cards now use explicit fact spacing rather than browser-default definition-list margins. Existing station/record links, server reads, concurrency limits, schema, authorization and commands are preserved. Populated synthetic fixtures were visually inspected at desktop/phone widths; all four light/dark layout checks passed. These screenshots verify presentation, not signed-in live-data performance.


### 2026-10-18 — Navigation context retention candidate

Explicit station or All stations scope is forwarded by shell and dashboard/report links. Same-organisation partial links retain the validated selection; generic requests can restore the persisted preference. Selector refresh failures retain the display selection and offer retry; expired sessions redirect to login. Retained display state grants no data access. Unit suite: 1,038 passed; type checking, targeted lint and production build passed. Synthetic phone/desktop browser coverage validates All stations switching, navigation and refresh recovery; live authenticated acceptance remains separate. No migration, production operation or push performed.


### 2026-10-18 — Responsive settings and record lists

Settings now uses available-width container queries for its section navigation and Staff rows. Customer/Supplier lists and supplier statement rows stack when their own panel is narrow, including tablet widths above the existing phone breakpoint. Existing visual tokens and all data/actions remain intact. Four isolated populated layout checks passed at 390/824/1024/1440px using production styles; these are synthetic CSS checks, not authenticated workflow coverage. Unit suite: 1,038 passed; type check and focused lint passed. No database, production or release operations.


### 2026-10-18 — Settings section menu and staff controls

Narrow Settings workspaces now replace wrapping section buttons with a labelled native section menu. Staff details use a profile header, outlined facts and a separated account-actions section. Staff role filtering combines with existing status/search controls and a clear action; counts reflect selected station and role. Existing staff SELECT now returns structured role/scope assignments in the same exchange, allowing display filtering to include tenant-wide and matching legal-entity/station assignments without parsing scope labels. No schema or authorization policy changes. Four synthetic populated browser layout checks and production build passed; actual-component tests cover menu permissions and matching/nonmatching station staff. Live signed-in workflow and development DB query execution are not claimed by these checks.


### 2026-10-18 — Final Settings navigation scope correction

The styled icon/name/chevron section disclosure is mobile-only (viewport <= 48rem). Above that breakpoint, original desktop section navigation is retained. Four responsive checks assert mobile disclosure visibility and desktop navigation preservation. Combined unit suite: 1,046 passed; type checks and focused lint passed. Production build passed before the final CSS-only desktop correction; the release validation reruns it. These fixture checks do not replace authenticated acceptance or development-database validation of the staff query.


### Settings authorized stations and section capabilities — 18 October 2026

Settings now projects the authorized context station tree into its existing DTO, listing stations when no individual station is selected and retaining selected-station details. Station metadata remains read-only in this screen; generic instructions to ask an administrator were removed, including the account profile guidance. Readiness and Payments tab visibility reuse the setup service's existing permission projection rather than membership invitation rights. No schema, role grants, or database changes were made; no extra database request was introduced. Focused Settings/setup/staff tests (40) and TypeScript/lint checks passed. Live signed-in grant verification and database isolation execution were not performed; source inspection of related endpoints is not a complete authorization audit.


### Collapsed sidebar tooltip clipping — 18 October 2026

Navigation labels in rail mode now render through a body portal beyond the sidebar frame, avoiding the navigation scroll container's clipping. Expanded navigation retains its normal inline labels. Hover and keyboard focus show labels; Escape, blur, pointer departure, wheel/touch movement, resize and clicks dismiss them. Browser fixture checks passed at 1113px and 1440px; TypeScript, focused lint and diff checks passed. No authorization, database or navigation destination changes. No production contact or push.


### Collapsed rail active-item inset — 18 October 2026

Rail mode now removes expanded-navigation horizontal padding and reserved scrollbar gutter, centres 44px destination surfaces within available width, and preserves an inset from the frame and scrolling region. Expanded desktop and mobile navigation are unchanged. Browser regression checks passed at 1113, 1213 and 1440px, covering active-item bounds plus existing hover/focus tooltip behavior. Focused lint and diff checks passed. No production contact, commit or push.


### Unified expense integration — 2026-10-19

Unified expense integration is an incomplete isolated candidate based on 186f66d. Separate local database created and incoming 0000–0040 plus 0047/0048 applied with approval. Five focused runtime-role version/correction/API tests pass, including concurrent correction serialization; the full incoming-plus-candidate unit suite passed 171 files / 1,199 tests. TypeScript, focused lint, formatting and diff checks passed. The wider expense suite has unresolved self-approval, recurring-fixture and dependent audit failures. These also reproduce using unchanged incoming test assertions on this test environment; no clean-baseline production-code proof is claimed. Original worktree/local DB preserved. No Neon/production contact, merge, commit, push or deployment. Full refactor conversion and report-submission wiring remain outstanding.
