'use client';

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

import { checkMatchAmount, checkMatchPayment, checkMatchPayout } from '../match-checks';

type MatchStep = 'payout' | 'payment' | 'amount' | 'review';

type Option = { value: string; label: string };

/**
 * Match a customer payment to a provider payout: which payout, which payment, how much, then check.
 * The page owns the three answers (other places on the page can start a match with a payment
 * already chosen); this only asks the questions and shows the check screen.
 */
export function MatchPaymentWizard({
  payouts,
  payments,
  settlementId,
  paymentId,
  amount,
  maxAmount,
  maxLabel,
  busy,
  error,
  onPickPayout,
  onPickPayment,
  onAmount,
  onCancel,
  onSubmit,
}: {
  payouts: readonly Option[];
  payments: readonly Option[];
  settlementId: string;
  paymentId: string;
  amount: string;
  /** The most that can be matched, as typed amount text; null until a payout and payment are chosen. */
  maxAmount: string | null;
  /** The same limit, formatted for reading. */
  maxLabel: string | null;
  busy: boolean;
  error: string | null;
  onPickPayout: (id: string) => void;
  onPickPayment: (id: string) => void;
  onAmount: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  // A single payout or payment is not a question worth asking.
  const askPayout = payouts.length !== 1;
  const askPayment = payments.length !== 1;
  const sequence: readonly MatchStep[] = [
    ...(askPayout ? (['payout'] as const) : []),
    ...(askPayment ? (['payment'] as const) : []),
    'amount',
    'review',
  ];
  const wizard = useWizard<MatchStep>({ start: sequence[0]!, sequence, onCancel });
  const { step, errors } = wizard;
  const labelOf = (options: readonly Option[], id: string) =>
    options.find((option) => option.value === id)?.label ?? '';

  function next() {
    const afterPayout: MatchStep = askPayment ? 'payment' : 'amount';
    if (step === 'payout') {
      return wizard.advance(checkMatchPayout(settlementId), afterPayout, 'review');
    }
    if (step === 'payment') {
      return wizard.advance(checkMatchPayment(paymentId), 'amount', 'review');
    }
    if (step === 'amount') {
      return wizard.advance(checkMatchAmount(amount, maxAmount), 'review');
    }
    onSubmit();
  }

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="Match a payment"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'payout' ? (
        <WizardStep
          wizard={wizard}
          title="Which provider payout?"
          hint="The payout the provider's statement shows."
        >
          <Field id="settlement" label="Provider payout" error={errors.settlement} required>
            <Select
              id="settlement"
              value={settlementId}
              onChange={(event) => onPickPayout(event.target.value)}
              options={payouts}
              placeholder="Select a payout"
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'payment' ? (
        <WizardStep
          wizard={wizard}
          title="Which customer payment is it?"
          hint="Card and mobile payments still waiting to be matched."
        >
          <Field id="payment" label="Customer payment" error={errors.payment} required>
            <Select
              id="payment"
              value={paymentId}
              onChange={(event) => onPickPayment(event.target.value)}
              options={payments}
              placeholder="Select a payment"
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'amount' ? (
        <WizardStep
          wizard={wizard}
          title="How much of it matches?"
          hint={maxLabel ? `Most you can match: ${maxLabel}` : undefined}
        >
          <NumericInput
            id="allocation-amount"
            label="Amount to match"
            inputMode="decimal"
            required
            autoFocus
            placeholder="0.00"
            error={errors['allocation-amount']}
            value={amount}
            onChange={(event) => onAmount(event.target.value)}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the match" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow
              label="Provider payout"
              {...(askPayout ? { onChange: () => wizard.change('payout') } : {})}
            >
              {labelOf(payouts, settlementId)}
            </WizardSummaryRow>
            <WizardSummaryRow
              label="Customer payment"
              {...(askPayment ? { onChange: () => wizard.change('payment') } : {})}
            >
              {labelOf(payments, paymentId)}
            </WizardSummaryRow>
            <WizardSummaryRow label="Amount to match" onChange={() => wizard.change('amount')}>
              {amount.trim()}
            </WizardSummaryRow>
          </WizardSummary>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <WizardActions wizard={wizard} onContinue={next} continueLabel="Match" busy={busy} />
        </WizardStep>
      ) : null}
    </form>
  );
}
