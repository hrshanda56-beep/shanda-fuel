# Onboarding readiness gaps and dependencies

These are bounded readiness findings from the current source tree. They are not permission to add new product behavior or to bypass a release gate.

## Blocking dependencies for a real first station

1. **Organisation/legal-entity/station provisioning:** Settings exposes existing records but no self-service create workflow was found. A reviewed owner/admin provisioning operation must establish these records before station setup can begin.
2. **Real business inputs:** The Owner and Finance user must supply legal identity, products, tank/capacity/count data, calibration evidence, meter serials, prices, payment/bank references, staff scopes, opening quantities and valuation policy. Unknown values cannot be inferred safely.
3. **Station activation approval:** The station must remain in the controlled onboarding state until schedule/readiness and business approvals are complete.
4. **Real-account acceptance:** Better Auth sign-in, staff MFA enrollment, approval step-up and cross-station denial require acceptance with approved accounts in a disposable or authorized pilot environment.

## Current application coverage

- API/commands exist for products, pumps, nozzles/meters, prices, tanks, opening inventory quantity and opening cost, shift templates, payments and staff.
- Inventory, Payments and Staff have visible workflow surfaces. No dedicated self-service setup screen was found for products, pumps, nozzles, prices or shift templates; use only the approved authorized tooling.
- Settings → Readiness reports six areas: Prices, Tanks, Pumps, Shifts, Payments and Staff. It is a prerequisite indicator, not a complete cutover certificate.

## Readiness checks that need a separate acceptance step

The readiness panel/blockers do not by themselves prove every active nozzle has a meter installation, that opening meter readings exist, that opening stock has an approved cost, that the station is ACTIVE, or that approval-capable users have enrolled MFA. The pilot checklist therefore requires explicit evidence for each item.

## Business decisions still required

- Which payment methods, providers, settlement accounts and bank deposits are in scope.
- Opening cash/payment balance treatment, tax/accounting mapping, valuation policy and variance thresholds.
- Whether expenses are in scope for the pilot; do not assume support beyond the configured workflow.
- Calibration evidence standard and responsible reviewer.
- Pilot station choice if the Owner selects a station other than Bindura.

## Not changed by this readiness package

No migrations, ACLs, RLS policies, auth controls, financial postings, production data, staging data, Phase 2 modules or release-owned operational code were changed.
