# Station onboarding checklist

Use this checklist for a real pilot station. Bindura is the proposed first pilot; the Owner may nominate another station. Complete the evidence column before the station is activated.

## 1. Scope and ownership

- [ ] Owner has named the pilot station and legal entity.
- [ ] The station operates under the intended tenant and legal entity; the authoritative station timezone is recorded from station metadata.
- [ ] Owner has named the accountable Supervisor, Attendant(s), Finance user and backup contacts.
- [ ] Owner has approved the cutover date, opening-day policy and who may approve reconciliations.

## 2. Configuration gates

- [ ] Organisation, legal entity and station identity are established through the approved provisioning path. The current app shows these records but does not expose a self-service creation screen.
- [ ] Active fuel products have canonical codes and names. The current operational contracts use litres and exact monetary precision; do not invent other units or currencies.
- [ ] Each active tank has a product, positive capacity and code. Record reorder level and acceptable variance where the business has approved them; missing acceptable variance leaves readiness partial.
- [ ] Every pump has an approved number/name and every nozzle has a pump, product, nozzle number and unique meter serial. `CreateNozzle` creates the meter and first installation atomically.
- [ ] Pump-to-tank/product assignments and calibration evidence have been reviewed. Calibration-point capture has no clearly identified self-service screen and must be retained as controlled evidence.
- [ ] Each priced product has a price, currency and effective timestamp. Use the draft → request → approve → prepare → activate flow; do not make a draft effective by SQL or a direct production grant.
- [ ] Active shift templates exist for the station and reflect the approved operating hours.
- [ ] Payment provider accounts and the legal-entity bank account are configured where electronic settlement or bank deposit is in scope. Enter only masked bank references in the app.
- [ ] Staff invitations or manual activations are complete, station scopes are correct, and every approval-capable user has completed the required MFA setup.

## 3. Opening position gates

- [ ] Opening tank quantities are supported by a dated physical count/dip and retained evidence.
- [ ] Each opening quantity has a matching approved inventory value/cost basis. Use the supported opening-balance and opening-inventory-cost commands; inventory must be valued before approval.
- [ ] Opening meter readings are captured as the first `SHIFT_OPEN` boundary when the first shift starts. Do not invent an opening reading while creating a nozzle.
- [ ] Opening cash and payment balances have a written Finance treatment. The current app supports cash declarations, handover/deposit and settlement workflows, not a generic pre-opening cash seed.
- [ ] Any opening tax/accounting treatment has been approved separately by the Owner and Finance user.

## 4. Pre-opening validation

- [ ] Settings → Readiness is checked for Prices, Tanks, Pumps, Shifts, Payments and Staff.
- [ ] The six-area panel is supplemented with checks for station activation, meter installation, opening meter readings, opening quantity and cost, and MFA enrollment; these are not all represented by the panel.
- [ ] Supervisor can see only the assigned station and assigned attendants.
- [ ] Attendant can see only the permitted station/shift functions and cannot approve.
- [ ] Owner/Finance can complete the authorized step-up path without bypassing MFA.
- [ ] A disposable or shadow rehearsal has passed before any real posting.

## 5. Evidence pack

Retain the signed station information form, legal/station evidence, tank and calibration records, meter serial list, price approvals, payment-account confirmations, staff-scope/MFA confirmation, opening stock count and valuation support, first-shift meter photos/readings, and the completed acceptance checklist. Never retain secrets or full bank account numbers in this pack.
