# Integration tests

Integration tests use a real PostgreSQL database. They must not substitute SQLite or an in-memory mock for PostgreSQL behavior. Local execution uses a developer-owned database configured through `DATABASE_URL`; CI supplies an ephemeral PostgreSQL service. Tests use synthetic data only and must never receive production credentials.
