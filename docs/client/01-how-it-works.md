# How Shanda Fuel works, day by day

**Written for:** the owner of TEI Oils and the managers who run the stations. No technical knowledge is needed.

This describes the working day for each person. Steps marked **(new)** are being built now.
Steps marked **(your decision)** wait for an answer in file 05. Everything is in US dollars.

## The people and what they do

| Person | Their job in the app |
| --- | --- |
| Attendant | Records pump readings and the payments taken on their shift. Sees only their own work. |
| Supervisor | The person responsible for a station. Checks the attendants, takes tank dips, receives deliveries, hands over cash, approves the shift. |
| Finance | Records supplier invoices and payments, expenses, bank deposits, customer payments. |
| Owner / Administrator | Sets up stations, fuel, prices, staff and limits. Reads the dashboard and reports. Approves and locks. |

Every change is recorded with the person's name and the time. Nobody shares a login.

## The big picture

```
 Attendant        Supervisor          Finance            Owner
 ---------        ----------          -------            -----
 readings  --->   check + approve --> post to books --->  review, lock
 payments         dips, deliveries    bank, suppliers     dashboard,
                  cash handover       expenses, debtors   reports
```

## 1. Attendant: the shift

1. Sign in on a phone and open **My Shift**. You see only your own work.
2. Record the pump meter readings at the start and the end of the shift.
3. Record the payments taken: cash, card, EcoCash and the other methods, plus any fuel sold on a customer account.
4. If there is no signal, the daily report can be saved on the phone and is sent when the signal returns. Cash counts and handovers do **not** work offline yet **(your decision)**.
5. Send the report to the supervisor.

## 2. Supervisor: running the station

1. Open **Daily Operations** for your station and review each attendant's entries.
2. If the money counted differs from the money expected, write the reason. The difference is kept and shown, never hidden.
3. Take the tank dips. The app compares them with the books and shows green (matches), yellow (close) or red (far). The exact cut-offs are settings **(your decision)**.
4. Receive deliveries (see section 4).
5. Hand over cash (see section 3).
6. Approve the shift.

## 3. Cash, from the pump to the bank

```
 Cash taken      Counted by the     Handed over to    Counted by      Deposited     Bank
 at the pump --> supervisor     --> management    --> management  --> at the    --> confirms
                 (expected vs       (who gave, who    (expected vs    bank, slip     (finance)
                  counted)           received)         counted)       attached
```

1. The supervisor counts the cash and the app compares it with what the payments say it should be.
2. When cash moves from one person to another, both are named. There is no minimum amount.
3. Management counts what it received. Any shortage is shown against a person.
4. Finance records the bank deposit and attaches the slip.
5. Card and mobile-money payments are tracked as awaiting until the provider pays; late ones raise an alert.

Today the app does all of this, but the status words "held by management" and "fully banked", and a
**required** deposit slip, are not yet exactly as in your brief **(being built now)**.

## 4. Fuel deliveries and tank dips

```
 Truck arrives --> dip before --> offload --> dip after --> compare with     --> book the stock
 (driver, truck,   (each tank)                              delivery note       and cost
  seal)                                                     (note vs actual)
```

1. Record the supplier, transporter, driver, truck and seal number.
2. Take a dip before offloading and after. Enter the quantity on the delivery note and the quantity received.
3. Attach a photo of the note.
4. **(new)** Record each truck compartment, its seal, the water test and the driver's confirmation.
5. The difference between note and actual is shown as a delivery variance.
6. The cost of the new fuel is averaged with the stock already in the tank. This gives the cost used for profit.

## 5. Suppliers: what we owe

1. Finance records the supplier invoice with its due date and landed cost.
2. Payments can be made in instalments and split across several invoices.
3. The app shows each supplier's statement and warns when the supplier credit limit is reached.
4. **(new)** A view of what falls due in the next 7, 14 and 30 days.
5. **(new)** "Cash or credit" and the credit period on a purchase, so the due date is worked out for you rather than typed by hand.
6. Attaching proof of payment to a supplier payment is **(your decision)**; we recommend leaving it out of version 1.

## 6. Customers on account

1. Credit and prepaid accounts exist. Each has a limit; a sale above the limit is warned or refused.
2. Every account sale names the customer.
3. **(new)** Each transaction also records vehicle registration, driver, voucher number, approver and a supporting document.
4. The customer's payments are recorded by finance and appear on their statement.
5. **(new, your decision)** Ageing: how long each charge has been unpaid. It depends on which charge a payment clears.
6. **(your decision)** Whether "staff benefit" is a kind of customer account.

## 7. Expenses

1. An expense is added with its receipt.
2. A wrong expense is corrected, not deleted. The history shows both versions.
3. Fixed costs (rent, salaries) are spread into a daily amount so they can be set against daily profit.

## 8. Approvals and locking

```
 Attendant  -->  Supervisor  -->  Management  -->  LOCKED
 sends           approves         approves         (changes only by
                                                    a recorded reversal)
```

1. Once a day is locked it cannot be edited. A mistake is fixed by a reversal recorded with a name and a reason.
2. Alerts (late report, cash shortage, tank variance, supplier due, provider overdue and others) appear in the **Action Center**.
3. **(your decision)** Emailing alerts. Today they appear in the app only. More alert types (unbanked cash, customer overdue, over-limit, high expense, below-price sale) are **being built now**.

## 9. What the owner sees

1. **Dashboard**: sales, litres, cash variance, account sales, trend, unsubmitted reports.
   **(new)** finance tiles: gross and operating profit, stock value, cash at stations and banked,
   card and mobile money awaiting, debtors, creditors, expenses awaiting approval.
2. **(new)** **Daily profit**: gross profit minus expenses minus the day's share of fixed costs, per fuel and combined.
3. **(new)** **Financial position**: what the business holds and owes now, including stock and bank.
4. **Reports**: view and download as CSV, PDF or Excel. **(new, your decision)** Sales by attendant and customer ageing.

## 10. Month end

1. Make sure every day of the month is approved and locked. The Action Center lists reports not yet submitted.
2. Confirm all bank deposits and card/mobile-money payments have arrived.
3. Check supplier statements and customer statements.
4. Review expenses awaiting approval.
5. Run the Income Statement, Net Current Position and Cash Movement reports and download them.

**UNVERIFIED:** this month-end list is our reading of how the app is used. Please confirm it matches
your accountant's routine and tell us what is missing.
