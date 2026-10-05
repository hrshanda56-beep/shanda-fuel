# Documentation guide

- `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `IMPLEMENTATION_PLAN.md`, and `CURRENT_STATUS.md` are the canonical knowledge base; [`../AGENTS.md`](../AGENTS.md) is its bootstrap authority.
- `spec/` contains supporting detailed Blueprint, Wireframes, and legacy prompt references. They are not authoritative.
- `onboarding/` contains station setup, discovery, operational forms, and cutover support material. It is not a substitute for product requirements.
- `contracts/` defines shared vocabulary, platform interfaces, and module ownership for parallel work.
- `workstreams/` defines agent missions, owned files/areas, dependencies, forbidden changes, tests, and handoffs.
- `decisions/` contains ADRs for material implementation decisions or explicit specification deviations.
- `implementation-status.md` is a compatibility pointer to [`CURRENT_STATUS.md`](CURRENT_STATUS.md).
- `PARALLEL_EXECUTION.md` is the coordination board for branches, worktrees, integration, and shared-file ownership.
- `DEVELOPMENT_PHASES.md` defines dependency stages and which work may proceed in parallel.
- `DEFINITION_OF_DONE.md` is the completion standard for implementation work.
- `release-readiness.md` is the current RC gate ledger; `release-notes/` holds
  candidate notes and known limitations.
- `runbooks/` contains deployment, recovery, staging, monitoring, and incident
  procedures, with an inventory of execution gaps.
