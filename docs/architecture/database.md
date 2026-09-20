# Database architecture

Reserved for PostgreSQL schema ownership, migration, RLS, tenant-context, role, and integrity notes.

The target logical schemas are `auth`, `app`, and `platform`; the runtime must fail closed when tenant context is absent.
