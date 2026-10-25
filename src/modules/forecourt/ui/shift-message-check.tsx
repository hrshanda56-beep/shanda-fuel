'use client';

import { useMemo, useState } from 'react';
import { PageContainer, PageHeader, Section } from '@/design-system/layout';
import { Button, Card, Field, StatusBadge } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { parseShiftMessage, type ShiftMessageFuel, type ShiftMessagePump } from '../shift-message';

const FUELS = [
  { key: 'petrol', label: 'Petrol' },
  { key: 'diesel', label: 'Diesel' },
] as const;

function PumpTable({ label, fuel }: { label: string; fuel: ShiftMessageFuel }) {
  if (fuel.pumps.length === 0) return null;
  return (
    <Card>
      <h3>{label}</h3>
      <p>Price per litre: {fuel.price ?? 'not in the message'}</p>
      <TableScrollRegion label={`${label} pump readings`}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Pump</th>
              <th scope="col">Opening</th>
              <th scope="col">Closing</th>
              <th scope="col">Litres written</th>
            </tr>
          </thead>
          <tbody>
            {fuel.pumps.map((pump: ShiftMessagePump) => (
              <tr key={pump.label}>
                <th scope="row">{pump.label}</th>
                <td className="numeric">{pump.opening ?? '—'}</td>
                <td className="numeric">{pump.closing ?? '—'}</td>
                <td className="numeric">{pump.litres ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <p>Total litres written: {fuel.totalLitres ?? 'not in the message'}</p>
    </Card>
  );
}

export function ShiftMessageCheck() {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState('');
  const parsed = useMemo(() => (checked.trim() ? parseShiftMessage(checked) : null), [checked]);

  return (
    <PageContainer width="narrow">
      <PageHeader
        eyebrow="Daily operations"
        title="Check a shift message"
        description="Paste the supervisor's WhatsApp shift summary. We read the figures and check the sums. Nothing is saved."
      />
      <Card>
        <Field
          id="shift-message"
          label="Shift message"
          hint="Copy the whole message from WhatsApp and paste it here."
        >
          <textarea
            id="shift-message"
            rows={12}
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Button variant="primary" onClick={() => setChecked(text)} disabled={!text.trim()}>
          Check the message
        </Button>
      </Card>

      {parsed ? (
        <>
          <Section
            title="What we found to check"
            description="Each line is something in the message that does not add up, or is missing."
          >
            {parsed.checks.length === 0 ? (
              <Card>
                <StatusBadge tone="positive">All the sums in the message add up</StatusBadge>
              </Card>
            ) : (
              <Card>
                <ul>
                  {parsed.checks.map((check) => (
                    <li key={`${check.code}-${check.message}`}>
                      <StatusBadge tone="warning">Check</StatusBadge> {check.message}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>

          <Section title="What the message says">
            <Card>
              <p>
                {parsed.date ?? 'No date'} · {parsed.shift ? `${parsed.shift} shift` : 'No shift'}
              </p>
              <p>Attendants: {parsed.attendants ?? 'not in the message'}</p>
              <p>Supervisor: {parsed.supervisor ?? 'not in the message'}</p>
              <p>Available cash: {parsed.availableCash ?? 'not in the message'}</p>
              {parsed.cashDrop ? <p>Cash dropped: {parsed.cashDrop}</p> : null}
            </Card>
            {FUELS.map(({ key, label }) => (
              <PumpTable key={key} label={label} fuel={parsed[key]} />
            ))}
            {parsed.expenses.length > 0 ? (
              <Card>
                <h3>Expenses</h3>
                <ul>
                  {parsed.expenses.map((expense, index) => (
                    <li key={`${expense.description}-${index}`}>
                      {expense.description}: {expense.amount}
                    </li>
                  ))}
                </ul>
                {parsed.statedExpenseTotal ? (
                  <p>Total written in the message: {parsed.statedExpenseTotal}</p>
                ) : null}
              </Card>
            ) : null}
          </Section>
        </>
      ) : null}
    </PageContainer>
  );
}
