# A1 — Platform security

## Role and mission

Implement identity-to-business authorization and tenant isolation without weakening accounting or audit invariants.

## Owned areas

Better Auth integration, memberships, roles, permissions, tenant/legal-entity/station context, tenant-scoped DB wrapper, PostgreSQL RLS, DB runtime-role separation, security audit foundation, session/access security, step-up controls, and tenant-isolation tests.

## Allowed modifications

Identity, tenancy, authorization, security, audit, and database-security modules; owned migrations coordinated through A0; security documentation and tests.

## Forbidden modifications

Forecourt, inventory, cash, supplier/customer, reporting, design-system, or product UI behavior beyond security/context adapters. No hidden RLS bypass, owner bypass, shared accounts, or browser-to-database access.

## Dependencies and inputs

A0 DB/tooling contracts; `DOMAIN_TYPES.md`, `PLATFORM_CONTRACTS.md`, `MODULE_BOUNDARIES.md`; Blueprint security and tenancy requirements.

## Deliverables

Fail-closed tenant context, permission/scope checks, secure sessions/MFA posture, runtime roles, RLS policies, security-event plumbing, and proof that Tenant A cannot read or mutate Tenant B.

## Required tests

Authentication/session security, permission denial, scope denial, missing-context failure, RLS SELECT/INSERT/UPDATE/DELETE, composite tenant-FK integrity, session revocation, sensitive serialization, and cross-tenant isolation tests.

## Handoff and completion

Document the security boundary, required A0 migration/infrastructure coordination, test commands/results, and unresolved security risks. Update status only when the isolation proof is green.
