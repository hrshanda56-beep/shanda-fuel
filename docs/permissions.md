# Permission catalogue

The centralized permission catalogue is implemented in `src/platform/security/permissions.ts` and exposed through the authorization module. Permission codes, not role-name checks, are authoritative. Role templates only expand to permission codes and every assignment carries an explicit tenant/legal-entity/station scope and optional expiry.

High-risk permission codes additionally require a current strong-authenticated session. Step-up authentication is enforced by the session contract for commands that require it. Temporary grants are time-bounded and do not widen tenant scope.

The migration-ready seed tables and RLS relationships are in [`architecture/a1-platform-security-migration.sql`](architecture/a1-platform-security-migration.sql); A0 owns canonical migration ordering and integration.
