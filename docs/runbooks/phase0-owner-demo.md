# Phase 0 owner demonstration

This runbook demonstrates the completed Phase 0 product using a local or
approved staging environment with synthetic data. It is not a production
provisioning, migration, or data-creation procedure. Do not use production
credentials or create production demo data.

## Demonstration prerequisites

- A running build from the Phase 0 candidate under review.
- A synthetic authenticated owner/manager or supervisor account with an
  authorized tenant, legal entity, and station scope.
- Synthetic station data sufficient to show a station-local timezone, a
  current or recent shift, posted sales/payment evidence, reconciliation
  evidence, and customer summary records.
- If the environment has no reliable source facts, demonstrate the truthful
  empty, unavailable, context-required, permission, or error state instead of
  entering invented figures.
- A browser viewport pass at approximately 390px, 768px, 1024px, and 1440px.

## Hosted synthetic setup

The hosted demo uses the same normal migrations and fixture, but with the
explicit non-production `APP_ENV=demo`. The operator supplies the hosted Neon
`DATABASE_URL` through the approved private secret workflow; it is never put
in argv, committed files, logs, or chat. The setup refuses `APP_ENV=production`
and refuses any database name other than `shanda_fuel_demo` before any
migration or seed writes. The setup first reuses the reviewed environment
bootstrap SQL files to create only the five roles required by the migrations:
`migration_owner`, `app_runtime`, `job_runtime`, `diagnostics_readonly`, and
`first_user_provisioner`. Runtime roles remain `NOLOGIN` and least privilege;
the first-user provisioner retains its canonical restricted `LOGIN` shape.

From the repository root, with the private environment values already loaded:

```bash
export APP_ENV=demo
export APP_URL='<approved non-production HTTPS demo URL>'
export DATABASE_URL='<enter through the approved private secret workflow>'
export BETTER_AUTH_SECRET='<demo secret from the approved secret store>'
export AUDIT_SIGNING_KEY_ID=owner-demo
export AUDIT_SIGNING_KEY='<demo signing secret from the approved secret store>'
bash scripts/demo/setup-owner-demo.sh
```

The setup runs the role prerequisite bootstrap and then `drizzle-kit migrate`,
then asks for the synthetic owner password through hidden terminal input. It
prints only non-secret identifiers
and the email `demo-owner@tei-oils.example.test`. The hosted seed is
idempotent: a completed `tei-oils-owner-demo` tenant is reused; it does not
create another tenant or sale. To re-seed/reset the demo password while
preserving the same synthetic dataset, run:

```bash
APP_ENV=demo DATABASE_URL="$DATABASE_URL" BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  AUDIT_SIGNING_KEY_ID="$AUDIT_SIGNING_KEY_ID" AUDIT_SIGNING_KEY="$AUDIT_SIGNING_KEY" \
  bash scripts/demo/reset-owner-demo.sh
```

This remains a demo-only operation and refuses production. It does not touch
production DNS, production credentials, or production data.

## Local synthetic setup

The repository includes a local-only fixture path. It uses the normal
PostgreSQL migrations, Better Auth credential account, tenant authorisation,
RLS, and reporting API; it does not enable a demo bypass and refuses
non-loopback database hosts.

From the repository root, with the disposable PostgreSQL server already
running, use a shell with no production variables loaded:

```bash
export DEMO_DB_NAME=shanda_fuel_first_user_test
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=wolftech
export PG_BIN=/opt/homebrew/opt/postgresql@16/bin
bash scripts/demo/reset-owner-demo.sh
export DATABASE_URL=postgresql://postgres@127.0.0.1:55432/$DEMO_DB_NAME
export APP_ENV=local APP_URL=http://127.0.0.1:3101
export BETTER_AUTH_SECRET='<local-only 32+ character secret>'
export AUDIT_SIGNING_KEY_ID=owner-demo-local
export AUDIT_SIGNING_KEY='<local-only signing secret>'
bash scripts/demo/seed-owner-demo.sh
```

`seed-owner-demo.sh` asks for the synthetic password through hidden terminal
input, requires at least 12 characters, keeps it process-local, and unsets it
on exit. The account email is `demo-owner@tei-oils.example.test`; the operator
must provide the hidden password to the owner separately. No password is
committed or printed.

Start the app against that same local database:

```bash
APP_ENV=local APP_URL=http://127.0.0.1:3101 \
DATABASE_URL="$DATABASE_URL" BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
AUDIT_SIGNING_KEY_ID="$AUDIT_SIGNING_KEY_ID" AUDIT_SIGNING_KEY="$AUDIT_SIGNING_KEY" \
pnpm dev -- --hostname 127.0.0.1 --port 3101
```

Open `http://127.0.0.1:3101/login`, sign in with the synthetic email and the
hidden password just entered, then append the `dashboardPath` query printed by
the seed command to the local URL. The seed output contains only non-secret
tenant, legal entity, station, date, and sale identifiers.

To reset the local demo, stop the local app and run the same
`bash scripts/demo/reset-owner-demo.sh` command again, then reseed. The reset
script refuses non-loopback hosts and database names outside the named
disposable demo databases.

## Exact demo sequence

1. **Login and authenticated shell**

   Open the approved non-production URL and sign in with the synthetic account.
   Confirm the shared shell, account context, navigation groups, and visible
   scope are present. Do not use a database service principal as a product
   user.

2. **Home/dashboard**

   Open `/`. Confirm that the dashboard is operational-control oriented and
   truthful: supported sales, cash, account/credit, variance, exception, and
   approval facts are shown when available; otherwise the UI says that the
   context or source fact is unavailable. Confirm no fabricated tax, GL,
   profit, or synthetic production figure is presented.

3. **Scope behavior**

   Select the authorized organisation/legal-entity/station context using the
   existing context controls. Confirm that a user cannot use a URL parameter
   to reveal another tenant or unauthorized station. For a multi-scope user,
   show the existing selection/aggregation behavior rather than inventing a
   new scope rule.

4. **Daily Operations**

   Open `/operations/daily`. Show the station/day/shift workspace, current
   operational state, eligible controls, and any available meter, price,
   attendant, reconciliation, or exception context. Confirm displayed times
   use the station timezone and that missing/invalid timezone data renders a
   truthful unavailable value.

5. **Supported sales and payment evidence**

   From the available Phase 0 operational/reporting surface, show posted sales
   and payment-method evidence. Account/credit evidence must remain visibly
   distinct from cash and ordinary sales. Do not demonstrate an unimplemented
   customer lifecycle write or invent accounting treatment.

6. **Customers**

   Open `/customers`. Search for a synthetic customer, show type/status,
   balance/activity or prepaid-litre information that exists in the fixture,
   then open `/customers/<customerId>`. Confirm loading, empty, no-match,
   permission, and error states are truthful when exercised. Phase 0 Customers
   is read-oriented; do not present lifecycle writes as complete.

7. **Reconciliation**

   Open the available station reconciliation route, for example
   `/stations/<stationId>/reconciliations` or the linked reconciliation from
   Daily Operations. Demonstrate the supported evidence and state transitions
   using synthetic data. Confirm that stale/conflicting actions are rejected
   rather than silently overwriting authoritative history.

8. **Shift close and review behavior**

   Where the environment has the reviewed workflow fixture, show the existing
   submit/review/approval state and distinct actor evidence. Treat unresolved
   or unsupported close/cash semantics as unavailable or Phase 1 work; do not
   label data as banked, settled, approved, or final without the underlying
   state.

9. **Permission and security behavior**

   Repeat one read with an authorized account and one with a deliberately
   unauthorized synthetic account or scope. Confirm the server returns the
   permission/context state and does not leak another tenant's data. Do not
   weaken permissions to make the demo proceed.

10. **Responsive/browser usability**

    Repeat the dashboard, Daily Operations, and Customers views at the four
    required widths. Confirm navigation remains reachable, controls do not
    overlap or overflow, headings are not duplicated, and keyboard/semantic
    labels remain usable.

11. **Logout and re-login**

    Log out, confirm protected routes no longer expose authenticated content,
    then sign in again and confirm the authorized scope is restored. Do not
    retain credentials in screenshots, recordings, browser exports, or chat.

## Owner acceptance checklist

- [ ] Login, logout, and re-login work for the synthetic owner/supervisor.
- [ ] Dashboard answers what is happening today and what needs attention.
- [ ] No unsupported or fabricated financial/accounting figures appear.
- [ ] Tenant, legal-entity, and station scope behavior is understandable and
      fail-closed.
- [ ] Daily Operations uses station-local time and presents truthful states.
- [ ] Supported customer list/detail/search behavior is usable and exact-money
      values retain their intended scale.
- [ ] Reconciliation evidence and supported review/approval states are clear.
- [ ] Permission-denial behavior is visible without data leakage.
- [ ] Responsive and accessibility checks are acceptable at the target widths.
- [ ] Phase 1-only behavior is not represented as delivered Phase 0 behavior.
- [ ] Any P0/P1 issue is recorded before owner acceptance is signed off.

## Intentional Phase 0 limitations

- Customers are read-oriented; full lifecycle writes, credit policy changes,
  prepaid configuration, and customer status mutations are Phase 1.
- Full cash custody/banking, richer approval semantics, complete exception
  actioning, and broader reporting/accounting depth are not implied by this
  demonstration.
- Tax, general-ledger, FX, profitability, negotiated customer pricing,
  vehicle/driver restrictions, benefits, offline workflows, alerts, and broad
  provider integrations are not Phase 0 deliverables.
- Dashboard or report facts that lack an authoritative source must remain
  unavailable/context-required rather than being approximated.

## Phase 1 already prepared or in progress

- M4/T01 backend/data-gap audit and bounded dashboard/reporting preparation.
- M4/T02 supported operational-control dashboard slice.
- M4/T03 bounded Daily Operations contract decomposition.
- M5/T01/M5/T02 customer lifecycle semantics and the bounded credit/activity
  guard slice, subject to their documented permission, migration, and remaining
  contract gates.

## What we delivered

Phase 0 provides a tenant-aware, responsive operational shell with truthful
dashboard/reporting states, station-local Daily Operations composition,
read-oriented Customers list/detail/search and exact money serialization,
supported reconciliation and cash/reporting surfaces, and server-enforced
permission and scope boundaries. Release completion still depends on the
separate production first-user authority, deployment, exact-SHA verification,
and owner-acceptance gates.
