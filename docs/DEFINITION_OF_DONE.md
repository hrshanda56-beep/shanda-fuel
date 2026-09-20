# Definition of Done

A meaningful implementation item is not complete merely because code exists. As applicable, the slice must have:

- schema and migration intent owned by the correct workstream;
- tenant-aware relationships, RLS/isolation proof, and scoped authorization;
- named command/state transition and server-side validation;
- idempotency and deterministic concurrency behavior where duplicate or concurrent effects are possible;
- exact decimal arithmetic and correct time/business-date semantics;
- append-oriented audit/security events and outbox behavior where required;
- explicit correction, reversal, expiry, locking, or supersession behavior for posted effects;
- loading, empty, success, business-error, permission-error, conflict, and offline states as relevant;
- mobile behavior, keyboard/focus behavior, status not conveyed by color alone, and WCAG 2.2 AA checks as relevant;
- domain/unit tests, real PostgreSQL integration/RLS tests, and critical Playwright/axe coverage as relevant;
- structured redacted logs, correlation IDs, and observability for operational failures;
- documentation and implementation-status updates;
- no unapproved specification or source-of-truth deviation;
- self-review, workstream review, integration review, and passing CI before merge.
