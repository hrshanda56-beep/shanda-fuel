# AGENTS.md — Shanda Fuel

## 1. Read this first

Shanda Fuel is a multi-tenant fuel-station operations and management application. It is already deployed and has significant security, database, UI, and release work behind it.

Before making any substantial change, read these repository documents:

1. `/docs/PRODUCT_SPEC.md`
2. `/docs/DECISIONS.md`
3. `/docs/ARCHITECTURE.md`
4. `/docs/IMPLEMENTATION_PLAN.md`
5. `/docs/CURRENT_STATUS.md`

Also inspect any relevant ADRs, architecture notes, runbooks, tests, and feature code for the assigned task.

Do not assume the latest-looking file is authoritative merely because it is newer. Use the source-of-truth hierarchy below.

## 2. Source-of-truth hierarchy

When information conflicts, use this order unless a current human instruction explicitly establishes another priority:

1. **Explicit current human instruction** for the task.
2. **`/docs/PRODUCT_SPEC.md`** for product requirements and scope.
3. **`/docs/DECISIONS.md`** for established product/architecture/security decisions.
4. **`/docs/ARCHITECTURE.md`** for system boundaries and implementation constraints.
5. **`/docs/IMPLEMENTATION_PLAN.md`** for ordering, dependencies, and remaining work.
6. **`/docs/CURRENT_STATUS.md`** for the latest conservative implementation/release snapshot.
7. **Supporting ADRs, runbooks, and repository documentation** for implementation evidence and detail.
8. **Assumptions inferred from existing code** only when consistent with all higher-priority sources.

Supporting documents may provide implementation evidence and detail, but they
must not silently override the canonical knowledge base. If supporting
documentation conflicts with a canonical document, follow the canonical source
and report the conflict. If code conflicts with a canonical product
requirement, do not silently redefine the requirement to match the code.
Significant new human decisions must eventually be reflected in the
appropriate canonical document.

If a conflict cannot be resolved from these sources, stop and surface the ambiguity. Do not silently choose the behavior you prefer.

## 3. Core project context

Important established constraints include:

- Multi-tenant scope is organised around tenant/organisation, legal entity, and station.
- PostgreSQL RLS/Force RLS is part of the security boundary.
- Production web hosting is Vercel; production PostgreSQL is Neon; private/recovery object storage uses Cloudflare R2.
- Production migrations are explicit operations and are not assumed to run automatically on deploy.
- First-user production bootstrap is a one-time, tightly constrained security path with a dry run, zero-write proof, explicit human approval, and mandatory credential cleanup.
- Production secrets must not appear in chat, committed files, generated credential files, logs, or process argv.
- Delivery scope is the client's full v1 (DEC-044, 2026-10-21), built on `codex/clerk-only-auth-20261017`; the ShandaHR link is deferred. Customer, cash, approved-fuel, alert and offline-draft work is in scope. Phase 0 release gates still apply to every release.
- Clerk is the only authentication provider (DEC-043). Do not reintroduce Better Auth or provider switching.
- New schema, RLS, write workflows and accounting rules are allowed when they implement the recorded v1 scope. Follow existing migration, RLS and audit patterns; do not invent semantics that DEC-044, PRODUCT_SPEC or the human have not settled.
- Dashboard/management UI must not display synthetic production figures.
- Station operational time must use station timezone metadata, not browser-local guesses.
- Exact monetary precision must be preserved where the schema/API contract requires it.
- Owner handoff uses only `https://fuel.shandahr.com`.

## 4. Inspect before modifying

Before writing code:

1. Locate the existing implementation.
2. Locate relevant tests.
3. Locate relevant migrations/schema/permissions if data or auth is involved.
4. Search for existing utilities/formatters/abstractions.
5. Read relevant ADRs/runbooks.
6. Check `/docs/CURRENT_STATUS.md` for known parallel work or blockers.
7. Confirm whether the assigned behavior is already partially implemented.

Do not recreate functionality that already exists under a different module or abstraction.

## 5. Working-tree and branch rules

### 5.1 Use isolated worktrees/branches

For implementation work, use an isolated worktree/branch unless the human explicitly says otherwise.

Do not:

- commit directly to `main`,
- repurpose a dirty primary worktree,
- reset/stash/delete another agent’s work,
- discard unexplained changes,
- merge/deploy merely because local tests pass.

If you encounter unrelated changes in your worktree, preserve them and create/prepare a clean patch or isolated candidate for your assigned task.

### 5.2 Scope changes tightly

Do not perform unrelated refactors while implementing a scoped task.

Examples:

- A test expectation failure does not authorize a product rewrite.
- A UI task does not authorize a schema change.
- A database test harness problem does not authorize weakening a security-definer check.
- A security audit convenience problem does not authorize creating a production role.

## 6. Product decision rules

### 6.1 Do not make major product decisions autonomously

Major ambiguities must be surfaced, not hidden behind assumptions.

Resolved by DEC-044: Supervisor meaning (the person responsible for a station), account-sale reference (the customer), approved-fuel accounting (like fuel sold), and cash handover roles (no minimum amounts; bank deposits still need a reference).

Examples of currently unresolved product semantics include:

- default tank-variance tolerances and reminder windows,
- full customer lifecycle priorities beyond DEC-041,
- full end-state human role/permission matrix.

Do not turn these into code-level requirements without a recorded human decision.

### 6.2 Preserve recorded decisions

Do not overturn `/docs/DECISIONS.md` casually. If a task genuinely requires changing a recorded decision:

1. explain why,
2. identify affected requirements/architecture/tests,
3. obtain explicit human approval when the change is material,
4. update the decision log and dependent docs.

Small implementation decisions are allowed when they are consistent with existing requirements and architecture.

## 7. Security rules

### 7.1 Secrets

Never:

- paste or request production secrets in chat,
- print secrets in logs,
- commit secrets,
- write credentials to `.env` or ad-hoc files unless an explicitly reviewed procedure requires a secure temporary file,
- place production DB URLs/passwords in process argv,
- dump the process environment.

For reviewed production operator flows, the human operator owns the credential and supplies it through hidden terminal input. Agents should work on secret-free scripts/procedures and static validation unless explicitly authorized otherwise.

### 7.2 Database authorization

RLS, ACLs, role membership, security-definer ownership, and fixed search paths are security-critical.

Do not:

- disable RLS to make tests pass,
- switch tenant isolation to UI-only filtering,
- broaden diagnostics access to auth/session/bootstrap internals for convenience,
- recreate provider-managed roles casually,
- use `cloud_admin`/`neon_superuser` shortcuts,
- create production principals solely to satisfy a test probe.

### 7.3 First-user provisioning

First-user production provisioning is a special release path.

Never add an executable real-provision command to a dry-run script.

The intended sequence is:

1. reviewed preflight,
2. legitimate scope discovery,
3. read-only dry run,
4. exactly-12 permission assertion,
5. zero-write and unchanged-sentinel proof,
6. temporary credential cleanup,
7. explicit human approval,
8. separately reviewed real provision operation,
9. authenticated application smoke.

Do not infer approval from a previous instruction.

## 8. Database/migration rules

- Inspect existing migrations before creating one.
- Do not create a migration for a problem that can be solved using an existing column/contract.
- Keep migration ownership expectations in mind: local integration tests can fail if security-definer objects are created under the wrong role.
- Use the project’s dedicated PostgreSQL test environment where established; do not start/link an unrelated default local cluster just because it is convenient.
- Production migration state must be verified independently of web deployment.
- Security-critical migration hashes/state must not be rewritten casually.

## 9. Data and calculation rules

### 9.1 Exact decimals

Financial/precision-sensitive values should follow existing decimal policies and schema scale.

Do not casually convert exact database numeric values through JavaScript floating-point numbers.

Current confirmed Customers money behavior preserves four decimals for `NUMERIC(20,4)` values.

### 9.2 Timezones

Operational station time must use the authoritative station timezone from station data.

Do not:

- guess a timezone from the user’s browser,
- hard-code `Africa/Harare` or UTC unless the actual contract says so,
- infer timezone from address/locale.

If authoritative timezone data is missing/invalid, follow the established truthful unavailable-state behavior.

### 9.3 No synthetic production data

Do not add fake production metrics, balances, totals, or profitability figures as UI filler.

Use a truthful empty/unavailable/context-required state instead.

## 10. Testing and validation rules

A task is not complete merely because code was written.

Before declaring completion, determine the repository’s actual available validation commands by inspecting package scripts/configuration. Do not invent commands that are not present.

Run the relevant subset of:

- focused unit tests,
- broader unit tests,
- integration/database tests,
- tenant-isolation/security tests,
- type checking,
- linting,
- formatting checks,
- production build,
- browser/E2E tests,
- accessibility checks,
- responsive/mobile checks.

### 10.1 Environment failures are not automatically product failures

When an integration/security test fails:

1. capture the real server/database error,
2. compare required environment prerequisites,
3. reproduce against the exact base/main when useful,
4. use equivalent DB version/roles/timezone/fixtures,
5. classify as candidate regression, baseline defect, or harness/environment.

Do not patch product code to compensate for a broken test harness.

### 10.2 Intentional skips

Provisioning/security suites may be intentionally opt-in and require additional database URLs, fixture IDs, or environment flags.

Report these as intentional skips with context. Do not call a skipped suite PASS.

## 11. UI/UX rules

Preserve established shared-shell patterns:

- avoid duplicate page headings,
- keep navigation hierarchy predictable,
- keep hidden navigation children inert,
- keep account/logout controls reachable,
- prevent horizontal overflow,
- test phone/tablet/desktop behavior,
- preserve light/dark compatibility,
- use truthful loading/empty/error/context-required states.

Do not add write workflows beyond the recorded v1 scope (DEC-044) merely because the UI could accommodate them. Setup and access screens must suit non-technical users: guided, plain language, no identifiers shown, phone friendly.

## 12. Dependencies

Prefer existing dependencies and abstractions.

Before adding a dependency:

1. confirm existing libraries do not already solve the problem,
2. explain the need,
3. consider runtime/security/bundle impact,
4. add/update tests.

Do not broadly suppress security advisories. Existing narrow exceptions are documented exceptions, not precedent for weakening checks.

## 13. Documentation rules

Update repository documentation when a task changes project truth, especially:

- requirements,
- architectural boundaries,
- recorded decisions,
- current status,
- implementation plan/dependencies,
- runbooks for release/security behavior.

Do not rewrite historical decisions to make the present look cleaner. Mark superseded decisions or stale status accurately.

## 14. Definition of Done

A task is Done only when all applicable items are true:

- implementation is complete,
- behavior matches the assigned requirement,
- relevant tests are added/updated,
- relevant existing tests pass,
- type checking passes,
- lint/format/build pass where applicable,
- tenant/security behavior is revalidated when affected,
- acceptance criteria are checked explicitly,
- no obvious regression is introduced,
- no unrelated work is bundled,
- required independent review is green,
- documentation/status is updated when project truth changed,
- the final agent report states what changed, what was validated, and any remaining risk/blocker.

A task is not Done if the only evidence is “code compiles” or “implementation agent says ready.”

## 16. Production rules

Do not contact production unless the human explicitly authorizes the production operation and the required review gate is green.

Never:

- deploy without permission,
- run production migrations “just in case,”
- mutate production roles/ACLs for diagnostics,
- run a real provision operation from a dry-run tool,
- use preview deployment URLs for owner handoff.

When a production release is performed, record and verify the exact release SHA.

## 17. Final owner-readiness rule

Phase 0 is not owner-ready until:

- production access is working through the legitimate first user,
- final integrated application gates are green,
- production is on the exact approved SHA,
- final owner review is complete,
- no confirmed P0/P1 remains unresolved.

Phase 1 ideas should not be used to hide a Phase 0 correctness problem, and Phase 0 should not absorb Phase 1 scope without an explicit decision.

## 18. Agent final-report template

At the end of a substantive task, report at least:

1. task/status,
2. files changed,
3. what behavior changed,
4. what did not change (especially security/schema/auth if relevant),
5. tests/checks run and results,
6. production contacted: YES/NO,
7. push/merge/deploy performed: YES/NO,
8. remaining risks/blockers,
9. whether the change is safe for review/integration.

Keep the report factual. Do not call a blocked or skipped gate PASS.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
