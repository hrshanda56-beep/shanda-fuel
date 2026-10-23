# Work estimate and timeline

**Written for:** the owner of TEI Oils. No technical knowledge is needed.

**Read this first.**
- The effort ranges below are **planning estimates, not quotes**. They are our first judgement from
  reading the code and are **UNVERIFIED**; the developer must confirm or change them.
- The **Cost** columns are blank on purpose. The developer fills in their own rates.
- The timeline counts **weeks from your approval**. No calendar dates are promised.
- One person-day is one person working one full day. Two people for one day is two person-days.
- Work starts after you approve the workflow and screens (files 01 and 02) and answer file 05.

## A. Work breakdown

| # | Area | What it covers | Effort (person-days) | Depends on | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | Prove it works | Add test sign-in accounts, repair the failing browser tests, re-run database, accessibility and phone-size checks | 6 to 12 | Test accounts | |
| 2 | Owner layer | Dashboard finance tiles, daily profit view, complete financial position | 8 to 14 | Your approval of screens N1 to N3 | |
| 3 | Supplier credit | Cash-or-credit flag, credit period and automatic due date, 7/14/30 view, reminders | 4 to 8 | Approval of N4 | |
| 4 | Customer accounts | Vehicle, driver, voucher, approver, document, limit override with approval | 5 to 9 | Approval of N6 | |
| 5 | Customer ageing | Ageing report and overdue alert | 2 to 4 | Your answer, file 05 question 2 | |
| 6 | Deliveries | Compartments, seals, water test, driver confirmation | 5 to 9 | Approval of N5 | |
| 7 | Cash and settlement statuses | Align status words and compulsory deposit proof with the brief | 3 to 6 | Your answer on minimum rules | |
| 8 | Reports and filters | Missing filters and dedicated reports | 5 to 9 | | |
| 9 | Sales by attendant | One report | 1 to 3 | Your answer, file 05 question 1 | |
| 10 | Alerts | Missing alert types | 3 to 6 | Your thresholds, file 05 question 7 | |
| 11 | Alert email | Daily email of alerts, per-person switch | 4 to 8 | Your answer, file 05 question 3, plus a security check | |
| 12 | Offline for cash | Only if you ask for it | 6 to 12 | Your answer, file 05 question 4 | |
| 13 | Release preparation | Scheduled backups, written release steps, exact-version record | 3 to 6 | | |
| 14 | Data load | Opening balances, stations, staff, customers, suppliers | 4 to 8 | Your data | |
| 15 | User test, training, shadow week | Run the test plan, train staff, one week alongside your current process, fix findings | 10 to 20 | Items 2 to 10 done | |
| | **Total (items 1 to 11, 13 to 15, without offline cash)** | | **63 to 122** | | |

Totals are simple sums of the ranges and inherit their uncertainty. Item 12 is optional and not in the total.

## B. Timeline (weeks from approval)

```
Week   1  2  3  4  5  6  7  8  9  10 11 12
 1     ####----
 2           ########
 3,4              ######
 5,9                  ####
 6,7                 ######
 8,10                   #####
 11 (if chosen)               ####
 13                               ##
 14                           ####
 15                                 ########
```
The chart is a rough sketch of order and overlap for **one to two developers**, about 10 to 12
weeks in total. **UNVERIFIED:** it depends on team size, on how quickly you approve screens and answer
questions, and on how many problems the shadow week finds. The developer should replace this with
dated milestones after agreeing team size.

Likely hold-ups, all on the list above: screen approval, the decisions in file 05, test accounts,
your opening data, and staff availability for training.

## C. Maintenance and support after go-live (template, no prices)

The developer fills in the blanks. Choose one option, or mix.

| | Option 1: Fixes only | Option 2: Standard | Option 3: Full care |
| --- | --- | --- | --- |
| Fix faults in what was delivered | Yes | Yes | Yes |
| Fault response time | ____ | ____ | ____ |
| Support hours | ____ | ____ | ____ |
| Support channel (phone, WhatsApp, email) | ____ | ____ | ____ |
| Monthly check that backups work | No | Yes | Yes |
| Software updates and security patches | No | Yes | Yes |
| Hosting and database bills (paid by TEI Oils, passed through, or included) | ____ | ____ | ____ |
| Small changes per month (hours included) | 0 | ____ | ____ |
| New features | Quoted separately | Quoted separately | Quoted separately |
| Staff retraining per year | No | ____ | ____ |
| Monthly price | | | |
| Minimum term | ____ | ____ | ____ |

Also to agree: who owns the data and code, what happens if the support agreement ends, and who holds
the passwords to hosting and the database (never shared by chat or email).

## D. Running costs outside the developer's fee
The app uses paid online services (hosting, database, file storage, sign-in, email if alerts are emailed).
We have not checked current plans or prices. **UNVERIFIED / blank:** developer to list each service
and who pays.
