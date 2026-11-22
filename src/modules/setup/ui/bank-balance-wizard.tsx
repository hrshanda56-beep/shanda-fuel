'use client';

import { useState } from 'react';

import { formatUsd } from '@/design-system/formatters';
import { Select } from '@/design-system/forms';
import { Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';

import {
  checkBalanceAmount,
  checkBalanceDate,
  checkBalanceStation,
  cleanBalance,
} from '../payment-checks';

type BalanceStep = 'station' | 'amount' | 'date' | 'review';

export type BankBalanceValue = { stationId: string; balance: string; asOfDate: string };

/** The balance on a bank statement, one question at a time: station, amount, date, then check. */
export function BankBalanceWizard({
  accountName,
  stations,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  accountName: string;
  stations: ReadonlyArray<{ id: string; name: string; code: string }>;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: BankBalanceValue) => void;
}) {
  // With one station there is nothing to choose, so that question is skipped.
  const onlyStation = stations.length === 1 ? (stations[0]?.id ?? '') : '';
  const [stationId, setStationId] = useState(onlyStation);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');

  const sequence: readonly BalanceStep[] = onlyStation
    ? ['amount', 'date', 'review']
    : ['station', 'amount', 'date', 'review'];
  const wizard = useWizard<BalanceStep>({
    start: onlyStation ? 'amount' : 'station',
    sequence,
    onCancel,
  });
  const { step, errors } = wizard;
  const stationName = (() => {
    const station = stations.find((s) => s.id === stationId);
    return station ? `${station.name} (${station.code})` : '';
  })();

  function next() {
    if (step === 'station')
      return wizard.advance(checkBalanceStation(stationId), 'amount', 'review');
    if (step === 'amount') return wizard.advance(checkBalanceAmount(amount), 'date', 'review');
    if (step === 'date') return wizard.advance(checkBalanceDate(date), 'review');
    onSubmit({ stationId, balance: cleanBalance(amount), asOfDate: date });
  }

  return (
    <form
      className="form-stack"
      noValidate
      aria-label={`Type in the balance for ${accountName}`}
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'station' ? (
        <WizardStep
          wizard={wizard}
          title="Which station is this for?"
          hint="The balance is recorded against this station."
        >
          <Field id="balance-station" label="Station" error={errors['balance-station']} required>
            <Select
              id="balance-station"
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
              placeholder="Choose a station"
              options={stations.map((station) => ({
                value: station.id,
                label: `${station.name} (${station.code})`,
              }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'amount' ? (
        <WizardStep
          wizard={wizard}
          title={`What balance does the statement show for ${accountName}?`}
          hint="Type the closing balance from the bank statement, in US dollars."
        >
          <NumericInput
            id="balance-amount"
            label="Balance on the statement (USD)"
            inputMode="decimal"
            required
            autoFocus
            error={errors['balance-amount']}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'date' ? (
        <WizardStep
          wizard={wizard}
          title="What date is on the statement?"
          hint="A newer balance replaces the older one; the older lines stay on record."
        >
          <Field
            id="balance-date"
            label="Date on the statement"
            error={errors['balance-date']}
            required
          >
            <input
              id="balance-date"
              type="date"
              autoFocus
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the balance" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Bank account">{accountName}</WizardSummaryRow>
            {onlyStation ? null : (
              <WizardSummaryRow label="Station" onChange={() => wizard.change('station')}>
                {stationName}
              </WizardSummaryRow>
            )}
            <WizardSummaryRow label="Balance" onChange={() => wizard.change('amount')}>
              {formatUsd(cleanBalance(amount))}
            </WizardSummaryRow>
            <WizardSummaryRow label="Date on the statement" onChange={() => wizard.change('date')}>
              {date}
            </WizardSummaryRow>
          </WizardSummary>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save balance"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
