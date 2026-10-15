# Business-information collection template

Complete one copy per station. Blank means “not yet supplied”; it is not permission to guess. Attach evidence or record the evidence reference for every completed section.

| Section | Required information | Required before activation? | Current support | Evidence / owner decision |
|---|---|---:|---|---|
| Tenant and legal entity | Legal name, registration/tax references, tenant/legal-entity relationship, accountable Owner | Yes | Existing records/read-only settings; creation is an approved provisioning dependency | |
| Station identity | Station code/name, address, authoritative IANA timezone, operating status and cutover date | Yes | Existing station context; activation is a controlled forecourt command | |
| Products | Product code/name/status, canonical unit (litres) and approved currency | Yes | `CreateProduct` API/command; no dedicated self-service screen found | |
| Tanks | Tank code, product, capacity litres, reorder level, acceptable variance, calibration/count evidence | Yes | `CreateTank` and Inventory UI/commands; acceptable variance is needed for READY | |
| Pumps and nozzles | Pump number/name; nozzle number, product, meter serial; pump/product/tank mapping | Yes | `CreatePump` and `CreateNozzle` commands; no dedicated setup screen found | |
| Meter installation | Installation/serial evidence, installation date and responsible reviewer | Yes | Created atomically by `CreateNozzle`; verify every active nozzle | |
| Calibration | Calibration points, method, date, reviewer and retained record | Yes for controlled operation | No clear setup command/screen located; controlled evidence required | |
| Prices | Product, unit price (exact decimal), currency, effective-from time, approver and activation evidence | Yes | Draft/request/approve/prepare/activate flow; approval is separate from request | |
| Shift templates | Code/name, duration, start time where used, active status and approved schedule | Yes | `DefineShiftTemplate` command; no dedicated setup screen found | |
| Payment methods | In-scope payment methods, provider, provider account reference/display name/currency, settlement owner | Per business scope; required for electronic settlement | Payments panel/API with privileged step-up | |
| Bank account | Legal entity, bank name, masked account reference and currency | Per business scope; required for bank settlement readiness | Payments panel/API; never enter the full account number | |
| Opening meters | Each nozzle’s first physical reading, timestamp, operator and photo/log reference | Yes before first sale | Captured at first shift open; not a nozzle-creation field | |
| Opening inventory | Tank quantity litres, count/dip timestamp and evidence | Yes before valued operation | `RecordOpeningBalance` command/UI path | |
| Opening valuation | Tank value/cost basis, currency, source document and Finance approval | Yes before approval | `RecordOpeningInventoryCost`; exact money precision applies | |
| Opening cash/payment balances | Approved cutover treatment and supporting ledger evidence | Separate Finance decision | No generic pre-opening seed found; use supported declarations/settlement flows | |
| Staff | Name, delivery method, role, tenant/legal-entity/station scope, contact, start date | Yes for operational staff | Settings Staff invitation/manual activation | |
| MFA and approval | MFA enrollment confirmation for Owner/approver and step-up test evidence | Yes for approval-capable users | Better Auth MFA setup and approval step-up | |
| Accounting/tax | Tax treatment, chart/account mapping, valuation policy, variance thresholds and reporting owner | Separate business approval | Workbook/evidence and Finance decision; do not infer | |

## Owner sign-off

- Pilot station: ____________________
- Legal entity: ____________________
- Cutover date/time and station timezone: ____________________
- Owner approval: ____________________ Date: __________
- Finance approval: ____________________ Date: __________
- Supervisor acceptance: ____________________ Date: __________

Do not place passwords, MFA secrets, recovery codes or full bank numbers in this document.
