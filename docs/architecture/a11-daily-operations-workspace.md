# A11 — Daily Operations Workspace

Status: merged in `main` at `244ad14` (the A11 slice itself merged in PR #17).
The workspace requires no migration and composes the merged A3–A10 contracts.

## Purpose

A11 provides one mobile-first station workspace for moving a business day from shift context through meter evidence, payment evidence, approved expenses, cash declaration, variance explanation, and review. It composes A3–A10 behavior; it does not create a second reconciliation engine or accounting model.

## User workflow

1. An authorised user opens a station, business-day, and shift context.
2. The workspace loads the station setup, eligible attendants, active nozzles, active prices, and latest available meter context through the tenant-scoped daily operations read endpoint. Historical setup is selected against the requested shift's persisted planned interval: installations and prices must cover that interval, and the prior available boundary must be effective at shift start.
3. The user creates or continues a server-backed reconciliation draft.
4. While the revision is `DRAFT` or `RETURNED`, the user enters attendants, opening/closing readings, A5 payment evidence, approved expenses, cash counted, and variance explanations.
5. The user deliberately saves the draft. The server persists each detail through named commands and recomputes authoritative totals.
6. A supervisor submits the current version. The canonical parent header becomes `SUBMITTED` while the revision enters `PENDING_APPROVAL`; management return and approval are legal from the submitted parent header. Return requires a dedicated management reason, and approval makes the record visibly locked.
7. Cash custody, provider settlement, and A10 reporting are linked as downstream workspaces; their states are shown distinctly from payment evidence.

## Routes

- `/operations` redirects to `/operations/daily`.
- `/operations/daily` starts or continues a station-day workspace when `tenantId`, `stationId`, `businessDayId`, and `shiftId` are supplied. The reconciliation ID is added to the URL after draft creation so refresh restores the same server draft.
- `/operations/reconciliations/[id]` opens an existing reconciliation workspace.
- `/operations/reconciliations/[id]/review` opens the same composition with management review actions.
- The existing station reconciliation list links to the daily workspace. When an authorised station-day link supplies all four context IDs, the link preserves them; otherwise the workspace explains that context is required rather than inventing master data.

The existing `/stations/[stationId]/reconciliations/...` routes remain compatible with the prior A5 production workflow and continue to use the canonical command API.

## Canonical modules consumed

- A3/A5 forecourt reconciliation read model and production commands for draft creation, detail persistence, submit, return, and approval.
- A4-linked delivery and dip references exposed by the reconciliation read model.
- A6 cash summary for collection/banking context.
- A9 provider settlement summary for POS/EcoCash settlement context.
- A10 management reporting through the existing `/reports` route.
- A2 AppShell, form controls, status, loading, error, conflict, empty, and accessibility primitives.

The only new server read is `GET /api/forecourt/operations/daily`. It is a composition read, not a source-of-truth endpoint: it resolves A1/A3 authority, explicitly requires `reconciliation.view` at the requested station scope, runs under the trusted tenant transaction, and only exposes existing station, shift, attendant, nozzle, meter-installation, price, and prior-boundary context.

## Server/client responsibility split

The browser owns input editing, section navigation, dirty-state presentation, and retry messaging. The server owns authorization, tenant isolation, exact decimal arithmetic, meter litres, sales value, payment totals, sales variance, expected physical cash, cash variance, inventory context, idempotency, audit, optimistic version checks, and workflow transitions. The UI never writes directly to PostgreSQL and never calculates authoritative totals.

Money, litres, and prices remain strings in the UI boundary. Formatting is presentation-only and preserves the server-provided decimal text.

## Draft persistence and locking

Draft persistence is deliberate and server-backed. A dirty indicator tells the user when local edits have not been sent; a successful save reloads the server read model. Refresh recovery is supported when the reconciliation ID is present in the URL. The workspace does not claim offline synchronization, multi-device conflict resolution, or background sync.

Every deliberate detail save creates one save-attempt ID. Each command in that attempt gets a stable key derived from the reconciliation, attempt, command index, and command type; a retry of the same in-flight attempt would reuse those keys. If a save outcome is uncertain or a command fails, A11 abandons that journal after reloading the canonical server draft, tells the user that the attempt is no longer resumable, and requires a new edit/save attempt. It never silently reuses an old key with a changed payload. A stale or locked response becomes a refresh-required conflict state. `SUBMITTED`, `PENDING_APPROVAL`, `APPROVED`, and `LOCKED` records are read-only in the workspace. Corrections remain the responsibility of the canonical named revision workflow.

## Cash and provider distinctions

The workspace labels A5 payment evidence separately from counted cash, cash collected, cash banked, and provider settlement. An approved cash payment is not presented as collected or banked. POS/EcoCash evidence is not presented as settled merely because a reconciliation was approved. A6 and A9 summaries are optional downstream reads and are allowed to be unavailable when the current actor lacks the corresponding view permission.

## Mobile UX decisions

The primary flow is a vertical sequence of compact sections with a horizontal section index, large controls, decimal input modes, server-derived totals near the top, and responsive entry cards instead of a desktop spreadsheet. Desktop layouts add a sticky status/save rail. Tables are used only for linked evidence and collapse into labelled cards at narrow widths. Status is communicated by text and semantic status components, never colour alone.

## Permissions

The UI may hide or disable actions based on the current workflow view, but the server remains authoritative. The composition read requires the canonical `reconciliation.view` permission at station scope. The production command route performs the existing A1/A3 permission, station-scope, assurance, audit, idempotency, and version checks for `StartShift`, draft writes, submit, return, and approval. The visible role prop is presentation only; it is not an authorization boundary. A11 does not add browser role checks, weaken RLS, or accept tenant/station labels as authority.

The canonical role matrix gives `SUPERVISOR` reconciliation view/submit permission, `ADMINISTRATOR` view/submit/return/approve permission, and `ATTENDANT` only station, shift, meter, and meter-boundary permissions. An attendant therefore does not enter or edit A5 reconciliation evidence through this workspace; attendant operational input remains in the A3 meter-boundary workflow.

## Customer credit and prepaid behavior

A5 payment rows intentionally contain the canonical method, amount, reference, and note only; they do not accept a free-text customer account identifier. `CUSTOMER_CREDIT` and `PREPAID` are valid A5 payment methods. A8 later consumes an immutable payment-row ID plus reconciliation/revision evidence and the selected existing customer account: credit evidence must target a `CREDIT` account, while prepaid evidence must target `PREPAID_VALUE` or `PREPAID_LITRES`. A11 therefore does not invent account selection or a prepaid litres-to-money conversion; the existing A8 authorization/usage command remains the linkage capability.

## Known limitations and non-goals

- Station/day/shift context selection is supplied by an authorised route context; A11 does not invent or maintain a station master-data picker.
- A planned shift can be opened from the start card through the existing named `StartShift` command. A11 does not duplicate shift lifecycle state or fabricate a shift.
- Delivery and tank-dip linking is displayed when already linked. New inventory linkage remains in the canonical A4 command/read surfaces.
- Cash collection, deposits, bank confirmation, provider allocations, and settlement reconciliation remain in A6/A9 workspaces.
- No migration was added. A3–A10 schema and command capabilities are sufficient.
- A11 does not implement GL, tax, payroll, bank APIs, provider APIs, full offline mode, conflict merging, supplier/customer ledgers, inventory costing, or a reporting engine.
