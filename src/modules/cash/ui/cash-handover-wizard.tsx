'use client';

import { useState } from 'react';
import { Select } from '@/design-system/forms';
import { InfoTip } from '@/design-system/info-tip';
import { Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardPair,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import {
  checkHandoverAmounts,
  checkHandoverFrom,
  checkHandoverReason,
  checkHandoverTo,
  handoverDiffers,
} from '../handover-checks';

type HandoverStep = 'from' | 'to' | 'amounts' | 'reason' | 'review';

export type CashHandoverValue = {
  fromLocationId: string;
  toLocationId: string;
  expectedAmount: string;
  countedAmount: string;
  reason: string;
};

/** Hand cash over one question at a time, ending in a check screen. */
export function CashHandoverWizard({
  locations,
  busy,
  money,
  onCancel,
  onSubmit,
}: {
  locations: readonly { locationId: string; name: string }[];
  busy: boolean;
  /** Formats an amount for display (hides it when figures are hidden). */
  money: (value: string) => string;
  onCancel: () => void;
  onSubmit: (value: CashHandoverValue) => void;
}) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [expected, setExpected] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');

  const differs = handoverDiffers(expected, counted);
  const sequence: readonly HandoverStep[] = [
    'from',
    'to',
    'amounts',
    ...(differs ? (['reason'] as const) : []),
    'review',
  ];
  const wizard = useWizard<HandoverStep>({ start: 'from', sequence, onCancel });
  const { step, errors } = wizard;
  const options = locations.map((l) => ({ value: l.locationId, label: l.name }));
  const nameOf = (id: string) => locations.find((l) => l.locationId === id)?.name ?? '';

  function next() {
    // If the place they hand it to was cleared (it matched the new "from"), ask for it again.
    if (step === 'from') {
      return wizard.advance(checkHandoverFrom(fromId), 'to', toId ? 'review' : undefined);
    }
    if (step === 'to') return wizard.advance(checkHandoverTo(fromId, toId), 'amounts', 'review');
    if (step === 'amounts') {
      const found = checkHandoverAmounts(expected, counted);
      // Amounts that now differ need a reason, even when the person came from the check screen.
      const needsReason = handoverDiffers(expected, counted) && !reason.trim();
      return wizard.advance(
        found,
        handoverDiffers(expected, counted) ? 'reason' : 'review',
        needsReason ? undefined : 'review',
      );
    }
    if (step === 'reason') {
      return wizard.advance(checkHandoverReason(expected, counted, reason), 'review');
    }
    onSubmit({
      fromLocationId: fromId,
      toLocationId: toId,
      expectedAmount: expected.trim(),
      countedAmount: counted.trim(),
      reason: differs ? reason.trim() : '',
    });
  }

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'from' ? (
        <WizardStep
          wizard={wizard}
          title="Where is the cash now?"
          hint="Choose where the cash is being taken from."
        >
          <Field id="ho-from" label="Cash is coming from" error={errors['ho-from']} required>
            <Select
              id="ho-from"
              value={fromId}
              onChange={(event) => {
                setFromId(event.target.value);
                if (event.target.value === toId) setToId('');
              }}
              placeholder="Choose where the cash is now"
              options={options}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'to' ? (
        <WizardStep
          wizard={wizard}
          title="Who is it going to?"
          hint="The person receiving it has to accept it."
        >
          <Field id="ho-to" label="Handing it to" error={errors['ho-to']} required>
            <Select
              id="ho-to"
              value={toId}
              onChange={(event) => setToId(event.target.value)}
              placeholder="Choose where it is going"
              options={options.filter((option) => option.value !== fromId)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'amounts' ? (
        <WizardStep
          wizard={wizard}
          title="How much cash?"
          hint="Count it first, then compare with what it should be."
        >
          <WizardPair>
            <NumericInput
              id="ho-expected"
              label="Amount that should be handed over"
              required
              autoFocus
              error={errors['ho-expected']}
              value={expected}
              onChange={(event) => setExpected(event.target.value)}
            />
            <NumericInput
              id="ho-counted"
              label="Amount you actually counted"
              required
              error={errors['ho-counted']}
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
            />
          </WizardPair>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'reason' ? (
        <WizardStep
          wizard={wizard}
          title="Why is it different?"
          hint={`You counted ${money(counted.trim())} but ${money(expected.trim())} was expected.`}
        >
          <Field
            id="ho-reason"
            label="Reason"
            hint="The person receiving the cash will see this."
            error={errors['ho-reason']}
            required
          >
            <textarea
              id="ho-reason"
              rows={3}
              maxLength={500}
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the handover" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="From" onChange={() => wizard.change('from')}>
              {nameOf(fromId)}
            </WizardSummaryRow>
            <WizardSummaryRow label="To" onChange={() => wizard.change('to')}>
              {nameOf(toId)}
            </WizardSummaryRow>
            <WizardSummaryRow label="Should be" onChange={() => wizard.change('amounts')}>
              {money(expected.trim())}
            </WizardSummaryRow>
            <WizardSummaryRow label="Counted" onChange={() => wizard.change('amounts')}>
              {money(counted.trim())}
            </WizardSummaryRow>
            {differs ? (
              <WizardSummaryRow label="Reason" onChange={() => wizard.change('reason')}>
                {reason.trim()}
              </WizardSummaryRow>
            ) : null}
          </WizardSummary>
          <InfoTip>The cash is not counted as received until the other person accepts it.</InfoTip>
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Hand over cash"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
