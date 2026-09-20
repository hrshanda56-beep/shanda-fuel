# Parallel execution board

## Integration Base

`origin/main at 7260fa2cc8aa63f11728fd1cb37b8b15fd7b52bb; A1 security foundation merged; A2 PR #3 is undergoing final integration`

## A0 implementation candidate

- Branch: `agent/a0-integration-foundation`
- Worktree: isolated managed worktree `a0-integration-foundation`
- Base: `origin/main` at `12a2fe42d1909a0e1b92ba66ec47d72afa7bab25`
- Status: Phase 0 foundation remediation implemented and validated; A0 does not merge itself to `main`.
- `main` remained untouched during implementation.
- Remediation validation: PostgreSQL 16 migration application and 2-test integration suite passed against a dedicated ephemeral test database; missing `DATABASE_URL` fails the integration gate clearly.

## A1 platform/security implementation

- Branch: `agent/a1-platform-security`
- Worktree: `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel-a1`
- Pull request: [#2](https://github.com/hrshanda56-beep/shanda-fuel/pull/2)
- Status: approved and merged into `main` at `7260fa2cc8aa63f11728fd1cb37b8b15fd7b52bb`; Better Auth actor resolution, trusted tenant authority, canonical `0001`/`0002` migrations, executable role bootstrap, fail-closed context handling, tenant-scoped append-only event tests, and PostgreSQL isolation tests are now part of the integration baseline.
- Coordination: Better Auth 1.7.5 with Drizzle ORM ^0.45.2 and Drizzle Kit ^0.31.7. `docs/architecture/a1-platform-security-migration.sql` remains documentation/reference only; canonical migrations are authoritative. Pre-tenant identity security events remain a future separate stream.

## A2 UI foundation implementation candidate

- Branch: `agent/a2-ui-foundation`
- Worktree: `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel-a2`
- Base: required integration baseline `cd63d48b7a142905722d7c9ec76da053c29fbbb4`
- Scope: semantic design tokens/themes, responsive shell, permission-aware navigation seam, reusable presentation primitives, responsive tables/cards, truthful states, accessibility conventions, and synthetic demos/tests.
- Status: implementation complete in the isolated worktree; requires A2 review, integration review, and merge through `main`. A2 does not merge itself.
- Dependencies/assumptions: A2 consumes a serializable, already-authorized permission projection and leaves actor, tenant, authorization, database, and platform contracts to A1/A0.
- PR #3 remediation: mobile operating context, accessible modal focus behavior, valid mobile navigation list semantics, required-field semantics, typed `NavigationProjection`, timezone-invariant BusinessDate formatting, semantic theme tokens, and safe Button defaults are covered by regression tests.
- Status: independently approved; merged A1 foundation is now integrated locally for final combined validation. A2 does not merge itself to `main`.

## Branch and worktree policy

Each active agent gets one Codex task, one branch, and one isolated worktree. Agents never share a working checkout and never work directly on `main`. The preparation branch is `prep/agent-readiness`; later workstream branch conventions are listed below.

## Planned branches

- `agent/a0-integration-foundation`
- `agent/a1-platform-security`
- `agent/a2-ui-foundation`
- `agent/a3-forecourt`
- `agent/a4-inventory-deliveries`
- `agent/a5-money-settlements`
- `agent/a6-commercial`
- `agent/a7-reporting`
- `agent/a8-hardening`

## A3 core forecourt implementation

- Branch: `agent/a3-core-forecourt`
- Worktree: `/Users/wolftech/.codex/worktrees/a3-core-forecourt/shanda-fuel`
- Base: `3a0e02f0cda165e6a68f42b7d85ef44c9bb1b556`
- Status: domain, schema/migration proposal, RLS/effective-range constraints, typed A4/A5/A7 contracts, authorization catalogue additions, and representative UI implemented; A0/integration review and real PostgreSQL/E2E execution remain before merge.
- Remediation status: trusted A1-derived station command context, explicit permission/assurance binding, transaction-scoped idempotency/audit/outbox, station-aware composite references, authoritative-row guards, exact revision event distinctions, and contract/application tests are implemented on this branch. Fresh PostgreSQL, concurrency, role-grant, and Playwright/axe validation remain CI/integration-owner gates because this worktree has no database credentials.
- Shared-file note: the A3 migration registers permission definitions but does not broadly seed role grants; A0/A1 must review the role-grant matrix before integration.

These are conventions, not a requirement to create every branch immediately.

## Shared-file ownership

| Area | Owner | Coordination |
| --- | --- | --- |
| `package.json`, `pnpm-lock.yaml` | A0 | Feature agents propose dependency changes to A0. |
| Shared build/tooling/CI configuration | A0 | No uncoordinated edits. |
| Canonical database migration directory | A0 | Module agents supply reviewed schema intent. |
| Shared DB infrastructure | A0 | Coordinate with A1. |
| Shared RLS infrastructure | A1 | Coordinate with A0. |
| Design-system primitives | A2 | Feature UI consumes published primitives. |
| Root `AGENTS.md` | A0/integration | Changes require explicit coordination. |
| Contracts and coordination files | Integration owner | Material changes require an ADR or board update. |

## Merge policy

`worktree → implementation → tests → self-review → reviewer/integration review → CI → merge`.

Feature agents do not self-merge to `main`. A0/integration owns conflict resolution and canonical migration sequencing.

## Migration rule

Feature agents may define schema changes within their owned module and provide migration-ready artifacts. They must not independently generate conflicting canonical production migration sequences. A0 owns canonical migration generation/integration unless deliberately delegated in writing.

## Coordination protocol

Before changing a shared contract or owned file, state the intended change in the task handoff. Update implementation status after meaningful work. Handoffs must include changed files, tests, security/RLS impact, migration notes, open decisions, and next owner.
