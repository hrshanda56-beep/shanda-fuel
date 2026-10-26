# Shanda Fuel v1: the answers we propose (DRAFT, owner to confirm)

**Written for:** the owner of TEI Oils. No technical knowledge needed.
**What this is:** answers to the questions in [`v1-owner-decisions.md`](v1-owner-decisions.md), chosen to
match good practice for a fuel forecourt in Zimbabwe: mostly US dollars, a lot of cash, EcoCash and card
payments that arrive days later, patchy signal, and fuel quality risks.
**Status of each line:** *In the app* means it already works that way. *Setting* means it can be changed
later without rebuilding. *Not built yet* means it is agreed but still to do.
Nothing here is final until you mark it **Agree** or write your change.

## Money owed to you and by you

| # | Question | Proposed answer | State | Agree / change |
|---|---|---|---|---|
| 1 | Sales by attendant | A shift worked by one person is credited to them. A shift worked by several is shown as "Shared shift". Never split equally. | In the app, can be changed | Agree (decided for the owner) |
| 2 | Customer ageing | A payment clears the oldest unpaid charge first. Ageing columns: current, 1–30, 31–60, 61–90, over 90 days. | In the app | Agree (decided for the owner) |
| 3 | Customer credit terms | Each credit customer has a credit limit set when the account is opened. | In the app | Agree (decided for the owner) |
| 4 | Fuel on credit | The vehicle registration and the voucher number must be written for every sale on credit. The driver's name is optional. | In the app | Agree (decided for the owner) |
| 5 | Voucher numbers | A voucher number can be used once per customer account. Capital letters and extra spaces are ignored. | In the app | Agree (decided for the owner) |
| 6 | Credit limit exceptions | An exception names who approved it and why. A change to the limit itself is a separate recorded action. | In the app | Agree (decided for the owner) |
| 7 | Who may approve | Only an owner or an administrator. Nobody except an owner approves their own entry. | In the app | Agree (decided for the owner) |
| 8 | Staff fuel benefit | Recorded as its own type of account with a monthly cap; the cost goes to expenses, not sales. | Not built yet | Agree (decided for the owner) |
| 9 | Supplier invoice terms | Every supplier invoice must say **Cash** or **Credit**. Credit needs a number of days or a due date. | In the app | Agree (decided for the owner) |
| 10 | Supplier default period | None. The period is chosen per invoice. | In the app | Agree (decided for the owner) |
| 11 | Supplier payment proof | Optional in v1. Payments over US$1,000 with no proof are flagged for review. | Photos not covered yet; flag not built | Agree (decided for the owner) |

## Cash, banking and card money

| # | Question | Proposed answer | State | Agree / change |
|---|---|---|---|---|
| 12 | "Fully banked" | Cash counts as fully banked only with a **bank reference** and a **deposit slip photo** on file. Until then it shows "On its way" or "Partly banked". | In the app | Agree (decided for the owner) |
| 13 | "Partly banked" | Some, but not all, of the counted cash has been deposited. | In the app | Agree (decided for the owner) |
| 14 | Card and EcoCash overdue | Card: overdue after 3 days. EcoCash and other mobile money: after 5 days. | In the app (days can be changed in Settings) | Agree (decided for the owner) |
| 15 | Cash shortage | A reason is required for any shortage. Amounts under US$1 are ignored in alerts. | Reason required: in the app. Threshold: setting | Agree (decided for the owner) |
| 16 | Working without signal for cash | Not in v1. The daily report can be saved on the phone; cash counts and handovers must be entered with signal. Review after the shadow week. | In the app | Agree (decided for the owner) |

## Fuel deliveries and stock

| # | Question | Proposed answer | State | Agree / change |
|---|---|---|---|---|
| 17 | Compartment totals | The compartments must add up exactly to the litres on the delivery note. One fuel type per delivery. | In the app | Agree (decided for the owner) |
| 18 | Water test | Switch it **on** for every delivery. A failed test stops the delivery from being accepted. | In the app, but the switch starts **off**: the owner turns it on once at go-live (Settings) | Agree (decided for the owner) |
| 19 | Stock and unpaid expenses on the money position | Shown "as of now" and labelled so. Figures with no data say "Not available". | In the app | Agree (decided for the owner) |

## Alerts and email

| # | Question | Proposed answer | State | Agree / change |
|---|---|---|---|---|
| 20 | Starting alert numbers | Invoice due soon: 7 days. Daily report late: 1 day. Large expense: US$500. Tank difference: 20 litres. Tune after the shadow week with real figures. | Settings | Agree (decided for the owner) |
| 21 | Alert emails | Once a day at 07:00 Harare time. Titles and a link only, no amounts or names. Sent to the owner and finance, and each supervisor for their own station. Each person can switch it off. Starts switched off until you turn it on. | Not built yet (needs a security check first) | Agree (decided for the owner) |
| 22 | Sending address | Which email address and domain should alerts come from? **alerts@fuel.shandahr.com** (a sub-address of the domain already used for the app, so it will not disturb the main company email) | Needs DNS set-up | Agree (decided for the owner) |

## Housekeeping

| # | Question | Proposed answer | Agree / change |
|---|---|---|---|
| 23 | The "interface is locked" rule | Written in the decision log as DEC-046 (DEC-045 was already taken). Draft wording is at the end of [`v1-owner-decisions.md`](v1-owner-decisions.md). | Agree (decided for the owner) |
| 24 | Who can do what (full roles table) | We prepare the table; you and whoever manages staff mark it up before go-live. | Agree (decided for the owner) |

**Decided on the owner's behalf on 2026-10-23, on the explicit instruction of the project lead, as the best fit for a Zimbabwe forecourt. The owner can still change any line.**

**Owner signature (name, date):** ______________________
