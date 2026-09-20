# Database platform boundary

Database access is server-only. Browser code must not import this directory.

The platform exposes a pooled runtime client, a direct migration convention, and a tenant transaction seam. A1 owns the complete RLS policy implementation; A0 only reserves transaction-local context keys and requires tenant/actor context before the wrapper can execute.
