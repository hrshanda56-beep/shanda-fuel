# Integration tests

Integration tests use a real PostgreSQL database after the canonical sequence `0000 → 0001 → 0002` has been applied. They must not substitute SQLite or an in-memory mock for PostgreSQL behavior, and they must never execute the architecture proposal SQL. Local execution uses a developer-owned database configured through `DATABASE_URL`; CI bootstraps the approved roles and supplies an ephemeral PostgreSQL service. Tests use synthetic data only and must never receive production credentials.
