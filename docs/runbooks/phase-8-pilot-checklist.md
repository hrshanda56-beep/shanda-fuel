# Phase 8 pilot and cutover checklist (DRAFT)

**Written for:** the owner and the person running the pilot at TEI Oils. Plain language.
**Status:** draft. It sits on top of [`v1-uat-training-shadow-week.md`](v1-uat-training-shadow-week.md)
(tests, training, shadow week, cutover steps) and adds the gates and the order of work. It does not
replace that runbook.
**Rule:** blank or unknown real-world values are onboarding data, not software problems. Never invent
figures, tax treatment or policy to fill a gap (see [`../onboarding/README.md`](../onboarding/README.md)).

## 0. Gates before any real figure is entered

Tick each one. Until all are ticked, work only on practice data.

- [ ] **Opening balances (#250):** the station page can take opening positions (stock, cash, bank, customers, suppliers) and the owner has checked it works. The traceability record still lists "real client setup" as partial.
- [ ] **Owner review done**, with no serious problem (P0/P1) open (AGENTS.md section 17).
- [ ] **Restore proof:** a Neon point-in-time restore has been tried and timed ([`backup-restore.md`](backup-restore.md), [`staging-recovery-rehearsal.md`](staging-recovery-rehearsal.md)). Do not put real figures into a system whose recovery is untested.
- [ ] **Release recorded:** production runs the exact approved release, and the smoke test result is written down with that release ID ([`production-readonly-smoke.md`](production-readonly-smoke.md)).
- [ ] **Authenticated page timings** measured on staging ([`staging-performance-verification.md`](staging-performance-verification.md)).
- [ ] **Observability and rate-limit proof** done ([`observability-staging-alert-proof.md`](observability-staging-alert-proof.md), [`staging-rate-limit-proof.md`](staging-rate-limit-proof.md)).

## 1. Choose the pilot station

- [ ] One station named by the owner. Everything below is for that station only.
- [ ] The owner agrees the pilot start date and who is on call.

## 2. Collect the onboarding data (can start now)

Use the workbook [`Shanda_Fuel_Discovery_Setup_Forms_Pack.xlsx`](../onboarding/Shanda_Fuel_Discovery_Setup_Forms_Pack.xlsx).
Fill in only what is known. Mark unknowns as unknown.

- [ ] Station and shifts
- [ ] Fuels, prices, tanks and tank calibration, pumps and nozzles
- [ ] Banks and payment channels
- [ ] Suppliers and transporters
- [ ] Credit customers and limits
- [ ] Staff, roles and which station each person works at
- [ ] Opening positions: litres and cost per tank, cash, bank balances, what customers owe, what suppliers are owed
- [ ] ZERA return details for the station: licence number, name on the licence, ownership, province

The owner and finance check the opening positions against the books before they are loaded.

## 3. Screens that changed since the test runbook was written

The test steps in the UAT runbook use older screen names. Before testers start, read it with these in mind
and fix any step that does not match the screen:

- The station page is now **Fuels**, with **The Whole Station** below it, and opening balances are asked in a guided flow.
- The old station editing screen is gone; adding, renaming, hiding and deleting now happen on the new pages.
- Tabs show names and use one style everywhere.
- **ZERA Returns** is under Reports in the side menu, so there are now more than the 18 reports in step 13.
- **Daily Operations** is a step-by-step flow with one button to open the day, so steps 5 to 9 need a fresh walk-through.
- Fuel and tank changes use guided flows ("Order more fuel when it falls to", standard check or own limits).

## 4. Role training (practice data only)

Follow the table in Part 2 of the UAT runbook. Add:

- [ ] Every trainee signs in with their own account first.
- [ ] One-page card per role, with the five most common tasks and who to call.
- [ ] Anyone who failed a test on their own role is re-trained and re-tested.

## 5. Shadow operation (one full week)

Follow Part 3 of the UAT runbook: staff keep the old method and also enter everything in Shanda Fuel.
Nothing in the old method is switched off.

### Classify every difference

| Class | Meaning | What happens |
| --- | --- | --- |
| Typing mistake | A person entered the wrong figure | Training point. Correct it. |
| Missing feature | The work cannot be recorded as the station does it | Owner decides: fix before go-live or write down a workaround |
| System fault | The app calculated or saved something wrong | Fix before go-live. Counts as a serious problem if money is wrong or data is lost |
| Old method wrong | The paper or old record was mistaken | Note it, correct the old record |

## 6. Pilot exit gates

All must be true:

- [ ] Totals matched on at least 5 of 7 days, every difference explained and classified.
- [ ] No lost entries and no duplicates.
- [ ] Cash handovers recorded on every day they happened.
- [ ] No sign-in or permission problems open.
- [ ] No open system fault that gets money wrong, shows data to the wrong person, or loses data.
- [ ] Staff say they could run a shift without the old method.
- [ ] Owner has seen the week's reports, including the ZERA return, and agrees the figures are right.
- [ ] The restore test (gate 0) is still current.

## 7. Cutover

Follow Part 4 of the UAT runbook and [`v1-migration-and-release.md`](v1-migration-and-release.md). The old
method is switched off only after the first full day matches. A named person is on call for two weeks.

## Who does what

- **Developer side:** this checklist, practice data, bug fixes, the restore and timing checks.
- **Owner and staff only:** choosing the station, collecting and checking real data, training, the shadow week, the decision to go live.
