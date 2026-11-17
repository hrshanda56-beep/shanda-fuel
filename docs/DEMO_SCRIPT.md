# Demo script: TEI Oils

**Status: written from a walk-through of the TEI Oils data on screen (dashboard, cash, finance, phone width). The shift workflow, suppliers and staff steps have not been re-walked on this data yet.** Figures below are from the seed as it stood on 2026-10-30; the seed always ends yesterday, so read them off the screen rather than quoting them.

## Before you start

1. Local, disposable database only. Never production.
2. Build the data (about 2 minutes, safe to repeat; it refuses any database not named `shanda_fuel_tei*` or `*_demo`):

   ```
   bash scripts/demo/reset-demo.sh
   ```

   It prints the command that starts the app on that data. Running the seed a second time on the same database changes nothing.

3. Sign in with the local sign-in page as:

| Person         | Role                           | Use for                                           |
| -------------- | ------------------------------ | ------------------------------------------------- |
| Rudo Mapfumo   | Owner                          | The main demo, approvals, receiving cash          |
| Farai Ncube    | Finance                        | Cash, suppliers, expenses, profit                 |
| Chipo Dube     | Supervisor, Harare Road        | A station-only view (no Purchasing, own station)  |
| Tafara Sibanda | Supervisor, Mutare Highway     | The second station                                |
| Tendai Moyo    | Attendant, Harare Road         | The narrowest view                                |

What is in the data: TEI Oils (Private) Limited with two stations, Harare Road and Mutare Highway, diesel and petrol, 30 days of shifts ending yesterday, cash collected and banked, three credit customers, two supplier invoices, and monthly rent and wages.

## Things to know before presenting

- **Pick This week or This month.** "Today" is empty because the data ends yesterday.
- **Yesterday's report is still waiting for approval at each station, on purpose (two reports).** Until it is approved, yesterday shows no sales and a loss. Approve them live (as Rudo, step 3): it is the best moment in the demo.
- **Report pages (Daily Profit and the others) show both stations** even when the top selector says one station. The dashboard follows the selector. This is a known question for the owner (`docs/DECISIONS.md`), so say "all stations" when you open them.
- **Shift cash expenses lower expected cash but do not show as expenses in profit** (also in `docs/DECISIONS.md`). Use the formal Expenses page when you want to show costs reaching profit.
- **No fuel deliveries and no card-payout settlements are in the data.** The Finance overview therefore lists card and mobile payments waiting to be matched to a settlement. Do not open Deliveries or Settlements.
- **The first visit to each page after starting the server is slow** because the development server compiles it. Open the pages once before you present. A page that has been opened loads in about half a second.

## A 15-minute path

1. **Dashboard (2 min), as Rudo.** Choose Harare Road and This month. Every tile says what it covers. Switch to This week and watch the totals move together. Switch the top selector to all stations and show both stations add up.
2. **Daily operations (2 min).** Open a past day: a closed, locked day with its shifts and a report. Show a day with a cash difference and the reason recorded on it.
3. **Approve yesterday (2 min).** Open yesterday's submitted report as Rudo. It reads as a review with "Approve or send back" at the end. Approve it (then the other station's), return to the dashboard, and watch yesterday's sales and profit appear. (The person who submitted a report cannot approve it; Rudo did not.)
4. **Cash to bank (3 min).** Cash and Banking: show where cash is (at the station, collected, deposited, bank confirmed) and that it adds up. Open the deposit that came in USD 5 short and read the bank's reason. Cash still at the stations is yesterday and the days not yet banked.
5. **Money owed (2 min), as Farai.** Suppliers: the two invoices and what is owed. Customers: the three credit customers and who owes what.
6. **Profit (2 min).** Finance: Operating profit on the dashboard against the profit statement for the same station and period. Rent and wages are recognised for the last month.
7. **A supervisor's view (1 min), as Chipo.** Only Harare Road, no Purchasing. Then Tendai: the narrowest view.
8. **On a phone (1 min).** Make the window 390 pixels wide and open Cash and Banking. Nothing scrolls sideways.

## Not yet demonstrable

The per-shift PDF and Excel report, the alerts bell and daily digest, pump tests, customer vehicles and drivers, the shortage ledger, fuel deliveries and card-payout settlements on this data. See `docs/HANDOVER.md` and `docs/AUDIT2.md`.
