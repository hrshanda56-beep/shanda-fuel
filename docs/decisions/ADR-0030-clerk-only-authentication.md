# Clerk as the sole authentication provider

Date: 2026-10-17
Status: accepted by project owner

## Decision

Clerk is the only runtime authentication provider. Remove provider selection,
Better Auth credential/session handling, password hashing, and duplicate MFA
and login implementations. Clerk authenticates identities; Shanda Fuel retains
internal UUIDs, tenant/legal-entity/station memberships, permission evaluation,
approval policy, and audit history in PostgreSQL.

## Integrity and migration

Preserve all internal user UUIDs and relationships while moving the internal
user directory out of the legacy authentication schema. Historical migrations
remain immutable. Apply a forward migration and verify both fresh installation
and upgrade behavior in disposable PostgreSQL. Never infer membership from
Clerk user metadata or match external identities by unverified email alone.

Legacy sessions cannot authenticate after the cutover. Existing users require
an explicit Clerk identity mapping before access; users without mappings fail
closed. Credential history must not remain writable by the application runtime.

## Security

Sensitive operations retain tenant/action/session-bound reverification and
expiry. Disabling staff immediately denies application membership access and
revokes Clerk sessions with observable retry behavior. Sign-out continues to
purge local operational drafts. The browser has no database credentials.

## Deployment

Use separate Clerk test and production instances and environment credentials.
Configure Clerk login identifiers, recovery, invitation restrictions, and MFA
to match the product policy. Do not switch an existing deployment until user
mapping, migration, login, deactivation and privileged-action checks pass.
This change authorizes repository implementation; production data migration
and deployment require the normal controlled release procedure.
