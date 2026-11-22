'use client';

import { useState } from 'react';
import { Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardQuiet,
  WizardStep,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import { WizardOptions } from '@/design-system/wizard-kit';
import { formatQuantity, type QuantityUnit } from '@/design-system/formatters';
import {
  checkAdjustmentDirection,
  checkAdjustmentQuantity,
  checkAdjustmentReason,
  stockAfterAdjustment,
  type AdjustmentDirection,
} from '../adjustment-checks';

type CorrectionStep = 'direction' | 'quantity' | 'reason' | 'review';

export type StockCorrectionValue = {
  movementType: AdjustmentDirection;
  quantity: string;
  reason: string;
};

const SEQUENCE: readonly CorrectionStep[] = ['direction', 'quantity', 'reason', 'review'];

/** Correct a tank's book stock one question at a time, ending in a check screen. */
export function StockCorrectionWizard({
  bookQuantity,
  unit,
  busy,
  onCancel,
  onSubmit,
}: {
  /** What the books hold now, as a plain number. */
  bookQuantity: string;
  unit: QuantityUnit | undefined;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: StockCorrectionValue) => void;
}) {
  const unitWord = unit === 'KILOGRAMS' ? 'kilograms' : 'litres';
  const [direction, setDirection] = useState<AdjustmentDirection | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const wizard = useWizard<CorrectionStep>({ start: 'direction', sequence: SEQUENCE, onCancel });
  const { step, errors } = wizard;
  const verb = direction === 'NEGATIVE_ADJUSTMENT' ? 'Take away' : 'Add';

  function next() {
    if (step === 'direction') {
      return wizard.advance(checkAdjustmentDirection(direction), 'quantity', 'review');
    }
    if (step === 'quantity') {
      return wizard.advance(
        checkAdjustmentQuantity(quantity, direction, bookQuantity, unitWord),
        'reason',
        'review',
      );
    }
    if (step === 'reason') return wizard.advance(checkAdjustmentReason(reason), 'review');
    if (!direction) return;
    onSubmit({ movementType: direction, quantity: quantity.trim(), reason: reason.trim() });
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
      {step === 'direction' ? (
        <WizardStep
          wizard={wizard}
          title="Does the tank need more or less on the books?"
          hint={`The books hold ${formatQuantity(bookQuantity, unit)} now.`}
        >
          <WizardOptions<AdjustmentDirection>
            label="Add or take away"
            name="adj-direction"
            value={direction}
            onPick={setDirection}
            options={[
              {
                value: 'POSITIVE_ADJUSTMENT',
                label: 'Add stock',
                detail: 'The books show too little.',
              },
              {
                value: 'NEGATIVE_ADJUSTMENT',
                label: 'Take away stock',
                detail: 'The books show too much.',
              },
            ]}
          />
          {errors['adj-direction-POSITIVE_ADJUSTMENT'] ? (
            <p className="field-error" role="alert">
              {errors['adj-direction-POSITIVE_ADJUSTMENT']}
            </p>
          ) : null}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'quantity' ? (
        <WizardStep
          wizard={wizard}
          title={`How many ${unitWord} should be ${direction === 'NEGATIVE_ADJUSTMENT' ? 'taken away' : 'added'}?`}
        >
          <NumericInput
            id="adj-quantity"
            label={`${verb} (${unitWord})`}
            required
            autoFocus
            error={errors['adj-quantity']}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'reason' ? (
        <WizardStep wizard={wizard} title="Why is the stock being corrected?">
          <Field id="adj-reason" label="Reason" error={errors['adj-reason']} required>
            <textarea
              id="adj-reason"
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
      {step === 'review' && direction ? (
        <WizardStep wizard={wizard} title="Check the correction">
          <WizardSummary>
            <WizardSummaryRow label="Change" onChange={() => wizard.change('direction')}>
              {direction === 'NEGATIVE_ADJUSTMENT' ? 'Take away stock' : 'Add stock'}
            </WizardSummaryRow>
            <WizardSummaryRow label="Amount" onChange={() => wizard.change('quantity')}>
              {formatQuantity(quantity.trim(), unit)}
            </WizardSummaryRow>
            <WizardSummaryRow label="Reason" onChange={() => wizard.change('reason')}>
              {reason.trim()}
            </WizardSummaryRow>
            <WizardSummaryRow label="Books will hold">
              {formatQuantity(
                String(stockAfterAdjustment(bookQuantity, quantity, direction)),
                unit,
              )}
            </WizardSummaryRow>
          </WizardSummary>
          <WizardQuiet>
            This is recorded with your name and the reason. It can’t be quietly undone.
          </WizardQuiet>
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save correction"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
