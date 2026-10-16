# Release security and migration 0030 decision record

Status: **owner decision required**. This record is read-only evidence and does
not authorize a provider, privilege, or migration change.

## Verified production state

On 2026-10-16, read-only production journal evidence showed migrations `0000`
through `0029` exactly once, with `0025`–`0029` hashes matching the integrated
candidate. Migration `0030_station_attendant_visibility.sql` is pending.

## Role-option decision

Provider metadata showed these effective options:

| Role | BYPASSRLS | Intended purpose | Required decision |
| --- | --- | --- | --- |
| `app_runtime` | no | Request runtime | Keep `NOBYPASSRLS`; this is the application tenant boundary. |
| `migration_owner` | yes | Controlled schema/ownership migration path | Security owner must either document the provider-required exception and restrict direct connectivity to the reviewed operator path, or schedule a separately reviewed remediation. |
| `diagnostics_readonly` | yes | Supplemental catalog and read-only operational evidence | Security owner must determine whether bypass is provider-imposed. It must retain no write grants and remain excluded from auth/bootstrap internals. |
| `job_runtime` | yes | Narrow asynchronous/outbox work | Security owner must inventory its active connection path and table/function grants before accepting the exception. |

The role options conflict with the repository's prior `NOBYPASSRLS` evidence.
No release may treat the discrepancy as resolved without a signed security-owner
decision, actual connection-path inventory, and a post-decision negative runtime
proof. Do not change production role attributes as a diagnostic step.

## Controlled 0030 rehearsal plan

Use the existing isolated Neon recovery/rehearsal branch that is confirmed to
contain the production history through `0029`; never use production `main`.

1. Record branch ID, expiry/retention, source journal rows and `0025`–`0029`
   hashes before execution.
2. Record a pre-change schema/catalog snapshot of `app.memberships`,
   `app.meter_segments`, `app.inventory_movements`,
   `app.inventory_cost_events`, and `app.inventory_sale_cost_attributions`,
   including owner, RLS/FORCE RLS, policies and column grants.
3. Apply only the candidate `0030` file with the approved migration-owner path.
4. Require one new journal row with hash
   `f227d4ce49d153a8fc8379cef7d9c37bfd91aab264a8d6526c0cb893f8099b7c`.
5. Verify the new `memberships_station_attendants` SELECT policy and that the
   four identifier-only UPDATE grants do not permit authoritative mutation.
   Re-run app-runtime tenant-isolation, immutable-trigger, and reconciliation
   command checks.
6. Preserve results and branch metadata. Any correction is a reviewed forward
   migration; no down migration is authorized.

The current authorization permits preparation only. Applying `0030` to a Neon
branch needs separate owner authorization because it changes provider data.
