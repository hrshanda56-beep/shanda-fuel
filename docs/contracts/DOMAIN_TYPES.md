# Shared domain types

These are conceptual names for shared contracts. They do not prescribe TypeScript implementations during repository preparation.

| Concept | Meaning | Integrity rule |
| --- | --- | --- |
| `TenantId` | Tenant/company boundary identifier | Every tenant-owned relationship is tenant-safe. |
| `LegalEntityId` | Legal entity within a tenant | Must belong to the same tenant as its parent/consumer. |
| `StationId` | Station/location identity | Must resolve through the tenant and legal entity scope. |
| `UserId` | Global authentication identity | Not itself a business authorization grant. |
| `ActorId` | Auditable acting principal, human or system | Preserve actor type and authorization context. |
| `MembershipId` | User membership in a tenant | Owns roles, permissions, and scopes. |
| `Money` | Exact signed/unsigned monetary amount with currency | Never exists without `CurrencyCode`; no binary floating point. |
| `CurrencyCode` | ISO-style currency identity | V1 operating currency is USD; do not invent FX behavior. |
| `Litres` | Exact fuel quantity | Use the specified litre precision and meter-derived authority. |
| `UnitPrice` | Exact selling or purchase price per unit | Preserve effective version and currency. |
| `WeightedAverageCost` | Exact inventory cost basis | Maintain chronological movement and revaluation semantics. |
| `BusinessDate` | Station-local operating date | Use `Africa/Harare` for the initial context and explicit shift-start semantics. |
| `UTCTimestamp` | Server event timestamp | Store in UTC; distinguish from business date/effective time. |
| `HumanReference` | Atomic user-facing document/reference number | Never derive with `MAX()+1`. |
| `Version` | Optimistic concurrency version | Check on mutable workflow commands. |
| `IdempotencyKey` | Caller/command key for repeat-safe effects | Same key and request returns the prior result; differing request is rejected. |

Money, litres, unit price, and weighted-average cost precision must follow the Blueprint and use exact decimal arithmetic at application boundaries and in PostgreSQL numeric columns.
