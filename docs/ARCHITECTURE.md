# Shanda Fuel — Architecture

## 1. Purpose

This document records the architecture already established for Shanda Fuel. It is descriptive, not a redesign proposal. Future agents should preserve these boundaries unless an explicit human instruction or a reviewed architectural decision changes them.

Use the following labels where uncertainty matters:

- **CONFIRMED** — established by implementation/review evidence in the project conversation.
- **INFERRED** — strongly suggested by repository structure or tooling discussed, but should be verified in code before major changes.
- **UNRESOLVED** — not sufficiently established to be treated as architecture.

## 2. High-level architecture

**CONFIRMED:** Shanda Fuel is a TypeScript web application with a Next.js/React frontend and server-side application/API code in the same repository. It uses PostgreSQL as the system of record and relies heavily on database authorization boundaries for multi-tenant safety.

Production platform:

- **Web hosting:** Vercel.
- **Database:** Neon PostgreSQL 18.x.
- **Private object/recovery storage:** Cloudflare R2.
- **Production URL:** `https://fuel.shandahr.com`.

The application is organized around a multi-tenant organisational hierarchy:

```text
Tenant / Organisation
    └── Legal Entity
         └── Station
              └── Operational data (shifts, meters, inventory evidence, etc.)

Tenant-scoped customer/finance/reporting data is accessed through authorised
application/database paths and must not cross tenant boundaries.
```

## 3. Frontend architecture

### 3.1 Framework and application structure

**CONFIRMED:** The frontend is a Next.js application using React and TypeScript. Repository paths discussed in the project use the `src/app/...` structure, indicating the Next.js App Router.

**CONFIRMED:** The application has a shared product shell that owns key page-level composition such as:

- page headings/metadata,
- primary navigation,
- account controls,
- responsive mobile/tablet/desktop navigation,
- command/search navigation.

Feature pages should compose inside the shared shell rather than recreate global headings or navigation.

### 3.2 Navigation

The navigation model includes operational and management areas such as:

- Dashboard,
- Daily Operations,
- Customers,
- Inventory,
- Suppliers,
- Cash,
- Settlements,
- Reports,
- Settings.

Customers is part of the Finance-oriented navigation and command/search experience in the current Phase 0 candidate.

### 3.3 Responsive composition

**CONFIRMED:** Responsive behavior is a first-class release constraint. Current acceptance includes representative widths around:

- 390 px,
- 768 px,
- 1024 px,
- 1440 px.

The shared shell and feature modules must avoid horizontal overflow, duplicate controls, unreachable primary actions, and hidden-but-interactive navigation elements.

### 3.4 Date/time presentation

**CONFIRMED:** Station-facing operational timestamps must use the authoritative station timezone when available. A station timezone is already present in station data (`app.stations.timezone`) and is available to Daily Operations through station context.

The UI must not infer station timezone from browser location, locale, address, or a hard-coded value. Missing/invalid timezone should render a truthful unavailable state rather than silently substituting browser-local time.

### 3.5 Exact decimal presentation

**CONFIRMED:** Money-derived values use exact decimal semantics. Current Customers behavior uses the existing money policy to preserve the scale of `NUMERIC(20,4)` values at the API boundary, including values such as `125.3750`.

Agents should not introduce lossy `Number` conversions for precision-sensitive values without confirming that the existing contract permits it.

## 4. Backend architecture

### 4.1 Server-side application code

**CONFIRMED:** Backend/application behavior is implemented inside the Next.js repository rather than in a separately discussed service repository. Route handlers and feature modules provide server-side read/write behavior.

Examples referenced in project work include tenant-authorised Customers APIs and server-side Daily Operations logic.

### 4.1.1 Operational actors and bounded policy configuration

**CONFIRMED:** Daily Operations must represent the operator/submitter and the
Supervisor approver as distinct actors. The Supervisor has fixed review and
close-approval semantics; manager/admin exception handling is a separate
authorised responsibility. Account-sale customer identity, approved-fuel
recipient/authorizer attribution, cash custody attribution, and required audit
evidence are not optional tenant settings.

Configuration may control bounded policy choices such as whether approval is
required before close, whether an account reference or deposit proof is
mandatory, available approved-fuel categories, variance thresholds, and
optional close-summary sections. These settings must not weaken tenant
isolation, authorization, audit, accounting, reconciliation, or actor
attribution, and do not justify a generic workflow engine.

### 4.2 API approach

**CONFIRMED:** APIs are expected to enforce authorisation at the server/database boundary. Browser route parameters or IDs are not trusted as sufficient authorisation.

Customers Phase 0 includes a read-oriented API surface such as the customer summary route. The real PostgreSQL integration coverage verifies that summary behavior against database data rather than relying only on browser mocks.

### 4.3 Domain/module organisation

**INFERRED from paths discussed:** Feature code is grouped into domain modules under `src/modules/...`, while platform/security/database behavior sits under `src/platform/...`.

Examples from the conversation include:

- `src/modules/customers/...`
- `src/modules/forecourt/...`
- `src/platform/db/...`
- `src/platform/security/...`

Agents should inspect the current tree before adding new top-level abstractions.

## 5. Database architecture

### 5.1 Database and migration tooling

**CONFIRMED:** PostgreSQL is the canonical data store. Production is Neon PostgreSQL 18.x. Local security/integration verification has also used PostgreSQL 18.6.

**CONFIRMED:** The repository uses Drizzle tooling for schema/migration workflows.

**CONFIRMED:** Production migrations are an explicit release operation; they are not assumed to run automatically when the web application is deployed.

### 5.2 Migration history

The current migration set referenced by verification contains migrations `0000` through `0021` (22 migrations total at the documented snapshot).

Migration `0021_security_first_user_provisioning.sql` is security-critical. In production it has already been applied and recorded with the expected hash. It must not be re-run merely because a deployment occurs.

### 5.3 Multi-tenant data protection

**CONFIRMED:** PostgreSQL Row-Level Security is part of the tenant isolation model, and security-critical tables use Force RLS where required.

Application-level filtering is not a replacement for RLS/authorisation. Tests must verify both positive access and negative/cross-tenant behavior where relevant.

### 5.4 Ownership-sensitive database behavior

**CONFIRMED:** Some security-definer functions/triggers depend on being owned by the expected migration/database role. Local tests can produce false application failures if migrations are applied by the wrong local role.

A previously observed A3 meter-exception HTTP 500 was proven to be a harness/ownership problem: migrations had been applied as the local OS user instead of the expected migration owner. With the correct role/UTC/bootstrap setup, both the candidate and exact main passed the focused A3 tests.

Agents must therefore reproduce expected ownership/role prerequisites before classifying a security-definer failure as a product defect.

## 6. Authentication and authorization

### 6.1 Application authentication

**CONFIRMED:** The application uses Better Auth (evidenced by test/runtime configuration discussed in the project). Protected routes require authentication.

**UNRESOLVED:** The complete end-state human role matrix is not fully documented in the conversation. Existing application permission definitions must be inspected before adding or changing human roles.

### 6.2 Database service principals

The project distinguishes infrastructure principals from product users. Important database roles include:

- `migration_owner` — owner/migration authority used for controlled schema/security operations.
- `app_runtime` — normal application database runtime role.
- `diagnostics_readonly` — supplemental diagnostics principal; intentionally restricted from auth/sentinel internals.
- `first_user_provisioner` — tightly constrained bootstrap principal used only for first-user provisioning.
- `job_runtime` — defined in repository bootstrap material as a background-worker role, but its current production existence must not be assumed without catalog evidence.

### 6.3 First-user provisioning architecture

**CONFIRMED:** First-user production access uses a dedicated, security-reviewed bootstrap system introduced by migration 0021.

Key properties:

- one-time bootstrap controlled by a sentinel;
- dedicated `first_user_provisioner` role;
- restricted security-definer API/functions;
- fixed permission allowlist;
- production scope discovered from legitimate database options;
- dry-run must occur before real provisioning;
- dry-run is read-only and must prove zero writes and unchanged sentinel state;
- real provisioning requires explicit human approval;
- the temporary provisioner credential must be cleared (`PASSWORD NULL`) on normal and abnormal exits.

### 6.4 Neon PostgreSQL 18 provider membership

**CONFIRMED:** Neon/PostgreSQL 18 creates an exact provider-managed membership relationship involving `first_user_provisioner` and `migration_owner`. The project evaluated attempts to revoke/recreate/avoid this and selected a fail-closed preflight that accepts only the exact reviewed provider membership shape.

Do not casually “fix” this by recreating roles, using `cloud_admin`, using `neon_superuser`, or adding persistent elevated credentials.

### 6.5 Evidence-principal split

**CONFIRMED:** Production security evidence is intentionally gathered with different principals rather than granting one diagnostics role broad access.

- `migration_owner` / approved admin evidence: catalogs, role attributes, ownership, ACLs, migration journal/hash, RLS/policies, helper ownership/search paths, sentinel/operation-grant state, counts/existence where appropriate.
- `first_user_provisioner`: legitimate scope options, bootstrap identity existence, fixed permission allowlist, and dry-run behavior.
- `app_runtime` plus an appropriate negative-access check: verifies the normal runtime cannot execute bootstrap helpers.
- `diagnostics_readonly`: supplemental only and intentionally lacks auth/sentinel privileges.

This split preserves protection of password hashes, sessions, verification data, and bootstrap internals.

## 7. Production connection handling

### 7.1 Secret-handling constraint

**CONFIRMED:** Database URLs/passwords must not be exposed in chat, committed files, `.env` files, generated credential files, logs, or process argument lists.

Production operator credentials are supplied by the human operator through a hidden terminal input and held only in the operator process environment.

### 7.2 psql 16 compatibility

**CONFIRMED:** Homebrew `psql` 16 does not treat a URI stored in `PGDATABASE` as a connection URI. The initial reviewed operator approach therefore fell back to the local socket.

The corrected design parses the URL using a standard URL parser and maps
approved decoded values into process-local libpq environment variables such as:

- `PGHOST`,
- `PGPORT`,
- `PGDATABASE`,
- `PGUSER`,
- `PGPASSWORD`,
- explicitly allowlisted TLS/query-derived variables.

`PGDATABASE` receives only the decoded database name; a full URI is never
placed in `PGDATABASE`. The connection URI/password remains out of `psql`
argv and is not persisted.

### 7.3 Fail-closed connection parsing

The parser has been reviewed to reject:

- unsupported query parameters,
- duplicate supported query parameters,
- simultaneous `ssl` and `sslmode`, regardless of order,
- explicit empty ports,
- nonnumeric ports,
- out-of-range ports,
- duplicate ports,
- malformed required URI components.

Percent-decoding and valid host/port propagation are preserved.

## 8. First-user helper ACL verification

**CONFIRMED:** First-user helper function ACL verification uses exhaustive
`pg_proc` ACL-grantee validation that rejects unexpected `EXECUTE` grantees.
The independent Access Review is GREEN, and the production flow does not
require an arbitrary unrelated-role diagnostic principal.

No production role should be created merely to satisfy a diagnostic spot check.

## 9. Storage

**CONFIRMED:** Cloudflare R2 is used for private production/recovery object storage.

**UNRESOLVED:** The full user-facing object/document model is not established in the conversation. Agents should inspect existing storage abstractions before extending it.

## 10. Background jobs

**INFERRED/partially confirmed:** Repository bootstrap material includes a `job_runtime` database role and deployment documentation refers to a background-worker role. The full set of background jobs and runtime deployment topology is not established in the available conversation.

Do not assume `job_runtime` exists in production without catalog evidence.

## 11. Deployment architecture

### 11.1 Web deployment

**CONFIRMED:** Production is deployed on Vercel. The project uses an exact release SHA as a release identity and verifies that the production deployment points to that approved SHA.

### 11.2 Production URL

Owner handoff uses only:

`https://fuel.shandahr.com`

Preview/deployment-specific URLs are not owner handoff URLs.

### 11.3 Database deployment

Production database migration is a separate controlled operation. A successful Vercel deployment does not imply a migration has run.

### 11.4 Release gating

Release gates include, where applicable:

- exact source SHA and clean-worktree checks;
- migration hash/state checks;
- RLS/policy/helper ownership/ACL checks;
- unit/type/lint/build checks;
- integration and browser checks;
- production deployment health/readiness;
- exact production release SHA verification;
- authenticated smoke;
- owner acceptance.

## 12. Testing architecture

### 12.1 Unit tests

**CONFIRMED:** Vitest is used for unit/integration tests. Current verified candidate work has hundreds of unit tests, including Customers and security-focused suites.

### 12.2 Integration tests

A dedicated local PostgreSQL 18 cluster has been used for security/database verification. Integration test correctness depends on reproducing:

- the expected PostgreSQL major version,
- UTC where required,
- bootstrap/test roles,
- migrations applied by the expected migration owner,
- correct fixture scope.

Provisioning-specific integration suites are intentionally opt-in and require explicit environment/database fixtures. Their skip state must not be misreported as a product pass/fail without context.

### 12.3 Browser tests

**CONFIRMED:** Playwright is used for browser/E2E tests, including navigation, Customers, Daily Operations, accessibility-related flows, and responsive shell behavior.

Sandbox restrictions can prevent local server binding or artifact writes. Such restrictions are environmental blockers, not product evidence.

### 12.4 Accessibility and responsive verification

Accessibility and responsive checks are part of Phase 0 release validation. Browser checks should cover phone, tablet, and desktop layouts and both light/dark themes where relevant.

## 13. Observability and rate limiting

### 13.1 Observability

Local observability definitions/panels/tests are reported as passing, but the exact desired production-native semantics are constrained by the current Vercel plan. This is a documented temporary launch exception, not a PASS.

### 13.2 Rate limiting

Rate-limit implementation is reported as passing, but one staging E2E path is blocked because an upstream provider intercepts the relevant request before the application behavior can be observed. This remains an evidence exception and must not be relabelled as a complete E2E PASS.

## 14. Dependency/security exception

A dev-only transitive advisory involving `braces <= 3.0.3` has no fixed upstream version at the documented snapshot. The project uses a narrow, time-bounded CI exception while production-only audit remains free of high/critical findings.

Agents must not silently broaden or permanently suppress dependency security checks.

## 15. Repository/worktree conventions

**CONFIRMED operational convention:** Implementation/review agents work in isolated branches/worktrees. The dirty primary worktree is not to be reset, stashed, cleaned, or repurposed casually.

The project uses separate implementation and review agents. A reviewer must independently inspect the change rather than trust the implementer’s report.

Parallel work should be split by file/domain boundaries and revalidated after integration.

## 16. Architectural constraints that must not be reversed casually

1. PostgreSQL/RLS is part of the security boundary.
2. Tenant isolation must not be moved to UI-only filtering.
3. Production migrations remain explicit and independently verified.
4. First-user bootstrap remains fail-closed, one-time, and human-approved.
5. Temporary bootstrap credentials must not become persistent credentials.
6. Provider-managed role behavior must be preflighted rather than bypassed.
7. Production secrets must stay out of argv/files/logs/chat.
8. Diagnostics access must not be broadened merely to make evidence collection easier.
9. No synthetic production figures should be introduced to make UI states look complete.
10. Station time must come from station metadata, not browser guesses.
11. Exact monetary precision must be preserved at API boundaries.
12. Phase 0 Daily Operations work must not invent schema/ledger/accounting semantics.
13. Preview URLs are not owner handoff URLs.
14. Environment/harness failures must be distinguished from product defects before code is changed.

## 17. Directory/repository structure — known portions

The following structure is confirmed or strongly evidenced by paths discussed:

```text
/
├── AGENTS.md                      # to be added by the knowledge-base setup
├── docs/
│   ├── decisions/                 # existing ADRs
│   ├── architecture/              # existing architecture notes
│   └── runbooks/                  # operational/deployment docs
├── ops/
│   └── db/
│       └── bootstrap.sql
├── scripts/                       # operational/provisioning scripts
├── src/
│   ├── app/                       # Next.js routes/pages/API
│   ├── modules/                   # domain modules (customers, forecourt, ...)
│   ├── design-system/             # navigation/design-system behavior
│   └── platform/
│       ├── db/                    # DB client/migrations/platform DB code
│       └── security/              # security/provisioning behavior
└── tests/
    ├── e2e/
    └── integration/
```

Agents must inspect the actual repository before assuming this list is exhaustive.

## 18. Important data flows

### 18.1 Normal authenticated read flow

```text
Browser
  -> Next.js route/page/API
  -> authenticated user + authorised tenant/context
  -> application query/service
  -> app_runtime PostgreSQL session
  -> RLS/permissions
  -> tenant-scoped result
  -> UI
```

### 18.2 First-user bootstrap flow

```text
Human operator
  -> reviewed local operator script
  -> migration_owner evidence/preflight
  -> temporary password for first_user_provisioner
  -> direct provisioner session
  -> legitimate scope discovery
  -> READ ONLY dry run
  -> zero-write + unchanged-sentinel proof
  -> PASSWORD NULL cleanup
  -> explicit human approval
  -> real one-time provision operation
  -> normal application login smoke
```

The real provision step is deliberately outside the dry-run scripts and must not be added to them.

## 19. TODO — requires repository verification

Before a future architecture rewrite or major feature expansion, verify in the repository:

- exact Better Auth configuration and user/session model;
- full application role/permission model;
- current complete schema/entity map;
- current API route inventory;
- exact R2 abstraction and user-facing storage behavior;
- background job deployment/runtime topology;
- exact CI workflow commands and release automation;
- current observability implementation and exception expiry;
- current dependency advisory status.
