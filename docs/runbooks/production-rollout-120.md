# Shanda Fuel #120 production rollout runbook

**Status: PREPARATION ONLY — REVIEW REQUIRED**

This runbook is the operator sequence for release #120 (provider-neutral auth,
Clerk support, Staff Number onboarding, and canonical migration `0027`). It is
not evidence that any step has been executed. This preparation task performs
no production, Vercel, Clerk, invitation, database, or merge operation.

The sequence assumes #119 is the live release and that the #120 change is
approved for integration. It deliberately keeps Better Auth available and
does not retire Better Auth in this release.

Canonical source documents are `docs/spec/MASTER_BLUEPRINT.md`,
`docs/spec/WIREFRAMES.md`, `docs/implementation-status.md`,
`docs/PARALLEL_EXECUTION.md`, `docs/workstreams/A1_PLATFORM_SECURITY.md`,
`docs/workstreams/A8_HARDENING_RELEASE.md`,
`docs/runbooks/deployment.md`, `docs/runbooks/production-configuration.md`,
`docs/runbooks/production-readonly-smoke.md`, and the #120 branch's canonical
migration README and migration test.

## 1. Preconditions and control record

Record these values in the release ledger before starting. Do not invent
identifiers or client master data.

| Item | Required record |
| --- | --- |
| Release | PR/release identifier `#120`, exact approved commit SHA, CI run URL, and deployment owner |
| Live baseline | Current #119 deployment ID/SHA and the last known-good rollback deployment |
| Production target | Exact HTTPS origin, Vercel project/deployment owner, Neon project/branch, and CAT observation window |
| Database state | Approved evidence that production is at canonical migration `0026` and that the migration-owner path is available |
| Auth records | Existing Owner internal `auth.user.id`, Owner tenant/membership IDs, and the Owner's current Better Auth identity |
| Invitation record | Existing pending Attendant `staff_invitations.id`, tenant/station scope, and a before-snapshot showing `status = 'PENDING'` |
| Clerk procedure | Approved production Clerk tenant/instance, secret-manager entries, production domain/origin settings, and a reviewed procedure for creating the Owner Clerk identity and inserting the provider mapping |
| Recovery | Fresh backup/recovery evidence, rollback deployment confirmed, incident owner, and provider/database owner on the bridge |
| Evidence | Secure location for deployment ID, commit, migration result/hash, request IDs, redacted smoke output, approvals, and timestamps; never store credentials, cookies, activation codes, or MFA secrets |

The #120 CI result must cover the repository workflow gates already defined
in `.github/workflows/ci.yml`: frozen install, format check, lint, typecheck,
database migration test, `pnpm db:check`, unit tests, integration tests, build,
and the approved Playwright suite. The production application must use the
pooled `app_runtime` connection. `DATABASE_DIRECT_URL` is migration-only and
must not reach the deployed application.

The following must remain true throughout the release:

- `REQUIRE_PRIVILEGED_STEP_UP=true` and `REQUIRE_LOGIN_MFA=true` remain enabled.
- Better Auth tables, `BETTER_AUTH_SECRET`, and the Better Auth identity rows
  remain present. `0027` adds a Clerk mapping; it does not replace the
  internal principal or delete the Better Auth mapping.
- No business data, memberships, invitations, or role assignments are changed
  by the deployment or migration itself. Migration `0027` may add the
  provider-neutral Better Auth identity rows and schema objects defined by its
  reviewed SQL.
- Only read-only SQL is used for preflight and verification. Migration SQL and
  the Owner mapping are performed only through their reviewed restricted
  procedures. Staff conversion uses the named application command, not an ad
  hoc `UPDATE`.

### Required approvals

Obtain and record the named human approval at each gate; an approval for one
gate does not imply approval for the next.

1. Release owner: begin the controlled window, explicitly set production
   `AUTH_PROVIDER=BETTER_AUTH` while #119 is still live, and deploy #120.
2. Database owner plus release owner: apply migration `0027` after the
   read-only preflight passes.
3. Security/release owner: configure Clerk production, approve the reviewed
   Owner identity mapping, and approve Owner MFA re-enrollment.
4. Release owner: perform the controlled `AUTH_PROVIDER=CLERK` cutover.
5. Business owner/security owner: approve the existing Attendant invitation
   conversion and the final GO/NO-GO.

### Preserved `job_runtime` exception

The following exception is copied from the repository status record and is
part of this rollout boundary. Do not restate it as a `job_runtime`
least-privilege claim.

`job_runtime` temporary quarantine is **EFFECTIVE**. The production password
reset completed, the new password was not exposed/captured/stored, and
post-rotation `job_runtime` sessions were verified at `0`. The deployed web
role remains directly verified as `app_runtime`; no active `job_runtime`
consumer has been identified; and health, readiness, and normal authenticated
application load were verified as passing after rotation.

| `job_runtime` quarantine | **PASS** — effective after password rotation; the role remains unbound. |
| `job_runtime` release blocker | **REMOVED** for controlled release with a documented security exception. |
| Provider-level hardening | **OPEN** — permanent role hardening remains required and does not qualify as complete remediation. |

Required post-launch provider hardening remains open: remove
`neon_superuser` membership; enforce `NOLOGIN`, `NOINHERIT`, and
`NOBYPASSRLS`; remove `CREATEROLE`, `CREATEDB`, and `REPLICATION`; remove
obsolete legacy grants; and keep `job_runtime` unbound until completion is
verified.

Do not use `job_runtime` for migrations, application traffic, Clerk mapping,
or rollout verification. Do not claim that this exception proves
`job_runtime` least privilege.

## 2. Exact production sequence

Each stage is a hard gate. The operator records the PASS evidence before
starting the next stage. A STOP condition means pause the rollout, preserve
the evidence, and obtain a new decision; it does not authorize an improvised
repair.

### Stage 1 — Explicitly select Better Auth while #119 is live

Before merging or deploying #120, explicitly set the production environment
variable:

```text
AUTH_PROVIDER=BETTER_AUTH
```

Make this change in the approved production secret/configuration control plane
while #119 is still serving. Do not configure Clerk production credentials or
switch the provider at this stage. If the hosting platform requires a
config-only redeploy for the value to take effect, it must still serve the
#119 artifact and be verified as such.

**PASS:** the production configuration record shows the exact value
`AUTH_PROVIDER=BETTER_AUTH`; #119 remains the live release; Better Auth's
production secret is present; and no Clerk cutover has occurred.

**STOP:** the value cannot be explicitly evidenced, the active artifact is not
#119, the Better Auth secret is missing, or any provider switch is required to
make the application healthy.

### Stage 2 — Verify current production health

Use the exact production HTTPS origin. These checks are read-only and match
the repository's health/readiness routes:

```sh
: "${PROD_BASE_URL:?Set PROD_BASE_URL to the approved HTTPS origin}"

curl --fail --silent --show-error "$PROD_BASE_URL/api/health" \
  | jq -e '.status == "ok" and .service == "shanda-fuel" and .checks.application == "ok"'

curl --fail --silent --show-error "$PROD_BASE_URL/api/readiness" \
  | jq -e '.status == "ok" and .service == "shanda-fuel" and .checks.database.status == "ok"'

test "$(curl --fail --silent --output /dev/null --write-out '%{http_code}' "$PROD_BASE_URL/login")" = 200
```

Capture the redacted response status, `x-request-id`, timestamp, and target
URL. Do not record response bodies containing sensitive data.

**PASS:** health is HTTP 200 with application `ok`, readiness is HTTP 200 with
database `ok`, and `/login` is HTTP 200 while #119 remains healthy.

**STOP:** any non-200 response, readiness not `ok`, database connectivity
failure, unexpected redirect, wrong hostname, or unexplained error/latency.

### Stage 3 — Merge/deploy #120 with Better Auth selected

After Stage 2 PASS and the release-owner approval, merge #120 through the
normal integration path. Do not self-merge. Deploy the exact approved commit
as an immutable production artifact with `AUTH_PROVIDER=BETTER_AUTH` still
selected.

The repository-supported quality commands are the same commands used by CI:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm db:check
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:e2e --workers=1
```

Do not run production migrations from application startup or from a browser.
The hosting control-plane deployment action is intentionally not performed by
this preparation task.

**PASS:** CI is green for the approved SHA; the deployment reports Ready for
that exact SHA; production still has `AUTH_PROVIDER=BETTER_AUTH`; the previous
#119 deployment remains identifiable; and `/api/health`, `/api/readiness`, and
`/login` pass again after deployment.

**STOP:** SHA mismatch, failed CI gate, deployment not Ready, missing required
production environment value, unexpected production configuration change, or
any health/readiness regression.

### Stage 4 — Verify the deployment is additive

First perform public read-only checks again. Then, only with an approved
session acquired through the normal Better Auth HTTPS flow, run the repository
read-only harness. It permits only GET/HEAD and does not run migrations or
business commands:

```sh
: "${SMOKE_BASE_URL:?Set the approved production HTTPS origin}"
: "${SMOKE_TENANT_A_ID:?Set the approved Tenant A UUID}"
: "${SMOKE_STATION_A_ID:?Set the approved Station A UUID}"

SMOKE_ARGS=(
  --environment production
  --confirm-readonly-production
  --base-url "$SMOKE_BASE_URL"
  --tenant-a-id "$SMOKE_TENANT_A_ID"
  --station-a-id "$SMOKE_STATION_A_ID"
)

if [[ -n "${SMOKE_TENANT_B_ID:-}" || -n "${SMOKE_STATION_B_ID:-}" ]]; then
  : "${SMOKE_TENANT_B_ID:?Set SMOKE_TENANT_B_ID with SMOKE_STATION_B_ID}"
  : "${SMOKE_STATION_B_ID:?Set SMOKE_STATION_B_ID with SMOKE_TENANT_B_ID}"
  SMOKE_ARGS+=(
    --tenant-b-id "$SMOKE_TENANT_B_ID"
    --station-b-id "$SMOKE_STATION_B_ID"
  )
fi

APP_ENV=production pnpm smoke:production-readonly -- "${SMOKE_ARGS[@]}"
```

The secure operator mechanism must inject `READONLY_SMOKE_SESSION_COOKIE`
without putting it in argv, shell history, logs, or evidence. The harness
prints redacted JSON evidence and returns non-zero on a required failure.

Also verify that the production-only staging bootstrap route remains absent:

```sh
test "$(curl --fail --silent --output /dev/null --write-out '%{http_code}' \
  "$PROD_BASE_URL/api/internal/staging-auth-smoke-bootstrap")" = 404
```

**PASS:** the exact #120 artifact passes public health/readiness/login, the
read-only harness passes Tenant A and any approved Tenant B denial, the
staging bootstrap route is HTTP 404, and no write-capable route was invoked.
The database is still at `0026`; `0027` has not been applied.

**STOP:** any smoke failure, HTTP 200 for a required cross-tenant denial,
staging bootstrap exposure, write request, wrong deployment, or inability to
prove the pre-migration database state.

### Stage 5 — Run the production `0027` read-only preflight

After Stage 4 PASS, use the approved migration/diagnostic connection only for
read-only inspection. Do not use `app_runtime` or `job_runtime`. Inject the
direct URL through the approved secret mechanism; never put credentials in
chat, a committed file, or evidence.

The following check is a preflight template. Replace only the approved
release-specific expected `0026` journal evidence; do not broaden it to accept
an unknown migration state:

```sh
: "${DATABASE_DIRECT_URL:?Inject the approved direct migration connection securely}"

psql "$DATABASE_DIRECT_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL'
select count(*) = 27 as at_0026
from drizzle.__drizzle_migrations;

select
  to_regclass('app.auth_identities') is null as auth_identities_absent,
  to_regclass('app.staff_number_registry') is null as staff_number_registry_absent,
  to_regclass('app.auth_session_assurance') is null as auth_session_assurance_absent;

select (is_nullable = 'NO') as email_still_required
from information_schema.columns
where table_schema = 'auth'
  and table_name = 'user'
  and column_name = 'email';

select id, tenant_id, invited_name, assigned_role, status, expires_at
from app.staff_invitations
where id = '<EXISTING_PENDING_ATTENDANT_INVITATION_ID>';
SQL
```

The operator must additionally compare the ordered journal tail/hash with the
approved #119/`0026` release evidence. The expected invitation row must be
the existing pending Attendant record, not a newly created record.

**PASS:** exactly the approved pre-`0027` journal state is present; all three
new `0027` tables are absent; `auth.user.email` is still non-nullable; the
existing invitation is present with the recorded ID, Attendant role, and
`PENDING` status; and no SQL write occurred.

**STOP:** journal drift, any `0027` object already present, an unexpected
nullable email column, missing/changed/expired invitation, wrong role or
tenant, any write, or any missing migration-owner evidence.

### Stage 6 — Explicit approval, then apply and verify `0027`

Do not apply the migration until the database owner and release owner have
recorded explicit approval against the successful Stage 5 evidence.

Apply only through the canonical migration path, using the direct migration
connection and the reviewed migration-owner boundary:

```sh
: "${DATABASE_DIRECT_URL:?Inject the approved direct migration connection securely}"
pnpm db:migrate
```

`drizzle.config.ts` prefers `DATABASE_DIRECT_URL` for connecting commands.
Do not supply the direct URL to the deployed app. Do not use a down-migration,
manual `DROP`, manual `DELETE`, or a second migration history.

Immediately after a successful apply, run read-only verification using the
same approved direct connection. Verify at minimum:

```sh
psql "$DATABASE_DIRECT_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL'
select
  to_regclass('app.auth_identities') is not null as auth_identities_present,
  to_regclass('app.staff_number_registry') is not null as staff_number_registry_present,
  to_regclass('app.auth_session_assurance') is not null as auth_session_assurance_present;

select (is_nullable = 'YES') as email_is_nullable
from information_schema.columns
where table_schema = 'auth'
  and table_name = 'user'
  and column_name = 'email';

select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app'
  and c.relname in ('auth_identities', 'staff_number_registry', 'auth_session_assurance')
order by c.relname;

select count(*) as better_auth_identity_rows,
       count(distinct internal_user_id) as distinct_internal_users
from app.auth_identities
where provider = 'BETTER_AUTH';

select id, tenant_id, assigned_role, status, delivery_method
from app.staff_invitations
where id = '<EXISTING_PENDING_ATTENDANT_INVITATION_ID>';

select has_table_privilege('job_runtime', 'app.auth_identities', 'SELECT') as job_runtime_new_table_select,
       has_table_privilege('job_runtime', 'app.staff_number_registry', 'SELECT') as job_runtime_staff_table_select,
       has_table_privilege('job_runtime', 'app.auth_session_assurance', 'SELECT') as job_runtime_assurance_table_select;
SQL
```

The expected results are: `0027` is the new journal entry; all three tables
exist with RLS and FORCE RLS enabled; `email_is_nullable` is true; existing
users have the generated `BETTER_AUTH` identity mappings; the Attendant invite
is unchanged and still pending; and all three `job_runtime_*_select` values
are false. The last result is a narrow check for the new tables only. It is
not a claim that `job_runtime` is least privilege.

**PASS:** migration output and the read-only verification both match the
approved `0027` artifact, the additive objects and grants are correct, the
existing Owner and Attendant records are unchanged, and the narrow
`job_runtime` checks pass.

**STOP:** migration error, journal/hash mismatch, missing RLS/FORCE RLS,
unexpected grant/owner, missing Better Auth mappings, changed invitation,
unexpected `job_runtime` access to a new table, or any need to edit production
rows manually.

### Stage 7 — Configure Clerk production only after approval

After Stage 6 PASS and the recorded security/release approval, configure the
approved Clerk production instance through the provider's production secret
manager:

```text
CLERK_SECRET_KEY=<secure production value>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<secure production value>
```

Keep `AUTH_PROVIDER=BETTER_AUTH` while configuring and validating the Clerk
instance. Configure only the approved production domain/origin and the
required Clerk credential/MFA policy. Do not expose values in the repository,
shell history, logs, screenshots, or evidence.

**PASS:** provider and secret-manager evidence shows the production Clerk
instance and exact application origin are configured; both Clerk variables
are available to the #120 artifact; Better Auth remains the selected runtime
provider; and no user or invitation has been deleted or recreated.

**STOP:** Clerk was configured before approval, wrong instance/origin, missing
secret or publishable key, disabled MFA/reverification policy, or any request
to remove Better Auth before cutover verification.

### Stage 8 — Map the existing Owner internal principal

This is a controlled identity mapping, not a new business user. Use the
reviewed Owner mapping procedure approved with #120:

1. Resolve and record the existing Owner's immutable internal `auth.user.id`,
   active tenant membership, and tenant-scoped `OWNER` assignment.
2. Create or locate the corresponding Clerk production user and record only
   the non-secret Clerk user ID.
3. Add a single `CLERK` identity mapping for that same internal user. Do not
   create a second internal user, change the Owner membership, replace the
   Better Auth mapping, or write directly as `app_runtime`.
4. Verify that the mapping resolves the Clerk provider user ID to the exact
   existing internal Owner ID and that the Better Auth mapping remains.

The current repository exposes the provider-resolution functions but does not
provide a supported production Owner-mapping command. Therefore the reviewed
mapping utility/procedure is a hard precondition. Do not improvise a direct
production `INSERT`; if the approved procedure is not available, STOP.

**PASS:** exactly one `CLERK` mapping resolves to the existing Owner internal
ID; the existing `BETTER_AUTH` mapping remains; the Owner membership,
tenant/scope, role assignment, and audit history are unchanged; and no second
Owner was created.

**STOP:** ambiguous Owner identity, duplicate provider mapping, mapping to a
new internal user, changed membership/role/scope, missing reviewed mapping
procedure, or any failed uniqueness/RLS/authorization check.

### Stage 9 — Re-enroll and verify Owner MFA

With `AUTH_PROVIDER=BETTER_AUTH` still selected, have the real Owner complete
the approved Clerk MFA enrollment/re-enrollment flow. Store no TOTP seed,
backup code, password, session cookie, or recovery secret in evidence.

Verify through the normal Clerk sign-in/reverification experience that:

- the Owner can authenticate with the configured production Clerk identity;
- the Owner completes the required MFA challenge;
- password-only authentication does not satisfy a privileged step-up; and
- Clerk strict MFA/reverification is available for `/api/auth/step-up`.

**PASS:** Owner MFA enrollment is confirmed by the Clerk provider and a
controlled test shows the required MFA/reverification assurance. Better Auth
remains available and `REQUIRE_PRIVILEGED_STEP_UP=true` remains unchanged.

**STOP:** Owner cannot authenticate, MFA is optional/disabled, only password
is accepted for privileged assurance, the Clerk identity is not the mapped
Owner, or any secret/backup code is exposed.

### Stage 10 — Controlled `AUTH_PROVIDER=CLERK` cutover

Obtain the release-owner approval for cutover only after Stages 6–9 PASS.
Change the production selection to:

```text
AUTH_PROVIDER=CLERK
```

Roll the exact approved #120 artifact/configuration through the controlled
window. Keep `BETTER_AUTH_SECRET`, Better Auth tables, and Better Auth identity
rows intact. Do not delete or disable Better Auth as part of #120.

**PASS:** the production runtime explicitly reports/behaves as Clerk-selected;
`/login` presents the Clerk entry; the mapped Owner can sign in; and health and
readiness remain HTTP 200/`ok` after the cutover.

**STOP:** provider selection is ambiguous, Clerk login loops/fails, Owner maps
to the wrong principal, health/readiness regresses, or any request is made to
retire Better Auth in this release.

### Stage 11 — Verify Owner, RLS, and step-up

Run the production read-only harness again where its secure session-cookie
injection is approved for the Clerk session. The harness itself is provider
agnostic at the HTTP-cookie boundary, but the repository's documented
acquisition procedure is Better Auth-specific; if a Clerk session cannot be
injected without changing the harness, use the approved manual browser
read-only check and record that limitation rather than modifying production
code during rollout.

Verify all of the following:

1. Owner resolves to the mapped internal principal and sees only the approved
   tenant/legal-entity scope.
2. Tenant A read access succeeds and an approved Tenant B/station context is
   denied with the expected 403/404; HTTP 200 is a failure.
3. A request to `/api/auth/step-up` for the Owner's tenant succeeds only after
   Clerk strict MFA/reverification and returns the repository's active step-up
   response. Record the redacted status, expiry, request ID, and corresponding
   signed security event; do not record tokens or cookies.
4. A password-only/no-reverification attempt cannot satisfy a privileged
   action. Use only the approved safe smoke action; do not post financial data
   merely to test authorization.

**PASS:** Owner identity, tenant scope/RLS denial, and Clerk MFA-backed
step-up all pass; no cross-tenant data is returned; no unauthorized command
is accepted; and health/readiness remain green.

**STOP:** any cross-tenant read, 200 on a required denial, missing tenant
binding, step-up accepted without strict MFA, privileged action accepted after
assurance expiry, unexpected security event, or any financial/business write
outside the approved smoke action.

### Stage 12 — Convert the existing pending Attendant invite in-place

Do not create a new invitation. Use the existing pending Attendant invitation
record captured in Stage 5.

As the approved Owner/Administrator in the production Staff page, invoke the
named application command:

```text
GenerateManualStaffActivation
```

The command is exposed by `POST /api/staff/commands`; it locks the existing
invitation, reserves a Staff Number, replaces the invitation token hash,
sets `delivery_method = 'MANUAL'`, keeps `status = 'PENDING'`, refreshes its
expiry, and appends the security event
`STAFF.INVITATION_MANUAL_ACTIVATION_GENERATED`. It returns the Staff Number
and one-time activation code once. Transfer those two values only through an
approved private channel; never put them in chat, logs, screenshots, or the
release ledger.

**PASS:** the invitation ID is unchanged; it is still `PENDING`, now
`MANUAL`, still assigned to `ATTENDANT` with the original tenant/station
scope; exactly one Staff Number is reserved for it; the audit event exists;
and no replacement invitation was created.

**STOP:** the row is not pending, the role/scope/tenant differs, a new invite
was created, the command attempts a direct SQL update, the code is shown more
than once, the Staff Number is already assigned, or the activation has expired.

### Stage 13 — Activate via Staff Number and activation code

Using the private handoff, the Attendant opens the production `/join` page and
submits the Staff Number, activation code, and a new password. The supported
route is the named `ActivateManualStaff` command through
`POST /api/staff/commands`; do not use an email invitation flow for this
record.

**PASS:** activation succeeds once; the same invitation becomes `ACCEPTED`;
the Staff Number registry becomes `ASSIGNED`; one new internal identity is
linked to the Clerk provider ID; the membership is active; the original
Attendant station scope and role are present; and replaying the code fails
closed. Record only redacted status and IDs approved for evidence.

**STOP:** activation accepts an invalid/replayed/expired code, creates a
second membership or invitation, changes the assigned role/scope, leaves an
unmapped Clerk identity, or exposes the activation code/password.

### Stage 14 — Attendant, Supervisor, and Finance role smoke

Use named pilot/test accounts approved for this production window. Keep the
checks read-only except for explicitly approved sign-in/reverification and
activation state changes.

| Role | Required smoke | Expected PASS |
| --- | --- | --- |
| Attendant | Sign in with Staff Number and password; open the assigned station/My Shift view; verify no Staff, Settings, tenant-wide Finance, or Owner actions are exposed | Assigned station work is available; out-of-scope reads/actions are denied or absent; no cross-tenant data appears |
| Supervisor | Sign in; open the assigned station operations/read-only workflow; verify station scope and permitted operational navigation | Assigned station scope is available; tenant-wide administration/Finance/Owner actions are denied or absent |
| Finance | Sign in; open the approved Finance/Action Center/report read-only views; verify legal-entity scope | Finance views are available within scope; station/tenant administration and Owner-only actions are denied or absent |

For every denied check, record the HTTP 403/404 or the absence of the
unauthorized action, not sensitive response bodies. Confirm there are no 500s,
redirect loops, missing tenant context, or unexpected role grants.

**PASS:** all three role journeys complete with the expected scope and no
unauthorized access, while health/readiness and the Owner checks remain green.

**STOP:** any role receives broader scope than assigned, an unauthorized
action is accepted, an expected role route is unavailable, a 500 occurs, or
the only way to continue would be a direct data edit or permission bypass.

### Stage 15 — Final GO/NO-GO

The release owner and business/security owner review the evidence bundle in
order. GO requires every stage above to be PASS, all required approvals to be
recorded, and no open STOP condition. The final record must include:

- #120 SHA/deployment ID and the #119 rollback deployment;
- the initial `AUTH_PROVIDER=BETTER_AUTH` evidence and the controlled Clerk
  cutover evidence;
- health/readiness and redacted read-only smoke results before and after the
  cutover;
- `0027` preflight, explicit migration approval, apply output, and verification;
- Owner mapping/MFA/identity/RLS/step-up evidence;
- the unchanged invitation ID, in-place MANUAL conversion, activation result,
  and role-smoke results;
- the preserved `job_runtime` exception and its OPEN provider-hardening
  follow-up; and
- observation-window results, incident owner, and final named GO/NO-GO approvers.

**NO-GO:** any missing approval, failed or incomplete gate, unresolved
identity mismatch, failed RLS/step-up check, failed activation/role smoke,
unexplained health/readiness signal, or any request to conceal an exception.

## 3. Rollback boundary

Rollback is intentionally asymmetric because migrations are forward-only.

| Point of failure | Permitted response | Prohibited response |
| --- | --- | --- |
| Before `0027` is applied | Keep/redeploy the last compatible #119 artifact and restore `AUTH_PROVIDER=BETTER_AUTH` if needed; re-run health/readiness | Do not merge ahead, switch to Clerk, or edit production rows |
| After `0027`, before Clerk cutover | Repoint to the last compatible #120 or #119 artifact only after compatibility review; keep the database at `0027`; select Better Auth | No down-migration, `DROP`, manual delete, or grant broadening |
| After Clerk is configured/mapped, before cutover | Select Better Auth and use the last compatible artifact; preserve the mapping for later reviewed recovery | Do not delete the Clerk identity or overwrite the Better Auth mapping to hide a failure |
| After `AUTH_PROVIDER=CLERK` cutover | Revert the provider selection to Better Auth and/or re-point to a compatible immutable deployment, then verify Owner login, health, readiness, and RLS; involve the incident owner if compatibility is uncertain | Do not make ad hoc database edits, disable MFA/step-up, or retire Better Auth |
| After Attendant activation | Stop new onboarding; preserve accepted identity/membership history; use the named deactivation/revocation command and incident/data-repair procedure if correction is required | Do not delete the user, membership, invitation history, or directly rewrite posted state |

If the migration itself fails, capture the error and migration journal state,
stop, and use the database/provider incident path. Do not blindly rerun it or
attempt a hand-written partial repair. If database availability, corruption,
or compatibility is in doubt, use `backup-restore.md` and
`incident-response.md`; application rollback is not a database rollback.

This runbook is ready for operator review only. No production, Vercel, Clerk,
invitation, migration, or merge action has been performed while preparing it.
