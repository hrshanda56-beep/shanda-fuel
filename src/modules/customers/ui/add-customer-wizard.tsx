'use client';

import { useState } from 'react';
import { Select } from '@/design-system/forms';
import { ErrorState, Field } from '@/design-system/primitives';
import {
  WizardActions,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import {
  checkCustomerName,
  checkCustomerTerms,
  kindNeedsTerms,
  type CustomerKind,
} from '../new-customer-checks';
import { isDuplicateCustomerName } from './customer-reference';
import { formatMoney } from '@/design-system/formatters';

type CustomerStep = 'kind' | 'who' | 'phone' | 'terms' | 'days' | 'review';

export type NewCustomerValue = {
  kind: CustomerKind | '';
  name: string;
  staffName: string;
  phone: string;
  limit: string;
  days: string;
};

export const KIND_LABELS: Record<CustomerKind, string> = {
  CREDIT: 'Credit account (they buy now, pay later)',
  PREPAID_VALUE: 'Prepaid money (they pay first, spend as they buy)',
  PREPAID_LITRES: 'Prepaid fuel (they pay first for a set number of litres)',
  STAFF: 'Staff fuel benefit (a monthly limit for a staff member)',
};

/** Add a customer one question at a time, ending in a check screen. */
export function AddCustomerWizard({
  canOpenAccount,
  initialKind,
  initial,
  existingNames,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  canOpenAccount: boolean;
  initialKind: CustomerKind | '';
  /** What was typed before the dialog was hidden (for the identity check); opens on the check screen. */
  initial: NewCustomerValue | null;
  existingNames: readonly string[];
  busy: boolean;
  /** A problem from saving, shown on the check screen. */
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: NewCustomerValue) => void;
}) {
  const [kind, setKind] = useState<CustomerKind | ''>(initial?.kind ?? initialKind);
  const [name, setName] = useState(initial?.name ?? '');
  const [staffName, setStaffName] = useState(initial?.staffName ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [limit, setLimit] = useState(initial?.limit ?? '');
  const [days, setDays] = useState(initial?.days ?? '');

  const sequence: readonly CustomerStep[] = [
    ...(canOpenAccount ? (['kind'] as const) : []),
    'who',
    'phone',
    ...(kindNeedsTerms(kind) ? (['terms'] as const) : []),
    ...(kind === 'CREDIT' ? (['days'] as const) : []),
    'review',
  ];
  const wizard = useWizard<CustomerStep>({
    start: initial ? 'review' : (sequence[0] ?? 'who'),
    sequence,
    onCancel,
  });
  const { step, errors } = wizard;
  const staff = kind === 'STAFF';

  function next() {
    if (step === 'kind') {
      return wizard.advance({}, 'who', 'review');
    }
    if (step === 'who') {
      const found = checkCustomerName(kind, name, staffName);
      // A kind changed from the check screen may now need terms that were never given.
      const needsTerms =
        kindNeedsTerms(kind) && Object.keys(checkCustomerTerms(kind, limit, days)).length > 0;
      return wizard.advance(found, 'phone', needsTerms ? undefined : 'review');
    }
    if (step === 'phone') {
      const needsTerms =
        kindNeedsTerms(kind) && Object.keys(checkCustomerTerms(kind, limit, days)).length > 0;
      return wizard.advance({}, needsTerms ? 'terms' : 'review', 'review');
    }
    if (step === 'terms') {
      const found = checkCustomerTerms(kind, limit, days);
      return wizard.advance(
        found['add-customer-limit'] ? { 'add-customer-limit': found['add-customer-limit'] } : {},
        kind === 'CREDIT' ? 'days' : 'review',
        kind === 'CREDIT' ? undefined : 'review',
      );
    }
    if (step === 'days') {
      const found = checkCustomerTerms(kind, limit, days);
      return wizard.advance(
        found['add-customer-days'] ? { 'add-customer-days': found['add-customer-days'] } : {},
        'review',
      );
    }
    onSubmit({ kind, name, staffName, phone, limit, days });
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
      {step === 'kind' ? (
        <WizardStep
          wizard={wizard}
          title="What kind of account?"
          hint="You can open an account later."
        >
          <Field id="add-customer-kind" label="Kind of account" optional>
            <Select
              id="add-customer-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as CustomerKind | '')}
              placeholder="Just add the customer for now"
              options={(Object.keys(KIND_LABELS) as CustomerKind[]).map((item) => ({
                value: item,
                label: KIND_LABELS[item],
              }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'who' ? (
        <WizardStep wizard={wizard} title={staff ? 'Which staff member?' : 'Who is the customer?'}>
          {staff ? (
            <Field
              id="add-customer-staff"
              label="Staff member"
              error={errors['add-customer-staff']}
              required
            >
              <input
                id="add-customer-staff"
                maxLength={200}
                autoComplete="off"
                autoFocus
                value={staffName}
                onChange={(event) => setStaffName(event.target.value)}
              />
            </Field>
          ) : (
            <Field
              id="add-customer-name"
              label="Customer name"
              error={errors['add-customer-name']}
              required
              hint={
                isDuplicateCustomerName(name, existingNames) ? 'Already on your list.' : undefined
              }
            >
              <input
                id="add-customer-name"
                maxLength={200}
                autoComplete="off"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'phone' ? (
        <WizardStep wizard={wizard} title="What is their phone number?" hint="Optional.">
          <Field id="add-customer-phone" label="Phone number" optional>
            <input
              id="add-customer-phone"
              type="tel"
              maxLength={200}
              autoComplete="off"
              autoFocus
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'terms' ? (
        <WizardStep
          wizard={wizard}
          title={staff ? 'What is the monthly limit?' : 'How much credit?'}
        >
          <Field
            id="add-customer-limit"
            label={staff ? 'Monthly limit (USD)' : 'Most they may owe at one time (USD)'}
            error={errors['add-customer-limit']}
            required
          >
            <input
              id="add-customer-limit"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'days' ? (
        <WizardStep wizard={wizard} title="How many days do they have to pay?" hint="Optional.">
          <Field
            id="add-customer-days"
            label="Usual days to pay"
            error={errors['add-customer-days']}
            optional
          >
            <input
              id="add-customer-days"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the customer">
          <WizardSummary>
            {canOpenAccount ? (
              <WizardSummaryRow label="Account" onChange={() => wizard.change('kind')}>
                {kind ? KIND_LABELS[kind] : 'No account yet'}
              </WizardSummaryRow>
            ) : null}
            <WizardSummaryRow
              label={staff ? 'Staff member' : 'Customer'}
              onChange={() => wizard.change('who')}
            >
              {(staff ? staffName : name).trim()}
              {phone.trim() ? ` · ${phone.trim()}` : ''}
            </WizardSummaryRow>
            {kindNeedsTerms(kind) ? (
              <WizardSummaryRow
                label={staff ? 'Monthly limit' : 'Credit limit'}
                onChange={() => wizard.change('terms')}
              >
                {formatMoney(limit.trim())}
                {kind === 'CREDIT' && days.trim() ? ` · pays within ${days.trim()} days` : ''}
              </WizardSummaryRow>
            ) : null}
          </WizardSummary>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save customer"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
