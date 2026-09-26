# Module boundaries

The application is a modular monolith. Each module owns its authoritative domain records and publishes explicit contracts. Consumers may read published projections/contracts, but must not mutate another module's tables directly.

| Module | Owns | May consume | Must not do |
| --- | --- | --- | --- |
| Tenancy | Tenant, legal entity, station scope identities | Identity and authorization | Grant permissions by role-name shortcuts. |
| Identity | Authentication identity/session integration | Tenancy membership context | Become the source of business authorization. |
| Authorization | Roles, permissions, scopes, approval authority | Identity and tenancy | Bypass live authority checks. |
| Stations/configuration | Station setup and effective-dated operating configuration | Tenancy | Embed client-specific production facts. |
| Forecourt/pricing | Business days, shifts, meters, boundaries, segments, prices | Stations, customers, payments | Accept client-computed litres as authoritative. |
| Inventory/tanks/deliveries | Pools, tanks, dips, movements, receipts, transfers, WAC | Forecourt and purchasing contracts | Let dips silently mutate book stock or invoices rewrite receipt quantity. |
| Purchasing/creditors | Suppliers, invoices, creditor movements, payments | Deliveries, banking, documents | Collapse delivery, invoice, and settlement into one record. |
| Cash/banking/settlements | Custody, handovers, deposits, provider declarations/settlements | Forecourt, expenses, documents | Equate collected cash or provider declaration with bank confirmation. |
| Customers | Credit, prepaid value/litres, authorizations, payments, invoices | Forecourt, reconciliation | Duplicate meter litres/revenue or mix prepaid products. |
| Expenses | Expenses and recurring-cost recognition/payment allocation | Cash, suppliers, approvals | Double-count inventory costs as operating expenses. |
| Reconciliation/approvals | Reconciliation revisions and approval workflow | Forecourt, money, customers, audit | Generic status mutation or double-post inventory sales. |
| Revenue | Append-only canonical sale-recognition movements and ordinary fuel-sale revenue derivation | Forecourt segments, A4 SALE, A5 approval/reconciliation lineage, A12 COGS | Treat declarations, payments, reading aggregates, or settlement amounts as revenue; mutate posted revenue in place. |
| Documents | Evidence identities, immutable versions, verification | All owning modules | Use public objects or overwrite evidence in place. |
| Reporting | Canonical calculations, report runs/artifacts, explanations | Published authoritative movements/projections | Recalculate official numbers separately in UI/PDF/XLSX. |
| Audit/notifications | Audit/security events and notification delivery | All modules through contracts | Expose secrets or mutate business truth. |
| Platform/jobs | DB, auth adapters, storage, email, idempotency, outbox, jobs, observability | Published module ports | Provide hidden unrestricted tenant/RLS bypass. |

Prohibited globally: direct cross-module table manipulation where a contract exists, circular domain imports, UI-to-persistence access, floating-point authoritative arithmetic, and bypassing tenant transaction context.
