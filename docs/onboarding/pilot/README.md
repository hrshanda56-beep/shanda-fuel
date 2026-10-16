# Pilot station onboarding and acceptance

Status: **PARTIALLY READY**. Source reviewed on 16 October 2026 (Africa/Harare).
Accepted production baseline supplied by Owner: `99bbe34cd9e978288f4ffb55fcad9f144e127922`.
This handover targets local operational candidate `871dcd45c11893149947e7ee3e412505dcc1534b` plus the bounded readiness correction on this branch. Neither candidate nor this branch is claimed deployed.

Bindura is a proposed pilot only. The Owner must confirm the actual station, legal entity, cutover instant and accountable people. No real station configuration, account, balance or transaction was created in this task. No production/staging was contacted.

Use this pack with the [existing discovery workbook](../README.md). Do not substitute demonstration seeds for real onboarding. Unknown business facts remain unknown; no default stock, price, cost, balance, timezone or role grant may be invented.

- [Business-information collection template](business-information.md)
- [Supported workflows, command map and product gaps](workflows.md)
- [Configuration sequence and evidence requirements](configuration.md)
- [Opening stock, valuation and financial cutover](opening-evidence.md)
- [Responsibility, staff access and readiness acceptance](acceptance.md)
- [Validation evidence and integration handoff](validation.md)

## How to use this pack

1. Owner completes business information and names the pilot and cutover approvers.
2. Integration owner confirms deployed SHA, explicit migration state, authentication provider and final release gates. Web deployment alone does not prove database readiness.
3. Authorized setup staff follow the supported sequence in configuration.md. Missing application workflows are escalated for development or a separately reviewed operator procedure; these documents do not authorize SQL imports or ad-hoc API work in production.
4. Finance verifies independent opening quantity and cost evidence; access administrator verifies real staff scopes without sharing credentials.
5. Trainer demonstrates supported flows in an authorized synthetic training environment. The first real station follows its approved cutover plan only after explicit acceptance.
6. Owner signs the readiness checklist with unresolved items visible. Settings' **Setup complete** is a limited configuration summary, not financial/cutover certification.

Keep the completed pack in the approved restricted business-records location. Do not commit real account numbers, personal staff data, passwords, MFA codes, recovery codes, invitation tokens or production credentials.
