# ADR-004 — A3 final remediation integrity boundaries

## Status

Proposed for A0/A1 verification on `agent/a3-core-forecourt`.

## Decision

A3 authoritative commands use a command-owned policy table. The command type determines permission, required station scope, assurance level, attendant eligibility, and expected-version requirements. Request payloads do not select authorization policy or authoritative actor/provenance fields.

The command effect, idempotency record, audit event, and outbox event share one trusted tenant transaction. Idempotency is keyed by tenant, command type, and idempotency key; a different request hash is a conflict. Audit provenance is structured and records actor, membership, tenant, station, request, and optional responsible attendant identities.

PostgreSQL enforces the same boundaries as the domain: tenant RLS, composite station references, declared payment categories and non-negative amounts, valid variance classifications, explicit workflow transitions, append-only audit/outbox records, and immutable authoritative snapshots. The only terminal reconciliation updates permitted by the database are state-specific `APPROVED → POSTED` and `POSTED → LOCKED` transitions with required posting/locking provenance.

Meter and reconciliation events include source and correction lineage so A4/A5 consumers can distinguish original observations from compensating history without importing a universal financial transaction table.

## Consequences

The A0 integration owner must review and apply migrations `0004` and `0005` in sequence and run the real PostgreSQL integration suite. The A1 security owner must verify command policy assurance behavior and the final runtime-role grant matrix.
