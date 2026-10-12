# ADR-018: Initial selling price activation without meter boundaries

- Status: Proposed (Milestone A, owner self-service setup)
- Date: 2026-10-12
- Number note: ADR-016 and ADR-017 are taken; renumber on merge if another branch claimed 018.

## Context

A selling price becomes ACTIVE only through `ActivatePriceChange`, which requires a sealed
`PRICE_CHANGE` meter boundary for every active nozzle of the product. The boundary exists to split
already-metered litres between the old and the new price. No UI or onboarding path exists to capture
those boundaries, so a brand-new station could never obtain its first ACTIVE price without developer
SQL, and reconciliation readings require an ACTIVE price.

## Decision

Add the named command `ActivateInitialPrice` (permission `price.change.activate`, high-risk/step-up
through the existing authorization rule). It moves an APPROVED price through
`PENDING_STATION_ACTIVATION -> BOUNDARIES_IN_PROGRESS -> ACTIVE` in one transaction only when the
product has no ACTIVE price at the station and none of its nozzles has any meter boundary, i.e. there
is no metered history to split. Approval stays maker-checker. Every later change must use the normal
boundary flow. The command is idempotent, optimistic-versioned and audited (`SETUP.INITIAL_PRICE_ACTIVATED`).
A companion `DraftPriceChange` command creates the DRAFT row that `RequestPriceChange` needs.

## Consequences

No schema change. Existing state-machine triggers are unchanged and still enforce legal transitions.
Needs product-owner confirmation before production use; if rejected, remove the command and first
prices must be activated via the boundary flow.
