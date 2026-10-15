# Station onboarding role and responsibility matrix

The matrix reflects the current permission model and existing workflows. The Owner may assign a narrower operational policy, but must not widen access by bypassing the application authorization boundary.

| Activity | Owner | Finance | Supervisor | Attendant | Evidence / control |
|---|---|---|---|---|---|
| Supply legal/station identity and approve activation | A/R | C | C | I | Approved provisioning and activation record |
| Maintain products, tanks, pumps, nozzles and shift templates | A/R | C | I | I | Authorized setup commands; no SQL edits |
| Request/change prices | A/R | C | I | I | Draft/request/approve/prepare/activate separation |
| Review/approve/activate prices | A | C | I | I | Separate approval permission and audit trail |
| Configure providers/bank references | A/R | R/C | I | I | Payments UI/API, masked values and step-up |
| Invite and scope staff | A/R | C | I | I | Settings Staff; role and station-scope checks |
| Enroll MFA and test approval step-up | A/R | R for own account | R for own account | R for own account | Better Auth setup/verify; never share secrets |
| Approve station opening/cutover evidence | A | R/C | C | I | Signed information and evidence pack |
| Open business day | A | I | R | I | Station timezone and business-day audit |
| Start/close shift and capture meter boundaries | A | I | R | R within assigned shift | Physical evidence and sealed readings |
| Declare payments/cash and submit reconciliation | A | C | R | I/C as assigned | Submitter and approver remain distinct |
| Approve/post reconciliation | A/R | R where permissioned | I | I | MFA step-up and approval audit |
| Review expenses, settlement and reporting | A | R | C | I | Exact totals and supporting documents |
| Correct an error | A | R for finance data | R for operational data | R only through assigned workflow | Return/revise, controlled meter correction, revaluation or new setup record |
| Demonstrate isolation | A/R | R | R | R | Cross-tenant/station and role-denial tests |

Legend: **A** accountable, **R** responsible, **C** consulted, **I** informed. Actual assignment is constrained by tenant, legal-entity and station scope plus the permission checks in the application.
