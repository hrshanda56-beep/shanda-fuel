# Shanda Fuel Phase 1 blocker decision packet

Checkpoint reviewed: `81552d0`  
Scope: documentation and decision support only. No product code, migration, production system, or Phase 0.5 artifact was changed.

## 1. Customer permission / migration alignment

**CURRENT BEHAVIOR =**

- Customer/account creation, payment, prepaid top-up, and fuel-authorization commands already use tenant/station-scoped policies, step-up checks where defined, expected-version checks, audit, and the existing active-customer/account plus positive-credit guards.
- `ACTIVE`, `SUSPENDED`, and `CLOSED` status values exist in the schema, but there is no reviewed customer or account lifecycle transition command.
- The TypeScript permission map and migration `0008_customer_accounts.sql` currently grant `FINANCE` the same broad customer configuration, adjustment, and override permissions as `ADMINISTRATOR`. `SUPERVISOR` has only view, credit-authorization, and statement-view customer permissions; `ATTENDANT` has none.

**SPEC / DECISION DOC REQUIREMENT =**

DEC-041 and `PRODUCT_SPEC.md` establish: Owner/Admin manage customer configuration, credit limits, prepaid configuration, and lifecycle; Supervisors review/use; Operators select/use eligible customers. Customer history is retained, and suspended/closed customers cannot initiate new account transactions. The full human role matrix remains unresolved. The architecture and decomposition docs explicitly gate lifecycle writes on reviewed permission/migration alignment.

**CODE / SCHEMA MISMATCH =**

The status columns and permission vocabulary exist, but lifecycle commands, transition policy, actor/audit semantics, idempotency, and concurrency behavior do not. The current `FINANCE` grants are not expressly established by the customer decision documents, so the runtime map and migration are broader than the confirmed Owner/Admin configuration rule unless Finance access is separately confirmed.

**WHY THIS BLOCKS IMPLEMENTATION =**

Adding lifecycle mutations or changing role grants could expand or remove access to customer financial configuration and corrections. The ambiguity affects authorization, RLS test expectations, audit responsibility, and the canonical migration sequence; it cannot be safely resolved by implementation judgment.

**OPTION A =** Reuse the existing customer permission codes and align role grants after human confirmation, keeping the change narrowly scoped. Define lifecycle commands against the existing customer-management/account-management boundaries and explicitly decide which non-Owner/Admin roles retain payment, statement, credit-authorization, adjustment, and override access.

**OPTION B =** Introduce narrower lifecycle/configuration permission codes and a reviewed role matrix, while retaining separate use permissions for payments, statements, authorizations, adjustments, and overrides. Update the TypeScript map and canonical migration together.

**RECOMMENDED OPTION =** Option B, subject to A0 and human approval of the exact permission names and role grants. It most directly expresses the already-confirmed distinction between configuration authority and operational use without silently treating Finance as an administrator.

**SECURITY / DATA IMPACT =**

This is a least-privilege and tenant-boundary decision. A wrong grant can permit unauthorized credit-limit, prepaid, lifecycle, or ledger-correction activity; a wrong restriction can interrupt legitimate finance operations. No customer rows need to be rewritten solely for the permission decision, and historical records must remain retained.

**MIGRATION REQUIRED =** YES — for any role/permission alignment in existing databases. A0 must assign the canonical migration number and integrate it; no migration was created in this packet.

**FILES AFFECTED =**

`src/platform/security/permissions.ts`, `src/modules/customers/application.ts`, customer command/policy/validation modules, `src/app/api/customers/commands/route.ts`, the A0-owned canonical migration sequence, and customer/security/PostgreSQL/browser tests. The source documents requiring the decision are `docs/PRODUCT_SPEC.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, and `docs/architecture/phase1-contract-decomposition.md`.

**TESTS REQUIRED =**

- Role/permission matrix for Owner, Administrator, Finance, Supervisor, and Attendant, including tenant and station scope.
- Lifecycle transition matrix for customer and account status, including no new transactions for suspended/closed customers and no hard-delete path.
- Step-up, actor separation, audit attribution, idempotent replay, expected-version conflicts, and cross-tenant RLS denial.
- Exact-decimal invariants proving lifecycle changes do not silently mutate balances.
- Fresh/replay migration, schema checks, and browser loading/error/empty/accessibility coverage for any UI added later.

## 2. Exception / approval contracts

**CURRENT BEHAVIOR =**

- `approval.view`, `approval.act`, `exception.view`, and `exception.manage` permission codes exist.
- A3 has domain-owned reconciliation approval states and meter-exception records/resolution commands; provider settlement has an `EXCEPTION` state; A11 composes existing states.
- `src/modules/approvals/index.ts` is only a public placeholder. There is no shared approval/exception table, route, catalogue, or cross-domain lifecycle. The current exception sources are not one generic workflow.

**SPEC / DECISION DOC REQUIREMENT =**

DEC-032 requires the fixed Open Shift → Record Activity → Reconcile → Supervisor Review → Close Shift workflow with distinct actors. DEC-034 and DEC-035 require explicit attribution and custody evidence. DEC-037 rejects a generic workflow engine in favor of bounded policy. DEC-038 requires exception-first, approval-aware close summaries, and DEC-039 requires authoritative sources and unavailable states rather than inferred or synthetic values.

**CODE / SCHEMA MISMATCH =**

The permission names suggest shared capabilities, but no shared contract defines exception type, owner, severity, state transitions, approval evidence, source reference, or resolution semantics. Existing domain state machines remain authoritative and are not safely replaceable by a new generic record.

**WHY THIS BLOCKS IMPLEMENTATION =**

A new generic approval or exception workflow could duplicate domain truth, permit self-approval, obscure unresolved close conditions, or create a second accounting/control state. The missing contract affects authorization, audit, concurrency, correction/reversal, and reporting semantics.

**OPTION A =** Start with bounded, domain-owned read models and commands for a confirmed workflow slice. Compose existing A3/A5/A6 states for an authoritative close-summary view; keep each domain’s approval and exception transitions in its owning module; do not add a shared table until a concrete gap is approved.

**OPTION B =** After the first concrete workflow is specified, add narrow shared approval/exception infrastructure with fixed types and source references, append-only decisions, actor/step-up evidence, idempotency, and domain-owned authoritative states. This is not permission to build a generic workflow engine.

**RECOMMENDED OPTION =** Option A first. It is the smallest path already supported by the locked workflow and bounded-policy decisions, and it avoids inventing a cross-domain source of truth. Revisit Option B only when a repeated, documented gap cannot be represented by an owning domain.

**SECURITY / DATA IMPACT =**

The implementation must prevent self-approval where separation is required, preserve tenant scope, retain approval and custody evidence, avoid duplicate postings, and show unresolved conditions honestly. Existing domain records must not be backfilled or reinterpreted as a generic exception ledger without an approved contract.

**MIGRATION REQUIRED =** NO for the recommended first read-model/domain-owned slice when it uses existing authoritative records; YES for Option B or any new durable cross-domain approval/exception records or permission grants.

**FILES AFFECTED =**

The first slice would touch the relevant owning read model (likely the operations overview), existing A3/A5/A6 command/read modules, and their tests. `src/modules/approvals/index.ts` should remain a boundary until a contract is approved. `src/platform/security/permissions.ts` and a canonical migration are affected only if the approved slice adds or changes durable permissions/records.

**TESTS REQUIRED =**

- Authoritative-state projection tests, including unresolved and unavailable states; no synthetic totals.
- PostgreSQL RLS/scope and permission tests; actor separation and self-approval denial.
- Named state transitions, correction/reversal behavior, exact-decimal invariants, idempotent replay, optimistic-concurrency conflicts, and duplicate-posting protection.
- Integration tests across the owning modules, plus UI loading/error/empty/accessibility tests when surfaced in the dashboard.

## PostgreSQL integration-test restoration

**POSTGRES TEST REQUIREMENT =**

Use real PostgreSQL only: synthetic data, canonical migrations, RLS/security checks, and the repository’s sequential integration configuration. SQLite, an in-memory substitute, production databases, and production credentials are out of scope. The current checkout has canonical migrations `0000` through `0021`; the integration README’s older `0000` through `0002` wording should be corrected separately because CI applies the full sequence.

**EXPECTED DATABASE / ROLE =**

Use a dedicated disposable local database such as `shanda_fuel_test` (or the first-user fixture’s `shanda_fuel_first_user_test`) on a local-only endpoint. Bootstrap roles are `migration_owner`, `app_runtime`, `job_runtime`, and `diagnostics_readonly`, with a local administrative owner for bootstrap/migrations. First-user provisioning tests additionally create their explicitly synthetic provisioner/unrelated roles. `DATABASE_DIRECT_URL` is the migration/bootstrap channel; `DATABASE_URL` is the runtime/test channel.

**CAN LOCAL TEST DB BE CREATED SAFELY =** YES — PostgreSQL 16.15 tooling is installed locally, no server was contacted, and the safe approach is a disposable local cluster/database on a dedicated loopback port (the first-user fixture expects `127.0.0.1:55432`) with synthetic data only.

**CAN EXISTING REPO TEST HARNESS DO IT =** YES for database bootstrap, roles, migrations, and fixtures once a local PostgreSQL server is running; NO for creating/starting that server or its disposable data directory. The current fixture explicitly expects a running local cluster.

**SECRETS REQUIRED =** NO production secrets. Local tests can use peer/trust authentication or a synthetic local password; CI’s Better Auth, audit, and PostgreSQL values are test-only values.

**RECOMMENDED TEST SETUP =**

1. Have the human provision/start a disposable PostgreSQL 16 local cluster on `127.0.0.1:55432` (or another dedicated loopback port) with a dedicated test database; do not point any URL at production.
2. Run the existing local bootstrap and migration flow: `scripts/db/bootstrap-test.sh`, then `pnpm db:migrate:test`, with `DATABASE_DIRECT_URL` set to the local administrative URL.
3. Set synthetic local `DATABASE_URL`/`DATABASE_DIRECT_URL` values and run `pnpm test:integration`. Use the first-user fixture only when that scenario is being tested; it performs its own local-only database/role setup after the cluster exists.
4. If runtime-role proof is required, exercise the repository’s `app_runtime` role path and `SET ROLE` checks against this disposable database. Do not copy CI or production credentials.

**NEXT HUMAN ACTION =**

Approve/provision the disposable local PostgreSQL cluster, then provide only the local test endpoint (or authorize a CI run with its existing synthetic service). Once it is available, rerun the integration suite and treat any failures as test/setup or contract evidence. Separately decide the customer role/migration matrix and whether the first bounded exception/approval slice is authorized; no implementation should proceed through those decisions.
