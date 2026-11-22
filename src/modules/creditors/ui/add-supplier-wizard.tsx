'use client';

import { useState } from 'react';
import { ErrorState, Field } from '@/design-system/primitives';
import {
  WizardActions,
  WizardChoice,
  WizardChoices,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import {
  checkSupplierContact,
  checkSupplierCredit,
  checkSupplierName,
} from '../new-supplier-checks';

type SupplierStep = 'does' | 'who' | 'code' | 'reg' | 'contact' | 'credit' | 'review';

/** What the company does for the business. */
export type SupplierRole = 'FUEL' | 'TRANSPORT' | 'BOTH';

export type NewSupplierValue = {
  role: SupplierRole;
  code: string;
  legalName: string;
  registrationReference: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  creditDays: string;
  creditLimit: string;
};

const SEQUENCE: readonly SupplierStep[] = [
  'does',
  'who',
  'code',
  'reg',
  'contact',
  'credit',
  'review',
];

export const ROLE_CHOICES: readonly { value: SupplierRole; label: string; detail: string }[] = [
  { value: 'FUEL', label: 'Supplies fuel', detail: 'Sells you fuel.' },
  {
    value: 'TRANSPORT',
    label: 'Transports fuel',
    detail: 'Brings fuel and bills you.',
  },
  { value: 'BOTH', label: 'Both', detail: 'Sells and brings fuel.' },
];

/** The two flags the server stores for a role. */
export function roleFlags(role: SupplierRole) {
  return { providesFuel: role !== 'TRANSPORT', providesTransport: role !== 'FUEL' };
}

/** Add a supplier one question at a time, ending in a check screen. */
export function AddSupplierWizard({
  companyName,
  initialRole = 'FUEL',
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  companyName: string;
  /** The answer the first question starts on. */
  initialRole?: SupplierRole;
  busy: boolean;
  /** A problem from saving, shown on the check screen. */
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: NewSupplierValue) => void;
}) {
  const [form, setForm] = useState<NewSupplierValue>({
    role: initialRole,
    code: '',
    legalName: '',
    registrationReference: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    creditDays: '',
    creditLimit: '',
  });
  const wizard = useWizard<SupplierStep>({ start: 'does', sequence: SEQUENCE, onCancel });
  const { step, errors } = wizard;
  const set = (patch: Partial<NewSupplierValue>) =>
    setForm((current) => ({ ...current, ...patch }));

  function next() {
    if (step === 'does') return wizard.advance({}, 'who', 'review');
    if (step === 'who') {
      const found = checkSupplierName(form.code || 'x', form.legalName);
      return wizard.advance(
        found['supplier-legal-name'] ? { 'supplier-legal-name': found['supplier-legal-name'] } : {},
        'code',
        form.code.trim() ? 'review' : undefined,
      );
    }
    if (step === 'code') {
      const found = checkSupplierName(form.code, form.legalName || 'x');
      return wizard.advance(
        found['supplier-code'] ? { 'supplier-code': found['supplier-code'] } : {},
        'reg',
        'review',
      );
    }
    if (step === 'reg') return wizard.advance({}, 'contact', 'review');
    if (step === 'contact') {
      return wizard.advance(checkSupplierContact(form.contactEmail), 'credit', 'review');
    }
    if (step === 'credit') {
      return wizard.advance(checkSupplierCredit(form.creditDays, form.creditLimit), 'review');
    }
    onSubmit(form);
  }

  const contact = [form.contactName, form.contactPhone, form.contactEmail]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ');
  const terms = [
    form.creditDays.trim() ? `${form.creditDays.trim()} days to pay` : '',
    form.creditLimit.trim() ? `credit limit USD ${form.creditLimit.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'does' ? (
        <WizardStep wizard={wizard} title="What does this company do for you?">
          <WizardChoices label="What this company does">
            {ROLE_CHOICES.map((choice) => (
              <WizardChoice
                key={choice.value}
                id={`supplier-role-${choice.value}`}
                name="supplier-role"
                checked={form.role === choice.value}
                onPick={() => set({ role: choice.value })}
                detail={choice.detail}
              >
                {choice.label}
              </WizardChoice>
            ))}
          </WizardChoices>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'who' ? (
        <WizardStep wizard={wizard} title="Who is the supplier?">
          <Field
            id="supplier-legal-name"
            label="Legal name"
            error={errors['supplier-legal-name']}
            required
          >
            <input
              id="supplier-legal-name"
              value={form.legalName}
              maxLength={240}
              autoComplete="organization"
              autoFocus
              onChange={(event) => set({ legalName: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'code' ? (
        <WizardStep wizard={wizard} title="What short name will you use for them?">
          <Field
            id="supplier-code"
            label="Supplier code"
            hint="For example PUMA."
            error={errors['supplier-code']}
            required
          >
            <input
              id="supplier-code"
              value={form.code}
              maxLength={80}
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ code: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'reg' ? (
        <WizardStep wizard={wizard} title="What is their registration reference?" hint="Optional.">
          <Field id="supplier-registration-reference" label="Registration reference" optional>
            <input
              autoFocus
              id="supplier-registration-reference"
              value={form.registrationReference}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => set({ registrationReference: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'contact' ? (
        <WizardStep wizard={wizard} title="How do you reach them?" hint="Optional.">
          <Field id="supplier-contact-name" label="Contact person" optional>
            <input
              id="supplier-contact-name"
              value={form.contactName}
              maxLength={200}
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ contactName: event.target.value })}
            />
          </Field>
          <Field id="supplier-contact-phone" label="Phone number" optional>
            <input
              id="supplier-contact-phone"
              type="tel"
              value={form.contactPhone}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => set({ contactPhone: event.target.value })}
            />
          </Field>
          <Field
            id="supplier-contact-email"
            label="Email"
            error={errors['supplier-contact-email']}
            optional
          >
            <input
              id="supplier-contact-email"
              type="email"
              value={form.contactEmail}
              maxLength={200}
              autoComplete="off"
              onChange={(event) => set({ contactEmail: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'credit' ? (
        <WizardStep wizard={wizard} title="Do they give you credit?" hint="Optional.">
          <Field
            id="supplier-credit-days"
            label="Usual credit period (days)"
            error={errors['supplier-credit-days']}
            optional
          >
            <input
              id="supplier-credit-days"
              inputMode="numeric"
              value={form.creditDays}
              maxLength={3}
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ creditDays: event.target.value })}
            />
          </Field>
          <Field
            id="supplier-create-credit-limit"
            label="Credit limit (USD)"
            error={errors['supplier-create-credit-limit']}
            optional
          >
            <input
              id="supplier-create-credit-limit"
              inputMode="decimal"
              value={form.creditLimit}
              autoComplete="off"
              onChange={(event) => set({ creditLimit: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the supplier">
          <WizardSummary>
            <WizardSummaryRow label="Does" onChange={() => wizard.change('does')}>
              {ROLE_CHOICES.find((choice) => choice.value === form.role)?.label}
            </WizardSummaryRow>
            <WizardSummaryRow label="Supplier" onChange={() => wizard.change('who')}>
              {form.legalName.trim()} ({form.code.trim()})
              {form.registrationReference.trim() ? ` · ${form.registrationReference.trim()}` : ''}
            </WizardSummaryRow>
            <WizardSummaryRow label="Contact" onChange={() => wizard.change('contact')}>
              {contact || 'Not given'}
            </WizardSummaryRow>
            <WizardSummaryRow label="Credit" onChange={() => wizard.change('credit')}>
              {terms || 'Not given'}
            </WizardSummaryRow>
          </WizardSummary>
          {error ? <ErrorState title="Could not create the supplier" message={error} /> : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Create supplier"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
