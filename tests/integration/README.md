# Integration tests

Integration tests use a real PostgreSQL database after the canonical sequence `0000 → 0001 → 0002 → 0003` has been applied. They must not substitute SQLite or an in-memory mock for PostgreSQL behavior, and they must never execute the architecture proposal SQL. Local execution uses a dedicated developer-owned test database configured through `DATABASE_URL`; CI supplies an isolated PostgreSQL 16 service and applies the same canonical migration sequence with `DATABASE_DIRECT_URL`. Tests use synthetic data only and must never receive production or personal Neon credentials.

The CI-equivalent order is:

```text
pnpm install --frozen-lockfile
pnpm db:migrate:test
pnpm db:check
pnpm test:integration
```

The integration harness fails when `DATABASE_URL` is absent, rather than silently skipping. A clean CI job gets a fresh database; local runs must target a disposable test database and must not run migrations against production.
