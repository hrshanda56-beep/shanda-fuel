'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Select } from '@/design-system/forms';
import { PageHeader } from '@/design-system/layout';
import { Button, Card, EmptyState, ErrorState, Field } from '@/design-system/primitives';
import { formatTileMoney } from '@/modules/reporting/format';
import type { StaffBenefitMonth } from '../staff-benefit-expense-read';

export type StaffBenefitExpenseView = Omit<StaffBenefitMonth, 'reference'>;

export function StaffBenefitExpenseWorkspace({
  tenantId,
  stationId,
  stationName,
  month,
  monthOptions,
  rows,
}: {
  tenantId: string;
  stationId: string;
  stationName: string;
  month: string;
  monthOptions: readonly { value: string; label: string }[];
  rows: readonly StaffBenefitExpenseView[];
}) {
  const router = useRouter();
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  async function enter(row: StaffBenefitExpenseView) {
    if (row.cost.status !== 'READY') return;
    const body = {
      commandType: 'SubmitStaffBenefitExpense',
      tenantId,
      stationId,
      accountId: row.accountId,
      month,
      expectedAmount: row.cost.total,
    };
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    setBusyAccount(row.accountId);
    setError(null);
    setDone(null);
    try {
      const response = await fetch('/api/expenses/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': attempt.current.key },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof result === 'object' && result !== null && 'message' in result
            ? String((result as { message: unknown }).message)
            : 'This could not be entered.',
        );
      }
      attempt.current = null;
      setConfirming(null);
      setDone(
        `Entered for ${row.staffName}. It now waits for approval on the Expenses page like any other expense.`,
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This could not be entered.');
    } finally {
      setBusyAccount(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Staff fuel benefit: month-end cost"
        eyebrow="Customers"
        description={`The fuel staff took at ${stationName}, at what the fuel cost us, entered as one expense per person for the month. Nothing is entered until you confirm.`}
        actions={
          <Link className="button button-secondary" href="/customers/staff-benefit">
            Staff fuel benefit
          </Link>
        }
      />
      <Card>
        <Field id="benefit-month" label="Month">
          <Select
            id="benefit-month"
            value={month}
            onChange={(event) =>
              router.push(`/customers/staff-benefit/expense?month=${event.target.value}`)
            }
            options={[...monthOptions]}
          />
        </Field>
      </Card>
      {error ? <ErrorState title="Not entered" message={error} /> : null}
      {done ? <p role="status">{done}</p> : null}
      {rows.length === 0 ? (
        <EmptyState
          title="No staff benefit accounts"
          message="There are no staff fuel benefit accounts for this station’s company."
        />
      ) : (
        <div className="stack">
          {rows.map((row) => (
            <Card key={row.accountId} as="article">
              <h2>{row.staffName}</h2>
              {row.cost.status === 'NO_FUEL' ? (
                <p className="muted">No fuel was taken at this station in {month}.</p>
              ) : null}
              {row.cost.status === 'UNAVAILABLE' ? (
                <p role="status">
                  The cost of the fuel is not available for {row.cost.missing.join(', ')} in {month}
                  , so it cannot be entered. Nothing is guessed.
                </p>
              ) : null}
              {row.cost.status === 'READY' ? (
                <>
                  <table>
                    <caption className="visually-hidden">
                      Fuel taken by {row.staffName} in {month}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Fuel</th>
                        <th scope="col">Litres</th>
                        <th scope="col">Cost a litre</th>
                        <th scope="col">Cost</th>
                        <th scope="col">Pump price value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.cost.lines.map((line) => (
                        <tr key={line.productId}>
                          <th scope="row">{line.productName}</th>
                          <td>{line.litres}</td>
                          <td>{line.costPerLitre}</td>
                          <td>{line.cost}</td>
                          <td>{formatTileMoney(line.soldValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>
                    <strong>Expense to enter: US$ {row.cost.total}</strong>
                  </p>
                </>
              ) : null}
              {row.existingExpense ? (
                <p role="status">
                  Already entered for {month} ({row.existingExpense.state.toLowerCase()}). To enter
                  it again, reverse that expense first on the{' '}
                  <Link href="/expenses">Expenses page</Link>.
                </p>
              ) : null}
              {!row.closed ? (
                <p className="muted">
                  {month} is not over yet at the station. Enter it after the month ends.
                </p>
              ) : null}
              {row.cost.status === 'READY' && row.closed && !row.existingExpense ? (
                confirming === row.accountId ? (
                  <div>
                    <p>
                      Enter US$ {row.cost.total} as the staff fuel benefit for {row.staffName},{' '}
                      {month}? It will wait for approval; you can still reverse it afterwards.
                    </p>
                    <Button loading={busyAccount === row.accountId} onClick={() => void enter(row)}>
                      Yes, enter it
                    </Button>{' '}
                    <Button variant="secondary" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setConfirming(row.accountId)}>Enter as an expense</Button>
                )
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
