# Shanda Fuel v1: decisions we need from the owner (DRAFT)

**Written for:** the owner of TEI Oils, who decides how the business works. No technical knowledge is needed.
**How to use it:** for each question, pick an option or write your own answer. Until a question is
answered, the feature stays unbuilt or switched off. We will not guess.
Our recommendation is marked, but it is only a recommendation.

---

## 1. Sales by attendant

**The question.** When two or more attendants work the same shift, how should the sales be split between them?

| Option | What it means | Good | Not so good |
| --- | --- | --- | --- |
| A. Split by pump | Each attendant is given pumps; their sales are what came through those pumps | Fair and exact | Staff must be assigned to pumps every shift |
| B. Split equally | Sales are divided evenly | Needs no extra work | Not fair if one attendant sold more |
| C. Show shared shifts as "shared" | Only shifts with one attendant are credited to a person; others are labelled "shared" | Never wrong | Less detail |

**Recommendation:** C to start, move to A if you assign pumps to people anyway.
**Your answer:** ________

## 2. Customer ageing (who owes, and for how long)

**The question.** When a credit customer pays, which of their old charges does the payment clear?

| Option | What it means |
| --- | --- |
| A. Oldest first | The payment clears the oldest unpaid charge first |
| B. A named charge | Whoever records the payment chooses which charge it settles |
| C. Just reduce the balance | No link to a charge; ageing is shown for the balance as a whole |

**Recommendation:** A. It is the usual practice and needs no extra typing.
**Your answer:** ________

## 3. Emailing alerts (ADR-020)

Alerts such as "a tank dip does not match the books" already show in the app. Emailing them means a
background job must look at many people's alerts when nobody is signed in, which the database
deliberately makes hard. The safe design is written up in `docs/decisions/ADR-020-alert-email-delivery.md`.
It needs a security check before it is switched on. Please decide:

1. **Who gets emails?** Owner and administrators; finance; supervisors for their own stations.
   *Recommendation:* all of these, each only for what they could already see in the app.
2. **When?** *Recommendation:* once a day at 07:00.
3. **What is in the email?** *Recommendation:* titles and a link only, never customer names or account numbers.
4. **Can people switch it off?** *Recommendation:* yes, per person, starting switched off until the owner turns it on.
5. **Sending address.** Which email address and domain should the alerts come from? ________

**Your answer:** ________

## 4. Starting numbers that are placeholders

The reminder settings (Settings > Reminders) use starting values until you choose real ones:
invoice "due soon" at 7 days, card and mobile payments "late" after 3 days, daily report "late" after
1 day, ignore cash shortages under 0.01. Also the allowed difference for a tank dip.
**Please confirm or change each.** ________

## 5. Offline entry (working without signal)

The daily report can already be saved on the phone when there is no signal, and is sent when the
signal returns. If someone else changed the same record meanwhile, the app shows a conflict and
never overwrites anything. Cash counts and cash handovers are **not** covered yet.
**Do you want those to work offline too?**
*Recommendation:* no, not for v1. Cash is where mistakes are most costly, and a delayed cash entry is
harder to check. Reconsider after the shadow week if staff lose signal often.
**Your answer:** ________

## 6. Documents on supplier payments

Photos and PDFs can be attached to deliveries, bank deposits, cash handovers, daily reports and
expenses. Supplier payments belong to the whole business, not one station, so they are not covered.
**Options:** attach them to the payment but visible to everyone with supplier access; or leave them out of v1.
*Recommendation:* leave out of v1.
**Your answer:** ________

## 7. Who can do what (the full list of roles)

The complete list of what each role (owner, administrator, finance, supervisor, attendant) may do is
still not written down in one place. The app has working rules today. Before go-live, please review the
roles table with whoever manages staff and confirm it. We will prepare the table for you to mark up.
**Your answer:** ________

## 8. Housekeeping decisions (yours, but quick)

| Item | What it means | Our suggestion |
| --- | --- | --- |
| Record the "interface is locked" rule in the official decision log | The screens you approved cannot be changed by accident; the rule is already enforced by an automatic test. This writes it in the log as well. It is a change to the official log, so we need your approval | Approve (draft wording in the next box) |
| Delete 212 old branches that are fully merged | They only clutter the project. The list is in `docs/audits/branch-review-2026-10-22.md`. Deletion cannot be undone | Approve, after you glance at the list |
| Remove finished work folders | Same idea, for merged work areas on the developer's computer | Approve |
| Review 12 work folders with unsaved changes | Someone should confirm nothing valuable is in them | We will list the contents for you |
| Send the work to GitHub | Needed so the automatic checks can run | Approve once the Clerk test keys are added |

**Draft wording for the decision log (DEC-045):** "The screens owner-approved on 2026-10-22 are
locked. A file listed in `docs/ui-lock/manifest.json` may change only with the owner's approval,
recorded in the same change by regenerating the manifest. New screens must be written for
non-technical users." **Approve / change:** ________

---

## What is not on this list because you already decided it

Supervisor means the person responsible for a station. An account sale must name the customer and is
checked against the customer's limit. Approved fuel is counted like fuel sold, with a named person and
a cost. Cash handover has no minimum amount. Amounts are in US dollars only. The link to ShandaHR is
not part of v1. (See DEC-044.)
