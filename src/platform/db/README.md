# Database platform boundary

Database access is server-only. Browser code must not import this directory.

The platform exposes a pooled runtime client, a direct migration convention, and a tenant transaction seam. A1 owns the fail-closed context contract and migration-ready RLS/runtime-role design; A0 integrates the reviewed SQL into canonical migration history. Every normal transaction must provide a validated tenant and actor context.
