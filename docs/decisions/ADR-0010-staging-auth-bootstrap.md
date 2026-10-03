# ADR-0010: Operator-only staging auth bootstrap

## Status

Retired. Historical record of the temporary A3 staging smoke bootstrap; the
implementation and package command were removed before final staging cleanup.

## Decision

Use a transactional, operator-run staging script that verifies the synthetic
Tenant A hierarchy and active Membership A before any mutation. If the
synthetic identity or credential account is missing, the script creates only
Actor A and hashes the operator-supplied password with Better Auth 1.7.5's
official `better-auth/crypto` `hashPassword` export. It then creates only the
four explicit Station A temporary grants required by the deployed smoke UI and
its two workflows: `business_day.view`,
`business_day.open`, `shift.view`, and `shift.start`, with a two-hour expiry.

The script uses `DATABASE_DIRECT_URL` when supplied, refuses production,
requires an explicit confirmation flag and exact synthetic Tenant A/Station A
IDs, never creates a session, and appends a signed security event with support
tool attribution.

## Rationale

The installed Better Auth configuration disables public signup. The public
signup API therefore cannot be used for this operator-only path, and the
Better Auth internal adapter is not a supported application-facing API for
creating a user with a caller-selected UUID. Direct persistence is the safest
remaining option because it preserves the exact synthetic actor ID required by
the existing Membership A row while still using Better Auth's official
password hashing implementation.

The direct path is isolated to this staging script; it is not a general
authorization bypass or a production provisioning mechanism. All business
authorization remains in the existing membership, permission, RLS and session
layers.

## Consequences

- No migration or production behavior is added.
- The operator must provide a reserved `.invalid` synthetic email and a
  runtime password.
- The script requires staging audit signing configuration for mutation mode.
- The historical implementation exposed the convenience
  `pnpm staging:auth-smoke-bootstrap` package script. That script and its
  helper were removed before final staging cleanup; this ADR does not define
  a current provisioning path or change authentication behavior.
