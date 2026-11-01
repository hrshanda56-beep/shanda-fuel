# Roles and what each can do

The full permission list for every role is in `src/platform/security/permissions.ts` (`DEFAULT_ROLE_PERMISSIONS`). This page says it in words. The server decides every action from these permissions; hiding a button is never the protection.

Where a role works is set by where it is assigned: the whole company, one legal entity, or one or more stations.

| Role | Assigned to | In plain words |
| --- | --- | --- |
| Owner | Whole company | Everything, including inviting administrators, approving large amounts and overriding limits. |
| Administrator | Whole company | Runs the company day to day: setup, staff, prices, expenses. Cannot invite another owner or administrator. |
| Finance | A legal entity (or the company) | Money: cash and banking, supplier payments, expenses, customer accounts, finance reports and exports. |
| Supervisor | One station | Runs a station: opens and closes the day and shifts, records dips and deliveries, submits and approves shift reports (never their own), approves small expenses up to the limit the owner sets. Sees operational reports, not profit. |
| Attendant | One station | Captures pump readings for their shift. Nothing else. Cannot change prices or see other stations. |
| **Area manager** (new) | Two or more stations | A supervisor over several stations, plus the finance reports. Sees only the stations assigned, never the others. |
| **Auditor** (new) | Whole company | Reads every screen. Can do nothing: no recording, no approving, no editing, no exports. |
| **Cash collector** (new) | One or more stations | Receives cash collections from stations and hands cash on (submits and accepts handovers). Sees deposits. Cannot see reports, sales or profit. |

## Rules that apply to everyone

- **Nobody approves their own submission.** The person who submitted a shift report, expense, purchase order, price change or cost change cannot approve it. Only a sole owner (the last resort) may approve their own, and only when no one else can. Supervisors and attendants are never counted as the second approver.
- **Locked and approved records cannot be edited.** The server refuses it; a change needs a recorded correction.
- **The auditor and the attendant cannot change anything outside their own work**, tested on the real routes in `tests/integration/roles-enforcement.test.ts`.
- **Stations are separate.** A person assigned to Station A cannot read or change Station B, or another company, through any route.

## How the three new roles are kept honest

- The sets are written in the code, in migration `0094_extra_roles.sql`, and in unit tests that state each set in full, so a change is a visible change (`src/platform/security/extra-roles.test.ts`).
- `tests/integration/role-permissions-parity.test.ts` compares the database with the code for all eight roles.

## A baseline gap found while doing this

Some permissions exist only in the code and are not in the database's permission list (for example `provider.batch.record`), and a few permissions the code gives the original roles are not granted in the database's role table (for example `cash.collection.record`). The application authorises from the code, so nothing is wrong on screen, but the two lists should be brought together in a later migration. The parity test only asserts that the database never grants more than the code for the original five roles, and is exact for the three new ones.
