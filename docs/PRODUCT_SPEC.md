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

**UNRESOLVED:** The exact business meaning of “supervisor” still requires owner confirmation. It may mean assigned supervisor, submitting supervisor, accountable supervisor, approving supervisor, or some combination. Agents must not hard-code a new semantic interpretation without confirmation.

### 8.2 Account/customer reference

**UNRESOLVED:** The required reference for account sales, when it is selected, and whether it represents a customer, account, vehicle, driver, purchase order, or another entity requires owner confirmation.

### 8.3 Approved fuel

**UNRESOLVED:** Approved-fuel authorization rules, recipient/reference requirements, and staff-benefit terminology require owner confirmation. Phase 0 must not invent approval policy.

### 8.4 Cash handover/banking

**UNRESOLVED:** Minimum required cash handover, deposit, and bank-reference information requires owner confirmation. Phase 0 should not present stronger banking/custody assertions than current data supports.

### 8.5 Customer account priorities

**UNRESOLVED:** Owner priority among credit, prepaid value, prepaid litres, benefits, limits, vehicles/drivers, and statement content still requires confirmation for the fuller customer lifecycle.

## 9. Permissions and roles

### 9.1 Current confirmed bootstrap behavior

Production first-user provisioning is intentionally restrictive:

- exactly 12 reviewed read-only permissions are expected by the dry-run gate;
- no application role assignment is created during the bootstrap dry run;
- provisioning is one-time and sentinel-controlled;
- the real provision operation requires explicit human approval after dry-run evidence.

### 9.2 Application role model

**UNRESOLVED:** The complete end-state human role/permission matrix is not fully specified in the available conversation. Existing code and database permission definitions must be inspected before extending it.

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

The following remain genuine product questions rather than hidden assumptions:

- final semantic definition of Daily Operations supervisor/accountability;
- account-sale/customer reference requirements;
- approved-fuel policy and terminology;
- minimum cash handover/deposit/bank-reference requirements;
- priority and scope of the full customer account lifecycle;
- complete human application role/permission matrix;
- formal performance/SLO targets;
- which Phase 1 provider integrations are required first and their exact contracts.
