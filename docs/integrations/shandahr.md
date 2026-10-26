# ShandaHR integration boundary

ShandaHR is deferred from v1 by DEC-044. The application therefore contains a
disabled-by-default adapter boundary only; it does not contact ShandaHR, store
an HR credential, or import employees/payroll data.

The boundary is `src/modules/integrations/shandahr.ts` and is controlled by the
server-only environment flag `SHANDAHR_INTEGRATION_ENABLED`. The flag is
disabled unless its value is exactly `1`. Even when explicitly enabled, the
adapter remains unavailable until an approved transport is injected. This is
intentional: the future API contract, authentication, ownership of employee
records, retry policy, and reconciliation rules still need a recorded
decision.

Before enabling a real adapter, the owner must approve all of the following:

1. ShandaHR endpoint and versioned employee/payroll contract.
2. Secret-manager location, least-privilege scope, rotation, and timeout policy.
3. Which system is authoritative for employee identity, station assignment,
   salaries, and payroll recognition.
4. Idempotency, retry, duplicate detection, audit, and failure/reconciliation
   behavior.
5. A tenant-scoped integration test environment and a reviewed production
   rollout/rollback plan.

No production or staging configuration should set this flag until those
decisions and the corresponding adapter tests are complete.
