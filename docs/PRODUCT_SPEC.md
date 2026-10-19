# Shanda Fuel — Product Specification

## 1. Purpose and authority

This document is the authoritative product specification for Shanda Fuel unless a newer explicit human instruction supersedes it. It consolidates the confirmed product intent, the current Phase 0 release scope, and the already-discussed Phase 1 direction.

Terminology used here:

- **CONFIRMED** — directly established by the project conversation, implemented behavior, reviewed plans, or verified tests.
- **IMPLICATION** — a reasonable implementation consequence of confirmed requirements. It is not a new product requirement.
- **UNRESOLVED** — a question that still requires a human decision. It must not be silently treated as a requirement.

## 2. Product overview

**CONFIRMED:** Shanda Fuel is an operational management system for a fuel-station business. It is intended to replace fragmented paper, spreadsheet, and ad-hoc operational processes with a single, tenant-aware application covering day-to-day station operations, customer accounts, financial/management views, and owner oversight.

The product is not intended to be a generic ERP. It is centered on the operational truth of a fuel business: stations, shifts, pumps/meters, sales/payment channels, inventory evidence, customers, reconciliations, cash/account activity, and management visibility.

## 3. Problem being solved

**CONFIRMED:** The product must make operational information easier to capture, reconcile, review, and trust without introducing synthetic or misleading business figures. It must reduce ambiguity caused by disconnected paper/Excel workflows and make the current state of a station understandable to an owner or supervisor.

The system must also provide strong tenant and station boundaries so that data for one organisation or station is not exposed to another.

## 4. Target users

### 4.1 Confirmed user groups

- **Owner / senior management** — needs a concise operational picture, trustworthy reports, customer visibility, and final review/oversight.
- **Station supervisor / accountable shift operator** — needs to work through daily operational evidence, reconciliation, and close-out.
- **Station attendants / operational staff** — represented in Daily Operations context and shift workflow.
- **Finance / administrative users** — need customer, cash, settlement, supplier, inventory, and reporting views appropriate to their permissions.

### 4.2 Service principals are not product users

Database principals such as `migration_owner`, `app_runtime`, `diagnostics_readonly`, and `first_user_provisioner` are infrastructure/security roles, not human product roles. Future agents must not confuse database role design with the application’s user/permission model.

## 5. Core organisational model

**CONFIRMED:** The application is multi-tenant and operates with an organisational hierarchy including:

1. tenant / organisation,
2. legal entity,
3. station.

Operational views are expected to run inside an authorised context. A user must not see or act on another tenant’s data merely by changing identifiers.

**CONFIRMED:** Production first-user bootstrap scope is chosen from legitimate database-derived tenant/legal-entity/station options; scope IDs must never be guessed.

## 6. Primary user journeys

### 6.1 Sign in and establish authorised context

**CONFIRMED:** A legitimate user signs in, enters an authorised organisational/station context, reaches protected product routes, can log out, and can later sign in again.

Expected behavior:

- unauthenticated users are not allowed through protected application routes;
- context-required pages clearly state when an organisation/station selection is needed;
- a user cannot obtain another tenant’s information by manipulating route or query identifiers;
- logout returns the user to the unauthenticated state.

### 6.2 Owner overview

**CONFIRMED:** The owner should be able to open the dashboard and product navigation, understand what is available, and move quickly to Daily Operations, Customers, Reports, and other management surfaces.

**CONFIRMED:** The product must not fabricate or synthesize production figures to make the dashboard appear complete. When reliable data is not available, the UI must show a truthful empty/unavailable state.

**CONFIRMED owner home-dashboard purpose:** The default home dashboard answers
“How is the operation performing today, and what needs my attention?” It is an
operational-control and exception-visibility surface, not a broad accounting or
reporting dashboard. Its primary headline metrics/status areas are today’s
total sales, expected cash, actual cash, cash variance, fuel/stock variance,
account/credit sales, unresolved exceptions, and shift approval/close status.

The primary audience is the owner, manager, and Supervisor subject to existing
permissions. The default scope is the user’s authorized/current operational
scope under the existing tenant, legal-entity, and station authorization rules.
When a user can access multiple stations or entities, existing product and
navigation conventions determine selection or aggregation; the dashboard must
not create a new authorization model or expose cross-tenant data.

### 6.3 Daily Operations

**CONFIRMED:** Daily Operations is the operational workspace for a station/day/shift. The established owner workflow covers, at minimum, the following concepts where supported by current data and business logic:

- station, date, and shift context;
- supervisor/accountability context;
- attendants;
- pump/meter readings;
- litres and price evidence;
- customer/account sales;
- POS and EcoCash/payment-channel evidence;
- approved fuel;
- expenses;
- tank dips/inventory evidence;
- deliveries;
- reconciliation;
- variance;
- cash/banking evidence;
- sign-off / close-out context.

**CONFIRMED owner workflow:** Daily Operations uses the sequence Open Shift,
Record Activity, Reconcile, Supervisor Review, and Close Shift. An operator or
cashier records activity and submits the initial reconciliation. A Supervisor
is the person accountable for reviewing the reconciliation, investigating or
resolving ordinary discrepancies where authorised, and approving the close.
The submitter/operator and approving Supervisor must remain distinguishable in
the data model and UI. A manager/admin handles authorised exceptions and
overrides. “Supervisor” has this fixed meaning; only whether approval is
required before close may later be configured by organisation/station policy.

**CONFIRMED Phase 0 constraint:** Daily Operations Phase 0 is primarily a UI/composition and workflow-alignment exercise. It must not invent new accounting, ledger, schema, approval, or write semantics merely to mirror the paper process.

**CONFIRMED:** Operational timestamps that are presented as station times must use the station’s authoritative timezone when one exists. Missing/invalid station timezone data must not silently fall back to a browser-local or guessed timezone.

### 6.4 Customers

**CONFIRMED Phase 0 scope:** Customers provides tenant-authorised, read-oriented list/detail functionality including:

- navigation entry and command/search access;
- customer search;
- customer type and status;
- balances;
- prepaid litres where applicable;
- reservations where applicable;
- recent ledger/activity information;
- responsive list/detail presentation;
- truthful loading, empty, no-match, permission, and error states.

**CONFIRMED:** The Phase 0 Customers work does not add new customer write semantics, schema migrations, RLS changes, or auth changes.

**CONFIRMED:** Money-derived customer values follow the established monetary precision policy. For `NUMERIC(20,4)` money values, API serialization preserves four decimal places; for example `125.3750`, not `125.375`.

### 6.5 Finance and reporting surfaces

**CONFIRMED:** The product navigation includes or is expected to include management surfaces for areas such as:

- Inventory,
- Suppliers,
- Cash,
- Settlements,
- Reports,
- Settings.

Phase 0 acceptance is primarily that these surfaces are reachable, context-aware, truthful about missing data, and free of broken/dead navigation. Their full end-state workflows are not all Phase 0 requirements.

### 6.6 Search and navigation

**CONFIRMED:** The application uses a shared shell with navigation and command/search access. It must behave sensibly across phone, tablet, and desktop widths.

Expected behavior includes:

- current route is understandable;
- navigation children do not open unexpectedly;
- hidden navigation elements are inert;
- account/logout controls remain reachable;
- page headings are not duplicated by local content and the shared shell;
- long tenant/account/context labels wrap or clip safely without horizontal overflow;
- Customers is present in the Phase 0 Finance navigation and command/search palette.

## 7. Functional requirements

### 7.1 Authentication and access

**CONFIRMED:**

- Protected application routes require authentication.
- Tenant/station data access must be authorised, not merely filtered in the UI.
- First-user production bootstrap is a special one-time operational flow and is not a normal application feature.
- First-user bootstrap currently grants a fixed set of 12 reviewed read-only permissions and no application role assignments.
- Real first-user creation must not occur until a read-only dry run is green and an explicit human approval is given.

### 7.2 Tenant isolation

**CONFIRMED:**

- Cross-tenant customer, station, ledger, reservation, and related data exposure is unacceptable.
- Database and application tests must verify tenant isolation where relevant.
- Unauthorized IDs must fail safely and must not reveal another tenant’s data.

### 7.3 Data integrity and truthfulness

**CONFIRMED:**

- Financial/quantity values that require exact decimal semantics must not be casually converted through lossy floating-point representations.
- Dashboard and management summaries must use real data or a truthful unavailable state.
- User-visible station times must use station time, not browser-local time, when the station timezone is available.
- Reconciliation and operational states must not be labelled as banked, settled, profitable, approved, or otherwise final unless the underlying business state supports that claim.

### 7.4 Responsive UI

**CONFIRMED:** The primary product must be usable at representative phone, tablet, and desktop widths. Current final acceptance specifically includes checks around 390 px, 768 px, 1024 px, and 1440 px.

The UI must avoid:

- horizontal overflow,
- clipped primary controls,
- duplicated account/theme controls,
- duplicate page headings,
- dead navigation,
- inaccessible hidden controls.

### 7.5 Accessibility

**CONFIRMED:** Accessibility checks are part of the release validation. Changes must preserve usable labels, keyboard/semantic behavior, and accessible responsive navigation.

## 8. Business rules and domain behavior

### 8.1 Daily Operations accountability

**CONFIRMED:** “Supervisor” means the person accountable for reviewing and
approving the shift/day close. The operator/cashier who records or submits the
close is tracked separately. The fixed workflow is Open Shift, Record Activity,
Reconcile, Supervisor Review, and Close Shift. Manager/admin users handle
authorised exceptions and overrides.

### 8.2 Account/customer reference

**CONFIRMED:** A customer/account is required before an account sale can be
finalized. An external/customer reference is optional by default but must be
captured before finalization when organisation, station, customer, or account
policy requires it. The customer/account relationship itself is never optional.

### 8.3 Approved fuel

**CONFIRMED:** Approved-fuel transactions require an auditable trail including,
where applicable, recipient, authorizer, reason/category, and
authorization/reference. Categories may include staff benefit,
customer-authorized, company/internal use, and other authorized use. Category
labels may be administrator-configurable, but core recipient and authorizer
attribution is mandatory where applicable.

### 8.4 Cash handover/banking

**CONFIRMED:** Cash handover/deposit evidence includes amount, handing-over or
depositing person, receiving/verifying person where applicable, date/time, and
reference. A bank deposit requires a bank/deposit reference. Supporting proof
or attachment is optional by default but may later be made mandatory by policy.

### 8.5 Customer account priorities

**CONFIRMED Phase 1 sequencing:** Customer-account work is prioritized as:
credit and enforceable limits; prepaid monetary value; statements; vehicles
and drivers; prepaid litres; then benefits. The detailed fixed semantics are
recorded in DEC-041.

Credit is disabled unless an explicit positive limit exists. The configured
limit is a hard cap by default and over-limit transactions are blocked. A
future manager/admin override must be explicit, authorized, and audited.
Operators and Supervisors cannot silently change credit limits or policy.

Money-value prepaid is the initial prepaid model. Prepaid litres remain a
separate later balance model, with no automatic conversion. Statements default
to monthly calendar periods in the applicable tenant/station timezone and are
reporting artifacts only: they do not post accounting entries, record
payments, or mutate balances. Customer transactions use the normal applicable
station selling price; customer-specific pricing is a later bounded contract.

Vehicle/driver restrictions are optional and disabled by default. If enabled,
eligibility is required before finalization and any exception is an explicitly
authorized, audited manager/admin action. Benefits are disabled by default and
remain lowest priority; they cannot block the core customer capabilities and
cannot be redeemed as cash when later implemented.

Customer records may contain invoicing/contact/reference metadata, but no new
tax calculation or policy is introduced. Phase 1 uses one operational currency
per tenant, persists currency identifiers where needed, and does not implement
FX or mixed-currency balances. Customer states are `ACTIVE`, `SUSPENDED`, and
`CLOSED`; historical customers are not hard-deleted, and suspended/closed
customers cannot initiate new account transactions.

### 8.6 Shift/day close summary

**CONFIRMED:** The close summary answers “Is this shift clean, and if not, what
needs attention?” It surfaces, where applicable, total sales, sales by payment
method, account/credit sales, expected and actual cash, cash variance,
expenses, fuel/stock variance, unresolved exceptions, and Supervisor
approval/sign-off state. Required reconciliation and audit information cannot
be hidden by configuration.

### 8.7 Fixed semantics, configurable policy

**CONFIRMED:** Core workflow semantics, security, audit integrity, tenant
isolation, accounting integrity, and actor attribution are fixed. A small set
of explicit policy settings may control optional behavior such as whether
Supervisor approval is required at a station, whether account references are
required, available approved-fuel categories, whether deposit proof is
mandatory, variance-alert thresholds, optional close-summary sections, optional
home-dashboard sections, display ordering, and station-specific cards.
Required security, reconciliation, exception, and authorization behavior cannot
be configured away. The home dashboard must use existing supported reporting
contracts where possible and must show truthful unavailable states when a
required source fact is not yet available; it must not add tax, GL,
profitability, or other accounting calculations merely for presentation.
Do not introduce a generic arbitrary workflow/rules engine merely to support
these settings.

## 9. Permissions and roles

### 9.1 Current confirmed bootstrap behavior

Production first-user provisioning is intentionally restrictive:

- exactly 12 reviewed read-only permissions are expected by the dry-run gate;
- no application role assignment is created during the bootstrap dry run;
- provisioning is one-time and sentinel-controlled;
- the real provision operation requires explicit human approval after dry-run evidence.

### 9.2 Application role model

**UNRESOLVED:** The complete end-state human role/permission matrix is not fully specified in the available conversation. Existing code and database permission definitions must be inspected before extending it.

**CONFIRMED customer-account authorization:** Within the customer lifecycle
boundary, Owner/Admin manage customer configuration, credit limits, prepaid
configuration, and lifecycle transitions subject to audit. Supervisors may
review/use eligible accounts but may not alter credit/prepaid policy without a
separate explicit permission. Operators may select/use eligible customers in
authorized operational workflows but may not modify financial/account
configuration. This does not silently resolve the broader application role
matrix or authorize a permission/migration change without that review.

Do not infer human product roles from PostgreSQL service principals.

## 10. Integrations and external services

### 10.1 Confirmed platform services

- Vercel hosts the production web application.
- Neon provides production PostgreSQL.
- Cloudflare R2 is used for private object/recovery storage.

### 10.2 Provider/business integrations

**Phase 1 / later:** Broader provider integrations have been discussed as future work but are not a Phase 0 release requirement. Exact providers and business behavior must come from recorded plans/requirements before implementation.

## 11. Data requirements

The current product model includes or strongly implies data for:

- tenants/organisations,
- legal entities,
- stations and station timezone,
- users and authorised scope,
- pumps/meters and reconciliation evidence,
- shifts/daily operational records,
- customers/accounts,
- balances and ledger/activity,
- prepaid litres,
- reservations,
- inventory/tank evidence,
- deliveries,
- payment/cash/settlement evidence,
- expenses,
- reports and management summaries,
- audit/security events.

**IMPLICATION:** Agents should prefer the existing canonical schema and migrations over creating parallel models for concepts that already exist.

## 12. Important UI/UX behavior

### 12.1 Shared shell

**CONFIRMED:** Page titles are owned by the shared shell where that pattern is established. Feature pages should not reintroduce duplicate local headings.

### 12.2 Empty and context-required states

**CONFIRMED:** A truthful empty/context-required state is preferred over fake data or a broken page. Copy should tell the user what context or data is missing without exposing internal security detail.

### 12.3 Mobile and tablet behavior

**CONFIRMED:** Navigation drawer/rail behavior, primary-action reachability, long-context wrapping, and no-horizontal-overflow behavior are release criteria.

### 12.4 Theme behavior

**CONFIRMED:** Light and dark themes are part of final browser review. Agents should preserve existing theme controls rather than creating duplicates.

## 13. Edge cases already established

- Missing organisation/station context.
- Unauthorized tenant or entity identifiers.
- Empty customer lists.
- Customer search with no match.
- Customer permission/error states.
- Long context/account names on smaller screens.
- Missing or invalid station timezone.
- First-user bootstrap already consumed versus still available.
- First-user dry run must prove zero writes and an unchanged bootstrap sentinel.
- Temporary provisioning credential cleanup must happen on normal completion and abnormal failure.
- Provider-managed PostgreSQL role membership may differ from local PostgreSQL defaults and must be explicitly preflighted.

## 14. Non-functional requirements

### 14.1 Security

- Enforce tenant isolation in the database/application boundary, not only in UI filtering.
- Preserve Force RLS and reviewed policy behavior.
- Do not expose secrets in logs, command-line arguments, committed files, or generated documentation.
- Security-definer functions must have controlled ownership and fixed search paths.
- Bootstrap access must fail closed on unexpected role/ACL/provider-membership drift.
- Production access changes require explicit review and evidence.

### 14.2 Reliability

- Database migrations must be deterministic and verifiable.
- Production migrations are not assumed to run automatically with deploys.
- Critical release procedures must fail closed rather than continue after a failed precondition.
- Dry runs and integration tests must distinguish product failures from environment/harness failures.

### 14.3 Performance

**CONFIRMED at a high level:** User-facing operational and customer screens should be responsive enough for normal station/management use.

**UNRESOLVED:** No formal latency, throughput, or scale SLO is established in the available conversation. Do not invent one.

### 14.4 Observability

Observability definitions and local validation exist, but the desired native production semantics are constrained by the current hosting plan. This is an explicit release exception and must not be misreported as fully passed.

## 15. Known constraints

- The production PostgreSQL environment is Neon-managed PostgreSQL 18.x and has provider-managed role behavior.
- Production migrations require an explicit operational step.
- Some security/release checks depend on exact database ownership and role setup; local harnesses must reproduce these conditions correctly.
- Browser and database tests may be blocked inside restricted agent sandboxes; this is not by itself evidence that the product is broken.
- Release work must use isolated branches/worktrees and must not casually modify the dirty primary worktree.
- The project currently has narrow release exceptions for observability and one rate-limit end-to-end behavior; neither should be relabelled as PASS.
- A dev-only transitive dependency advisory currently has no fixed upstream version and is handled by a time-bounded exception rather than being ignored.

## 16. Scope boundaries

### 16.1 Phase 0 release scope

Phase 0 is intended to get a trustworthy first owner-ready product into production, including:

- secure first-user access,
- shared shell/navigation polish,
- Customers read-oriented experience,
- Daily Operations composition/alignment and correctness fixes,
- truthful dashboard/management states,
- final database/browser/security validation,
- owner review and handoff.

Phase 0 should fix genuine P0/P1 issues found during final QA, but it should not expand into every future workflow.

### 16.2 Explicitly deferred to Phase 1 or later

The conversation has explicitly deferred substantial work such as:

- full customer lifecycle policy/workflows,
- richer approved-fuel policy and approval lifecycle,
- full expense approval/allocation lifecycle,
- complete cash custody and banking workflow,
- provider integrations,
- interrupted delivery/calibration/transfer workflows,
- richer profitability and export workflows,
- Action Center/alerts,
- offline/interrupted-draft synchronization,
- full editable settings behavior,
- broader general-ledger/accounting features,
- tax-treatment rules.

These are not to be pulled into Phase 0 unless a specific human instruction promotes them.

## 17. Overall acceptance criteria

A release is acceptable only when, where applicable:

1. Authentication and authorised context selection work with a legitimate user.
2. Protected routes remain protected and logout/re-login works.
3. Tenant isolation is verified by database/integration tests.
4. Database migrations and schema checks pass in the intended PostgreSQL version/ownership model.
5. No release-critical RLS, ACL, auth, or bootstrap security regression exists.
6. Dashboard/management views do not show synthetic production figures.
7. Daily Operations presents station-local time correctly and does not invent unsupported business semantics.
8. Customers list/detail/search and tenant-aware summaries work with exact money serialization.
9. Navigation/search works across phone, tablet, and desktop without dead links or obvious overflow/clipping.
10. Relevant unit, integration, browser, accessibility, typecheck, lint, formatting, and build gates pass or have an explicitly recorded exception.
11. Production is verified at the exact approved release SHA.
12. Final owner review finds no unresolved P0/P1 issue.
13. Owner handoff uses the production URL only: `https://fuel.shandahr.com`.

## 18. TODO — requires confirmation

The following remain genuine product or technical questions rather than hidden
assumptions:

- complete human application role/permission matrix;
- detailed accounting, ledger, tax, credit-control, and authorization policies
  for the customer, approved-fuel, cash, and close workflows;
- formal performance/SLO targets;
- which Phase 1 provider integrations are required first and their exact
  contracts.

The owner decisions for Supervisor accountability, account-sale references,
approved-fuel auditability, cash custody minimums, customer-account sequencing,
and close-summary content are recorded above and are no longer unresolved.


### Unified expense integration — 2026-10-19

Approved unified expense direction: one independent expense identity combines incoming finance approvals/settlements/attachments/recognition with immutable fact versions and optional shift association. Payment remains separate from expense recognition. Reconciliation must use exact immutable source versions.
