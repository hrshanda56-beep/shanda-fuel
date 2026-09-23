# Database platform boundary

Database access is server-only. Browser code must not import this directory.

The platform exposes a pooled runtime client, a direct migration convention, and a tenant transaction seam. A1 owns the fail-closed context contract and migration-ready RLS/runtime-role design; A0 integrates the reviewed SQL into canonical migration history. Every normal tenant transaction must receive a branded context from the server-side tenant authority resolver; a validated UUID or client-selected tenant is not sufficient.

The production request path is server authentication → tenant-authority resolution → application service → repository/persistence adapter → `withTenantTransaction` → PostgreSQL. Runtime queries use `DATABASE_URL`; migration commands use `DATABASE_DIRECT_URL` (falling back to `DATABASE_URL` only when explicitly configured). Browser code cannot import this server-only boundary. Repositories must keep tenant-owned reads and writes inside the supplied transaction and must not create an alternate database client or transaction helper.
