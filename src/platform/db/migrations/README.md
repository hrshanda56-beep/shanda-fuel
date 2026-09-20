# Canonical migrations

This directory is the single production migration history for Shanda Fuel.

- A0/integration owns ordering, validation, and integration of canonical migrations.
- Feature agents may propose migration-ready schema changes in their owned module, but must not create competing production migration histories.
- Never run migration or push commands against production from local development.
- `DATABASE_DIRECT_URL` is intended for direct migration connections; `DATABASE_URL` is the pooled runtime connection.
- The initial A0 migration only creates the `auth`, `app`, and `platform` namespaces. It intentionally contains no business tables.
