# Implementation status — pointer

This document is not authoritative and is no longer the repository’s current
status record. See [`CURRENT_STATUS.md`](CURRENT_STATUS.md), which is the
canonical current implementation and release snapshot.

The former detailed status record is preserved in Git history.

The current production Stage 1 security closeout is recorded in
[`docs/release-readiness.md`](release-readiness.md). It records PASS for
release SHA `2c7304916c191c66907d9582a3e7c26225c6eb59`, migration state through
`0024`, tenant isolation/RLS, `app_runtime`, OWNER/MFA, and production
health/readiness. The historical Stage 1 failure is superseded. The
`job_runtime` password was rotated without exposing the replacement
credential; post-rotation sessions were `0`; the deployed web app uses
`app_runtime`; no active `job_runtime` consumer was found; and health,
readiness, and normal authenticated application load passed. Temporary
quarantine is effective and controlled release may proceed with a documented
security exception. `job_runtime` is not fully remediated: provider-level
permanent hardening remains mandatory, and the role must remain unbound until
that hardening completes. This does not claim `0025` is applied or final
production release readiness.

## Milestone A: owner self-service station setup (branch `feat/milestone-a-setup-backend-20261012`)

Local, unmerged. Settings now has a "Station setup" tab (products, tanks, pumps and
nozzles with meters, shift templates, selling prices, supplier edit/deactivate). New named
commands `CreateProduct`, `CreatePump`, `CreateNozzle`, `DraftPriceChange`, `UpdateSupplier`
and `ActivateInitialPrice` (ADR-018, proposed) run through the shared tenant-context,
idempotency and audit executor at `/api/setup/commands`; `CreateTank`, `DefineShiftTemplate`
and the `RequestPriceChange`/`ApprovePriceChange` flow are reused. No migration. Open items:
changing a price that is already in use still needs the unbuilt meter-boundary UI; ADR-018
needs product-owner confirmation; the station context lists only ACTIVE stations, so setup
has its own station list.
