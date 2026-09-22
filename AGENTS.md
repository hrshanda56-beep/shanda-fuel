# Shanda Fuel repository agent contract

Shanda Fuel is a multi-tenant fuel-station operations and financial-control SaaS for ShandaHR. This repository is in **pre-implementation preparation**. Agents must establish the documented foundation before implementing product features.

## Read first

1. [`docs/spec/MASTER_BLUEPRINT.md`](docs/spec/MASTER_BLUEPRINT.md) — canonical product and engineering specification.
2. [`docs/spec/WIREFRAMES.md`](docs/spec/WIREFRAMES.md) — canonical V1 UX and workflow specification.
3. [`docs/implementation-status.md`](docs/implementation-status.md) — current delivery state.
4. [`docs/PARALLEL_EXECUTION.md`](docs/PARALLEL_EXECUTION.md) — active coordination rules.
5. The relevant [`docs/workstreams/`](docs/workstreams/) and [`docs/contracts/`](docs/contracts/) documents.

When sources conflict, preserve confirmed facts and explicit integrity/security invariants first, then this contract, then the Blueprint, Wireframes, contracts, and ordinary implementation judgment. Do not silently reinterpret a locked requirement; record a material deviation in an ADR.

## Locked invariants

- Use a modular monolith: one application and primary PostgreSQL database; do not introduce microservices, GraphQL, or a universal financial `transactions` table.
- Tenant hierarchy is Tenant → Legal Entity → Station. Enforce tenant safety in application authorization, tenant-aware relationships, PostgreSQL RLS, and fail-closed tenant context.
- Browser code never connects directly to PostgreSQL or private object storage.
- Keep inventory, sale recognition, cash, bank, provider, supplier, customer credit, prepaid, and expense domains distinct. Posted/locked records are corrected with named reversal, adjustment, or compensating commands.
- Use exact decimal arithmetic for money, litres, prices, and weighted-average cost. Do not use binary floating point for authoritative values.
- Use named state-machine commands, server-side validation, idempotency where duplicate effects are possible, deterministic locking, append-oriented audit, and explicit approval semantics.
- Do not invent client master data or Zimbabwe tax treatment. Missing station, bank, tank, supplier, customer, threshold, and opening-position values are onboarding/cutover data.

## Parallel-agent rules

- `main` is the integration branch. Never work directly on it and never self-merge to it.
- Each agent uses one task, one branch, and one isolated worktree. Follow the ownership and forbidden-modification rules in the relevant workstream document.
- A0 owns package/tooling/build configuration and canonical migration integration. Agents may propose module schema changes but must not create conflicting canonical migration sequences.
- Do not silently change shared contracts, root instructions, status, or coordination files. Coordinate first and record material decisions in `docs/decisions/`.
- Keep changes narrowly scoped, test them, update implementation status, and include a handoff summary.

## Quality and reporting

Every meaningful slice must address authorization, tenant isolation, exact arithmetic, concurrency/idempotency, audit, correction/reversal, loading/error/empty states, accessibility, tests, observability, and documentation as applicable. Report deviations, blockers, tests, and remaining onboarding data needs. A genuine blocker is an unresolved contradiction, missing external authority/credential for an external action, or unsafe irreversible production action—not missing client setup data.

The next implementation owner is A0. Do not begin A0 work from this preparation task.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
