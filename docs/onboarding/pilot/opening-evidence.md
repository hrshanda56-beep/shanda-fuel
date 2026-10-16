# Opening stock, valuation and financial cutover

Owner confirms station, approved cutoff instant and responsible counters. Finance confirms value evidence and accounting basis. Nothing in this checklist authorizes creating real balances during development.

## Physical stock and valuation checklist

- [ ] Correct tenant/legal entity/station and authoritative station timezone confirmed.
- [ ] Tanks exist with correct fuel, physical identifiers and documented capacity/calibration.
- [ ] Actual opening quantity measured for each tank, with measurement time, method and independent verification.
- [ ] Quantity is consistent with tank capacity; unexplained mismatch is investigated before posting.
- [ ] No prior authoritative opening balance exists; avoid duplicate opening or overlap with deliveries/history.
- [ ] Authorized operator opens `/inventory`, selects the correct tank and **Record opening inventory**.
- [ ] Enter **Opening quantity litres** and **Effective at** from approved evidence; verify the interpreted instant before posting.
- [ ] Confirm persisted opening quantity through inventory evidence, not merely a success message.
- [ ] Obtain authoritative total opening inventory value and currency with a source reference. A selling price is not stock cost.
- [ ] Use the separate opening-cost form (`RecordOpeningInventoryCost`) only once source evidence is known; preserve exact decimal scale.
- [ ] Reopen `/inventory/valuation`; verify coverage/value state and trace missing-cost notices. Missing cost is not zero cost and cannot support profit certification.
- [ ] Finance compares quantity and value to source documents and signs the tank-by-tank cutoff record.
- [ ] Real opening meter boundaries are captured separately; tank stock is not nozzle throughput and capacity is neither of them.

## Time-entry limitation

The current inventory forms convert `datetime-local` using browser-local `new Date(value).toISOString()` rather than station timezone. This affects opening stock and other inventory evidence times. It is a confirmed source-level onboarding risk; no browser reproduction or correction is claimed in this bounded readiness change. Refer it to the inventory/integration owner for a station-time input contract and regression test. Do not certify a cross-timezone cutover until the entered instant is unambiguous and verified through a supported reviewed workflow. Do not guess or change the workstation timezone as an undocumented workaround.

## Opening cash and financial balances

- [ ] Owner/Finance supplies physically counted cash by custody location and cutoff, including accountable counter/receiver.
- [ ] Bank/provider statements and outstanding deposits/settlements are reconciled at cutoff.
- [ ] Customer/supplier balances and unpaid items have reviewed source evidence and currency.
- [ ] Integration/Finance owner confirms a supported opening-balance import/posting contract before migration of any such positions.
- [ ] No opening balance is disguised as a new sale, collection, payment, expense, delivery or deposit.
- [ ] No ledger, tax, FX or cross-currency conversion rule is invented to fill a gap.

A generic opening cash/bank/financial import path was not established in the inspected application. Collect evidence now; that missing workflow remains a cutover dependency where existing balances must be represented. A blank or zero-looking screen is not proof that the actual business starts with zero.

Tank record: ______ Product: ______ Quantity/source/time: ______ Value/currency/source: ______
Counter: ______ Independent verifier: ______ Finance acceptance: ______ Outstanding discrepancy: ______
