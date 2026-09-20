# Workstreams

Workstreams define parallel ownership after the A0 baseline exists. They are boundaries, not permission to bypass shared contracts or integrate directly to `main`.

Each agent must read its workstream file, [`../PARALLEL_EXECUTION.md`](../PARALLEL_EXECUTION.md), the relevant contracts, and the canonical specifications before changing code.

| ID | Workstream | Primary focus |
| --- | --- | --- |
| A0 | Integration foundation | Toolchain, CI, DB infrastructure, shared platform, integration |
| A1 | Platform security | Auth, membership, authorization, tenant context, RLS, security |
| A2 | UI foundation | Design primitives, AppShell, forms, responsive/accessibility foundations |
| A3 | Forecourt/reconciliation | Business days, shifts, meters, declarations, reconciliation, sale recognition |
| A4 | Inventory/deliveries | Tanks, dips, deliveries, movements, transfers, WAC, revaluation |
| A5 | Money/settlements | Cash, banking, payment channels, provider batches and settlements |
| A6 | Commercial | Suppliers, customers, credit/prepaid, expenses, recurring costs |
| A7 | Reporting/profitability | Canonical calculations, reports, exports, owner dashboard, lineage |
| A8 | Hardening/release | Cross-module verification, security, performance, resilience, release |
