# v1 user testing, training and shadow week (DRAFT)

**Written for:** the people running go-live at TEI Oils: the owner, a trainer, and the supervisors and
finance staff who will test. Plain language; no technical knowledge needed.
**Status:** draft. Screen names follow the current app; adjust a step if a screen has been renamed.
Do all of this on a **practice (staging) copy with made-up data**, never on live data.

## Part 1: User acceptance test (UAT)

Run each test with the person who will really use the screen. The tester reads a step, does it, and
says "pass" or "fail". Write down anything confusing even if it passed. **A test passes only if the
tester finished it without help.**

### Setup
- Practice data: 2 stations, 2 fuel types with prices, 3 tanks, 4 pumps, 5 staff (one in each role), 2 credit customers, 2 suppliers.
- Each tester signs in with their own account. No one shares a login.

### Attendant
1. Sign in on a phone. Open **My Shift**. You should see only your own work.
2. Record a pump reading and a payment. Check the totals update.
3. Turn off mobile data and save the daily report. The screen should say it is saved on the phone. Turn data back on. It should say it was sent.
4. Try to attach a photo. You should be told you may not (attendants cannot upload).

### Supervisor
5. Open **Daily Operations** for your station. Review an attendant's entries.
6. Take a tank dip. Check the colour (green matches, yellow close, red far, "not checked" if none).
7. Receive a fuel delivery. Enter the amount on the delivery note and the amount received. Attach a photo of the note.
8. Hand over cash: record who handed, who received, expected and counted amounts. Use a counted amount that is a little short and read the message.
9. Approve the shift.

### Finance
10. Record a supplier invoice and a payment. Try to use the same document number twice: it should be refused.
11. Add an expense with a receipt. Correct it afterwards and check the history shows both.
12. Record a bank deposit and confirm it.
13. Open **Reports**. Run each of the 18 reports for a one-week range with the practice data. Download the CSV of three of them and open the file in Excel. Check that figures are not cut off or turned into dates.
14. Open the **Action Center** and read the alerts.

### Owner / administrator
15. Open **Settings > Station setup**: add a fuel type, price, tank and pump without help.
16. Open **Settings > Reminders** and change a threshold. Check an alert changes accordingly.
17. Invite a new employee. They activate their account using the code. A wrong code five times locks it; a new code is issued.
18. Open the **Activity log** and find the change you just made.
19. Check a customer's credit limit by making an account sale above it. It should warn or refuse as agreed.

### For every screen
- Works on a phone, a tablet and a computer. No sideways scrolling on the phone.
- Readable in light and dark mode.
- No made-up numbers. Where nothing exists the screen says so.
- Error messages say what to do next, in plain words.

### Result sheet
```
Test no.   Tester (role)   Pass / Fail   What was confusing   Fixed? (date)
```
Go-live needs: every test passed, no open "serious" problem (money wrong, wrong person can see or do something, data lost).

## Part 2: Training

Keep sessions short and practical. Every trainee does the task, not just watches.

| Group | Length | What they learn | Hands-on task |
| --- | --- | --- | --- |
| Attendants | 45 min | Sign in, My Shift, saving without signal, what to do on a conflict message | Complete a shift entry on practice data |
| Supervisors | 90 min | Daily Operations, tank dips, deliveries, cash handover, approving, photos | A full day on practice data, including a short cash count |
| Finance | 90 min | Suppliers, expenses, deposits, reports and exports, corrections | Reconcile a practice week and export reports |
| Owner / administrators | 60 min | Dashboard, Action Center, settings, staff and roles, activity log | Add a station setting and invite a person |

Give each trainee a one-page card for their role listing their five most common tasks and who to call.
Do not train on live data. Re-train anyone who failed a UAT test on their own role.

## Part 3: Shadow week

For one full week, staff keep working exactly as they do today (paper or the old method) **and** also enter
everything in Shanda Fuel. Nothing in the old method is switched off.

Each day:
1. Supervisor compares the day's totals: litres sold, money by method, cash counted, against the old method.
2. Any difference is written in the log with the reason (data entry mistake, missing feature, system fault).
3. A difference caused by the system is a problem to fix before go-live. A difference caused by a typing
   mistake is a training point.

End of week review, all must be true to go live:
- [ ] Totals matched on at least 5 of 7 days with every difference explained.
- [ ] No lost entries and no duplicates.
- [ ] Cash handovers recorded on every day they happened.
- [ ] No sign-in or permission problems left open.
- [ ] Staff say they could run a shift without the old method.
- [ ] Owner has seen the week's reports and agrees the figures are right.

### Daily log
```
Date   Station   Old total   New total   Difference   Reason   Fixed? (Y/N, by whom)
```

## Part 4: Cutover (go-live day)

Done by people, in this order, with the owner present:
1. Release steps from [`v1-migration-and-release.md`](v1-migration-and-release.md) pass, including the smoke test.
2. Load real starting data (stations, tanks, calibration, prices, suppliers, customers, opening balances), then have the owner and finance check it against the books.
3. Staff sign in for the first time with their activation codes; confirm each one.
4. Switch off the old method **after** the first full day matches.
5. A named person is on call for the first two weeks.

## Who does what
- **Developer side (can be drafted and tested in advance):** this document, the practice data, bug fixes.
- **Owner and staff only:** running UAT, training, the shadow week, loading real data and deciding to go live.
