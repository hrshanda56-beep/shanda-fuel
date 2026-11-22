'use client';

import { useEffect, useRef, useState } from 'react';

import { formatUsd } from '@/design-system/formatters';
import { Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import { WizardUsualOrOwn, type UsualOrOwn } from '@/design-system/wizard-kit';

import type { StaffPickerOption } from '../staff-picker-options';
import {
  USUAL_MONTHLY_LIMIT,
  checkMonthlyLimit,
  checkStaffMember,
  cleanLimit,
} from '../staff-benefit-checks';
import { StaffPicker } from './staff-picker';

type BenefitStep = 'who' | 'limit' | 'review';

export type StaffBenefitValue = { membershipId: string; limit: string };

/** Give a staff member a monthly fuel benefit: who, how much, then check. */
export function StaffBenefitWizard({
  staff,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  staff: readonly StaffPickerOption[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: StaffBenefitValue) => void;
}) {
  const [membershipId, setMembershipId] = useState('');
  const [mode, setMode] = useState<UsualOrOwn | null>(null);
  const [own, setOwn] = useState('');
  const picked = useRef(false);
  const limit = mode === 'usual' ? USUAL_MONTHLY_LIMIT : own;

  const wizard = useWizard<BenefitStep>({
    start: 'who',
    sequence: ['who', 'limit', 'review'],
    onCancel,
  });
  const { step, errors } = wizard;
  const person = staff.find((option) => option.membershipId === membershipId);

  // Choosing someone from the list carries straight on, once the choice has been stored.
  useEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    if (step === 'who' && membershipId) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipId]);

  function next() {
    if (step === 'who') return wizard.advance(checkStaffMember(membershipId), 'limit', 'review');
    if (step === 'limit') {
      if (!mode) {
        return wizard.advance(
          { 'staff-limit': 'Choose the usual limit or set your own.' },
          'review',
        );
      }
      return wizard.advance(checkMonthlyLimit(limit), 'review');
    }
    onSubmit({ membershipId, limit: cleanLimit(limit) });
  }

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="Add a staff member"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'who' ? (
        <WizardStep
          wizard={wizard}
          title="Which staff member?"
          hint="Choose from your staff. New people are added in Settings > Staff."
        >
          <Field id="staff-member" label="Staff member" error={errors['staff-member']} required>
            <StaffPicker
              id="staff-member"
              options={staff}
              value={membershipId}
              onChange={setMembershipId}
              onPick={() => {
                picked.current = true;
              }}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'limit' ? (
        <WizardStep
          wizard={wizard}
          title={`How much fuel can ${person?.name ?? 'they'} take each month?`}
          hint="The most they can take on their benefit in one month."
        >
          <WizardUsualOrOwn
            label="Monthly limit"
            name="staff-limit-mode"
            mode={mode}
            onPick={setMode}
            usualLabel={`${formatUsd(USUAL_MONTHLY_LIMIT)} a month`}
            usualDetail="The usual amount"
            ownLabel="A different amount"
          >
            <NumericInput
              id="staff-limit"
              label="Monthly limit"
              unit="USD"
              inputMode="decimal"
              required
              autoFocus
              error={errors['staff-limit']}
              value={own}
              onChange={(event) => setOwn(event.target.value)}
            />
          </WizardUsualOrOwn>
          {mode === null && errors['staff-limit'] ? (
            <p className="field-error" role="alert">
              {errors['staff-limit']}
            </p>
          ) : null}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the benefit" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Staff member" onChange={() => wizard.change('who')}>
              {person?.name ?? ''}
            </WizardSummaryRow>
            <WizardSummaryRow label="Monthly limit" onChange={() => wizard.change('limit')}>
              {formatUsd(cleanLimit(limit))}
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
            continueLabel="Add staff member"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
