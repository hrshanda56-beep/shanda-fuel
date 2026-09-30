# Canonical migrations

This directory is the single production migration history for Shanda Fuel.

- A0/integration owns ordering, validation, and integration of canonical migrations.
- Feature agents may propose migration-ready schema changes in their owned module, but must not create competing production migration histories.
- Never run migration or push commands against production from local development.
- `DATABASE_DIRECT_URL` is intended for direct migration connections; `DATABASE_URL` is the pooled runtime connection.
- The canonical foundation sequence is `0000_platform_namespaces`, `0001_a1_auth_identity`, then `0002_a1_tenant_authorization_security`.
- `0001` is derived from the pinned Better Auth 1.7.5 configuration and owns the `auth` persistence tables. `0002` owns Shanda tenant authorization/security tables and its reviewed hand-authored RLS/grant layer.
- The initial A0 migration only creates the `auth`, `app`, and `platform` namespaces. It intentionally contains no business tables.
- Security SQL after the generated table/index statements in `0002` is deliberately hand-authored. Drizzle checks table metadata; it does not regenerate or replace reviewed policies, context functions, ownership, or grants.
- The current journal contains exactly 21 ordered entries, `0000` through `0020`. Migrations `0012`, `0014`, `0015`, `0016`, `0017`, `0018`, `0019`, and `0020` are reviewed hand-authored SQL deltas and therefore do not add generated Drizzle snapshots; `pnpm db:check` remains the metadata consistency check for the generated history. `0019` removes inappropriate auth-schema access from non-auth runtime roles. `0020` removes app-runtime application-table deletes, establishes the durable PostgreSQL rate-limit capability, and keeps the rate-limit table inaccessible directly to runtime roles.
