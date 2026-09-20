# Shanda Fuel

Shanda Fuel is a commercial, multi-tenant SaaS for fuel-station operations and financial control: forecourt readings, shifts, reconciliation, inventory, cash custody, electronic settlements, suppliers, customers, expenses, profitability, approvals, evidence, audit, and reporting.

Status: **pre-implementation / architecture-approved**. This repository is the preparation baseline for the first engineering workstream, A0. No substantial application or business logic is intentionally included here.

The initial operating context is TEI Oils / Triumph Energy Investments in Zimbabwe, while the product is designed as reusable SaaS for multiple fuel businesses. Product domain: `fuel.shandahr.com`. Tenant isolation and traceable source-of-truth ledgers are foundational requirements.

## Start here

1. Read [`AGENTS.md`](AGENTS.md).
2. Read the canonical [`docs/spec/MASTER_BLUEPRINT.md`](docs/spec/MASTER_BLUEPRINT.md) and [`docs/spec/WIREFRAMES.md`](docs/spec/WIREFRAMES.md).
3. Read [`docs/PARALLEL_EXECUTION.md`](docs/PARALLEL_EXECUTION.md), the relevant workstream, and shared contracts.
4. Check [`docs/implementation-status.md`](docs/implementation-status.md) before making changes.
5. Work in an isolated branch/worktree; do not work directly on `main`.

## Documentation map

- [`docs/spec/`](docs/spec/) — authoritative Markdown product and UX specifications.
- [`docs/onboarding/`](docs/onboarding/) — setup and cutover support material.
- [`docs/contracts/`](docs/contracts/) — shared vocabulary and module/platform boundaries.
- [`docs/workstreams/`](docs/workstreams/) — ownership, dependencies, and handoffs.
- [`docs/decisions/`](docs/decisions/) — ADRs for material deviations or refinements.
- [`docs/implementation-status.md`](docs/implementation-status.md) — current status.

The onboarding workbook contains real-world configuration placeholders. Blank or unknown station, bank, tank, supplier, customer, threshold, tax-policy, or opening-balance values are not software-development blockers and must not be fabricated into code. Tax treatment remains tax-ready but externally confirmed.

The current repository state is **pre-A0 repository preparation**. A0 should establish the technical baseline before later agents implement product slices.

## Development foundation

The A0 foundation is a Node-runtime Next.js App Router application with strict TypeScript, pnpm, Vitest, Playwright/axe, Drizzle ORM, and PostgreSQL seams. Product modules are intentionally scaffolds until their owning workstreams begin.

```sh
pnpm install
pnpm dev
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
```

Database commands use `DATABASE_DIRECT_URL` for direct migration connections where available. Never point local commands at production. The canonical migration history is owned by A0/integration; feature agents propose reviewed migration-ready changes rather than creating competing histories.

Health endpoints are available at `/api/health` (liveness only) and `/api/readiness` (reports database readiness without exposing secrets). Database access is server-only.
