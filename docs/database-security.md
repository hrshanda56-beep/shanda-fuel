# Database security

The target database design uses separate `auth`, `app`, and `platform` schemas, tenant-aware foreign keys, PostgreSQL RLS, and a tenant transaction wrapper that sets local tenant and user context before business queries execute.
