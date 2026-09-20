# Platform contracts

These are the shared service boundaries A0/A1 will establish. Method signatures are intentionally left to implementation agents unless already required by the Blueprint.

| Contract | Purpose | Primary owner |
| --- | --- | --- |
| Authenticated actor context | Resolves authenticated identity and session security state | A1 |
| Tenant context | Validates active membership, scope, tenant, legal entity, and station context | A1 with A0 |
| Tenant-scoped transaction wrapper | Starts a transaction, sets local tenant/user context, and fails closed when absent | A0 with A1 |
| Authorization service | Evaluates permission codes, scope, approval authority, and step-up requirements | A1 |
| Audit writer | Appends signed/tamper-evident business and security events without ordinary mutation | A1 with A0 |
| Idempotency service | Stores request hash/result and rejects key reuse with a different request | A0 |
| Outbox writer | Writes downstream events atomically with the business transaction | A0 |
| Document/evidence reference | Keeps private, tenant-scoped immutable document versions and verification state | A0 with owning module |
| Approval interface | Creates/submits/returns/approves exact versions and prevents self-approval by default | A0 with A1 |
| Human reference generator | Allocates atomic, tenant-safe user-facing references | A0 |
| Clock/time abstraction | Separates UTC server time, business date, and effective time | A0 |
| Structured error taxonomy | Distinguishes validation, forbidden, not found, business, conflict, idempotency, retryable, external, and internal errors | A0 |

Feature agents consume these contracts through published module APIs. They must not bypass tenant context, authorization, audit, or idempotency with private database access.
