# Database platform boundary

Database access is server-only. Browser code must not import this directory.

The platform exposes a pooled runtime client, a direct migration convention, and a tenant transaction seam. A1 owns the fail-closed context contract and migration-ready RLS/runtime-role design; A0 integrates the reviewed SQL into canonical migration history. Every normal tenant transaction must receive a branded context from the server-side tenant authority resolver; a validated UUID or client-selected tenant is not sufficient.
