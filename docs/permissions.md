# Permission catalogue

The centralized permission catalogue is implemented in `src/platform/security/permissions.ts` and exposed through the authorization module. A3 adds narrowly scoped forecourt and reconciliation codes for business-day/shift, meter, price-boundary, reconciliation, approval, and exception commands. Codes—not role-name checks—remain authoritative.

Permission codes, not role-name checks, are authoritative. Role templates only expand to permission codes and every assignment carries an explicit tenant/legal-entity/station scope and optional expiry.

High-risk permission codes additionally require a current strong-authenticated session with a verified server-side assertion; timestamps alone never satisfy the gate. Step-up authentication is enforced by the session contract for commands that require it. Temporary grants are time-bounded, revocable, and do not widen tenant scope.

The canonical seed tables and RLS relationships are in `src/platform/db/migrations/0002_a1_tenant_authorization_security.sql`. The architecture SQL at [`architecture/a1-platform-security-migration.sql`](architecture/a1-platform-security-migration.sql) is reference-only and is never executed by tests or deployment.

Owner is a scoped role template, not an authorization bypass. Named role-mutation commands reject self-elevation, require an explicit ownership-transfer confirmation for granting OWNER, and preserve the last active owner.

The stable `PERMISSION_CODES` and server authorization result are the A2 integration seam. UI code consumes a typed projection of that result and does not import or reimplement authorization rules.
