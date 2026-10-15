# Reusable station onboarding runbook

This runbook is for a real station after the operational release has passed its own release gates. It is intentionally data- and evidence-led; do not create synthetic production records.

## 1. Nominate and collect

1. Owner nominates Bindura or another pilot station and names the accountable Supervisor and Finance user.
2. Complete [`BUSINESS_INFORMATION_TEMPLATE.md`](BUSINESS_INFORMATION_TEMPLATE.md) and attach legal, equipment, price, payment, staffing, count and valuation evidence.
3. Resolve every blank that is required before activation. If the value is a business decision, record the decision owner rather than guessing.

## 2. Establish the controlled scope

1. Use the approved provisioning path to establish tenant, legal entity and station records. Stop if no authorized provisioning path is available.
2. Confirm the station timezone from station metadata and keep the station in its controlled onboarding state.
3. Review role assignments and station scopes. Invite staff through Settings → Staff using email or the supported manual activation path; do not share credentials.
4. Have approval-capable users enroll Better Auth MFA and complete a non-production step-up test.

## 3. Configure the station

1. Create/confirm products, tanks, pumps and nozzles through the authorized setup commands and Inventory surface. Verify product, pump, tank and nozzle relationships and each meter serial.
2. Retain calibration evidence and assign a reviewer; the current app does not expose a clear calibration setup screen.
3. Define approved shift templates.
4. Submit prices as drafts, then follow request → approve → prepare → activate. Record the effective timestamp and approver.
5. Configure in-scope providers and the legal-entity bank reference in Payments. Use masked references only and complete the required step-up.

## 4. Establish opening positions

1. Finance and the Supervisor witness the dated tank count/dip and retain the evidence.
2. Record opening quantity for each tank using the supported inventory workflow.
3. Record the matching opening inventory cost/value and confirm the stream is valued before any approval. Reconcile the source documents to exact stored precision.
4. Agree opening cash/payment treatment separately; do not seed an unsupported balance.

## 5. Validate and activate

1. Run Settings → Readiness and clear Prices, Tanks, Pumps, Shifts, Payments and Staff as applicable.
2. Run the additional cutover checks: station ACTIVE transition, meter installation list, opening stock/cost evidence, MFA, staff isolation and payment-method scope.
3. In a disposable or approved pilot environment, run the acceptance journey: Owner sign-in; Supervisor sign-in and attendant selection; open day; start shift; opening meters; close meters; payment declarations; supported expenses; reconciliation submission; Owner step-up; approval; final reporting.
4. Test cross-tenant/station and cross-role denial. Capture commit SHA, environment, fixture/account identifiers and expected/actual totals.
5. Obtain Owner and Finance sign-off before moving from onboarding to live opening.

## 6. First business day

1. Supervisor opens the business day using station time and starts the approved shift.
2. Record the first physical meter readings as `SHIFT_OPEN` boundaries. Preserve photos/log references and investigate any lower-than-prior reading through the controlled exception path.
3. Attendants capture only their assigned meter work. Supervisor closes/seals meters and records payment declarations.
4. Supervisor submits reconciliation. The authorized Owner/Finance approver completes the required MFA step-up and approves only after reviewing exact totals and evidence.
5. Finance reviews settlement, cash handover/deposit and daily reports where in scope.

## 7. Corrections and closeout

Use supported workflows: revise/return a reconciliation, controlled meter correction/replacement, deactivate and replace a tank/nozzle, draft a new price change, or request an inventory-cost revaluation. Do not edit tables directly, disable RLS, broaden permissions or reuse a stale approval.

Store the completed checklist, source evidence, approvals, acceptance results and known exceptions in the station handoff pack. Record any unresolved dependency as a blocker with an owner and due date.
