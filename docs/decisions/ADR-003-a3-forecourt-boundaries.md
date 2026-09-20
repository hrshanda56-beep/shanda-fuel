# ADR-003: A3 forecourt boundaries and downstream contracts

## Context

The first operational slice must record physical meter truth without implementing inventory, cash, provider settlement, or customer ledgers. The repository already provides tenant-aware transaction/RLS primitives and exact decimal arithmetic, but later modules need stable interfaces now.

## Decision

Keep `Meter` and `MeterInstallation` separate, make `MeterSegment` the immutable operational interval, and calculate normal litres as `closing - opening` using exact decimal strings. A lower reading is never treated as rollover; it requires a reset, replacement, or controlled correction with explicit quantity. Each segment captures price, attendant, entered-by, on-behalf-of, and meter snapshots.

Reconciliation declarations classify meter-derived expected sales. Submission creates a revision flow ending in approval, posting, and locking; variance is `accounted - expected` and never becomes employee debt or revenue automatically. A3 publishes typed meter-sealed and reconciliation approval/posting contracts, leaving inventory consumption and financial settlement to A4/A5.

The migration applies tenant-aware composite foreign keys, forced RLS, effective-range exclusion constraints, exact numeric columns, and nozzle exclusivity. The command seam accepts the central idempotency, audit, and outbox ports rather than creating parallel implementations.

## Consequences

The A3 branch can be reviewed independently and later modules can consume authoritative snapshots without coupling to A3 tables. A0 must review the canonical migration ordering and A1 must review the final role-grant matrix before merge. Real PostgreSQL integration requires a configured dedicated database and is not silently skipped.

## Source requirements

Master Blueprint §§3–6, §§11–14; A3 workstream; `AGENTS.md` locked invariants.
