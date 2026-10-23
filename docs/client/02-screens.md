# Screen guide: what exists and what is new

**Written for:** the owner of TEI Oils. No technical knowledge is needed.

Part 1 lists the screens that already exist. Part 2 shows simple sketches of the **new** screens for
your approval. The sketches show what is on the screen and where. They are not final colours or
wording, and every number in them is a made-up placeholder. The real screens never show made-up
numbers; where nothing exists they say so.

## Part 1: screens that exist today

Names follow the app's menu. **UNVERIFIED:** exact menu wording was taken from the page folders, not from a live walk-through.

| Screen | What it is for | Who uses it |
| --- | --- | --- |
| Sign in / Invite / Join | Sign in; a new employee joins with an invitation and activation code | Everyone |
| Dashboard (home) | Sales, litres, cash variance, account sales, trend, unsubmitted reports | Owner, managers |
| My Shift | An attendant's own work for the shift | Attendant |
| Daily Operations | The day for a station: readings, payments, variances, submit | Supervisor |
| Reconciliations (list, detail, review) | Check each day's money against the pumps, then approve and lock | Supervisor, management |
| Cash | Collections, handovers, counts, bank deposits, slips | Supervisor, finance |
| Settlements | Card and mobile-money batches, fees, what is awaiting | Finance |
| Inventory | Tanks, dips, expected stock, deliveries | Supervisor |
| Inventory valuation | Cost of fuel in stock, weighted average, revaluation | Finance, owner |
| Purchasing (list, order detail) | Purchase orders and supplier invoices | Finance |
| Suppliers (list, detail) | What we owe each supplier, statement, credit limit | Finance |
| Customers (list, detail) | Credit and prepaid accounts, limit, ledger, statement | Finance |
| Expenses | Expenses, receipts, corrections, fixed costs | Finance |
| Finance | Net current position and finance summary | Owner, finance |
| Profitability | Gross margin and income statement | Owner |
| Reports | 17 reports with CSV, PDF and Excel downloads (cash custody, bank deposits, daily reconciliation, delivery variance, expenses detail, stock movements, supplier statement, customer statement, tank dip history, and others) | Owner, finance |
| Settings | Stations, fuel, prices, tanks, pumps, staff, reminders, activity log | Owner, administrator |
| Workplace | Staff area | Staff |

Screens are laid out for phone, tablet and computer, in light and dark mode. The screens you
approved on 2026-10-22 are locked: they change only with your approval (see decisions file).

## Part 2: new screens (sketches for approval)

Each sketch uses the same frame as today's pages: the menu on the left (a menu button on a phone),
a page title, then cards and tables.

### N1. Daily profit

For the owner. One page that answers "did we make money on this day, and from which fuel?".
Uses the day's sales, the cost of the fuel sold, that day's expenses and the day's share of fixed costs.

```
+--------------------------------------------------------------+
| Daily profit            Station [ All v ]   Date [ 2026-.. v]|
+--------------------------------------------------------------+
|              | Diesel | Petrol | Combined |                  |
| Sales        |  ----  |  ----  |   ----   |                  |
| Cost of fuel |  ----  |  ----  |   ----   |                  |
| Gross profit |  ----  |  ----  |   ----   |                  |
| Gross profit |        |        |          |                  |
|  per litre   |  ----  |  ----  |   ----   |                  |
| Expenses     |        |        |   ----   |                  |
| Fixed-cost   |        |        |          |                  |
|  share       |        |        |   ----   |                  |
| OPERATING    |        |        |          |                  |
|  PROFIT      |        |        |   ----   |                  |
+--------------------------------------------------------------+
| Day not yet approved: figures are provisional.               |
+--------------------------------------------------------------+
```
Notes: if the day has no approved data, the table says "not available" instead of showing zeros.
How fixed costs are shared between fuels is **UNVERIFIED** and needs your confirmation.

### N2. Financial position

For the owner. A fuller version of today's Net Current Position, adding stock and bank.

```
+--------------------------------------------------------------+
| Financial position                         As at [ date v ]  |
+--------------------------------------------------------------+
| WHAT WE HAVE                    | WHAT WE OWE                |
|  Stock (fuel in tanks, at cost) |  Suppliers                 |
|  Bank balance                   |  Transporters / others     |
|  Cash not yet banked            |  Unpaid expenses           |
|  Card / mobile money awaiting   |  Customer prepayments      |
|  Customers owe us               |                            |
|  ----------------------------   |  ------------------------- |
|  Total                  ----    |  Total             ----    |
+--------------------------------------------------------------+
| NET POSITION  ----    [ Positive ]  or  [ Negative ]         |
+--------------------------------------------------------------+
```
Notes: bank balance and other-liability inputs do not exist today; until they are entered the line says "not entered".

### N3. Dashboard finance tiles

Added below the tiles that exist today. Each tile opens its detail page (whole tile is clickable).

```
+--------------+--------------+--------------+--------------+
| Gross profit | Operating    | Stock value  | Cash at      |
| today        | profit today |              | stations     |
|  ----        |  ----        |  ----        |  ----        |
+--------------+--------------+--------------+--------------+
| Banked       | Card/mobile  | Customers    | We owe       |
|              | awaiting     | owe us       | suppliers    |
|  ----        |  ----        |  ----        |  ----        |
+--------------+--------------+--------------+--------------+
| Expenses awaiting approval                                 |
|  ----                                                      |
+------------------------------------------------------------+
```
Notes: a tile with no real data says "not available". No tile shows an invented number.

### N4. Supplier payments due in 7 / 14 / 30 days

For finance and the owner.

```
+--------------------------------------------------------------+
| Supplier payments due        [ 7 days | 14 days | 30 days ]  |
+--------------------------------------------------------------+
| Overdue                                          total ----  |
|  Supplier A    Inv 123    due 2026-..   ----                 |
+--------------------------------------------------------------+
| Due within 7 days                                total ----  |
|  Supplier B    Inv 130    due 2026-..   ----                 |
+--------------------------------------------------------------+
| Due within 14 days / 30 days ...                             |
+--------------------------------------------------------------+
```
Notes: each row opens that supplier's invoice. The 7/14/30 split is the brief's suggestion; the cut-offs will be settings.

### N5. Delivery details

Added to today's delivery screen. One block per truck compartment.

```
+--------------------------------------------------------------+
| Delivery  Supplier ____  Transporter ____  Truck ____        |
| Driver ____                                                  |
+--------------------------------------------------------------+
| Compartment 1   Product [ Diesel v ]  Note qty ___  Got ___  |
|   Seal no. ____   Water test [ Pass | Fail ]  Photo [ + ]    |
| Compartment 2   ...                                          |
|   [ + Add compartment ]                                      |
+--------------------------------------------------------------+
| Dip before ___   Dip after ___   Difference ___  (colour)    |
| Driver confirms the quantities   [ Confirmed by ____ ]       |
|                                  [ Save delivery ]           |
+--------------------------------------------------------------+
```
Notes: today there is one seal per delivery and no water test; these are the additions.

### N6. Customer account transaction details

Added to each line of the customer's ledger.

```
+--------------------------------------------------------------+
| Transaction  2026-.. 14:05            Customer ____          |
+--------------------------------------------------------------+
| Litres ___   Product ___   Amount ----                       |
| Vehicle registration ____    Driver ____                     |
| Voucher no. ____             Approved by ____                |
| Supporting document  [ photo / PDF ]                         |
| Above credit limit?  [ Management override: name + reason ]  |
+--------------------------------------------------------------+
```
Notes: the override needs a named manager and a reason, and is written to the activity log.

### N7. Customer ageing  (waits on your decision)

```
+--------------------------------------------------------------+
| Customers who owe us                         As at [ date v ]|
+--------------------------------------------------------------+
| Customer      | Current | 1-30 days | 31-60 | 61-90 | 90+    |
| Customer A    |  ----   |   ----    | ----  | ----  | ----   |
| Customer B    |  ----   |   ----    | ----  | ----  | ----   |
| Total         |  ----   |   ----    | ----  | ----  | ----   |
+--------------------------------------------------------------+
```
Notes: the day ranges and the rule for which charge a payment clears are **your decision** (file 05, question 2).

### N8. Sales by attendant  (waits on your decision)

```
+--------------------------------------------------------------+
| Sales by attendant        From [ date ] To [ date ]  Station |
+--------------------------------------------------------------+
| Attendant   | Shifts | Litres | Sales | Cash short/over      |
| Name A      |  ..    |  ----  | ----  |  ----                |
| Name B      |  ..    |  ----  | ----  |  ----                |
| Shared      |  ..    |  ----  | ----  |  ----                |
+--------------------------------------------------------------+
```
Notes: how a shared shift is credited is **your decision** (file 05, question 1). The "Shared" row only appears if you choose that option.
