# Parallel execution board

## Integration Base

`A0 candidate based on 12a2fe42d1909a0e1b92ba66ec47d72afa7bab25; remediation pushed to PR #1, pending re-review and merge`

## A0 implementation candidate

- Branch: `agent/a0-integration-foundation`
- Worktree: isolated managed worktree `a0-integration-foundation`
- Base: `origin/main` at `12a2fe42d1909a0e1b92ba66ec47d72afa7bab25`
- Status: Phase 0 foundation remediation implemented and validated; A0 does not merge itself to `main`.
- `main` remained untouched during implementation.
- Remediation validation: PostgreSQL 16 migration application and 2-test integration suite passed against a dedicated ephemeral test database; missing `DATABASE_URL` fails the integration gate clearly.

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
