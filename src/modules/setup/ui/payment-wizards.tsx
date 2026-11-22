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
  checkAccountCharges,
  checkAccountDetails,
  checkAccountWhere,
  checkBankCompany,
  checkBankDetails,
  checkProviderCode,
  checkProviderWho,
} from '../payment-checks';

type Choice = { value: string; label: string };

type Shared = {
  busy: boolean;
  /** A problem from saving, shown on the check screen. */
  error: string | null;
  onCancel: () => void;
};

/* ------------------------------ Provider ------------------------------ */

type ProviderStep = 'who' | 'code' | 'review';
const PROVIDER_SEQUENCE: readonly ProviderStep[] = ['who', 'code', 'review'];

export type ProviderValue = { name: string; type: string; code: string };

const suggestCode = (name: string): string =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 20);

export function ProviderWizard({
  types,
  busy,
  error,
  onCancel,
  onSubmit,
}: Shared & { types: readonly Choice[]; onSubmit: (value: ProviderValue) => void }) {
  const [form, setForm] = useState<ProviderValue>({ name: '', type: '', code: '' });
  const [codeTouched, setCodeTouched] = useState(false);
  const wizard = useWizard<ProviderStep>({ start: 'who', sequence: PROVIDER_SEQUENCE, onCancel });
  const { step, errors } = wizard;
  const set = (patch: Partial<ProviderValue>) => setForm((current) => ({ ...current, ...patch }));

  function next() {
    if (step === 'who') {
      const found = checkProviderWho(form.name, form.type);
      if (Object.keys(found).length === 0 && !codeTouched && !form.code.trim()) {
        set({ code: suggestCode(form.name) });
      }
      return wizard.advance(found, 'code', 'review');
    }
    if (step === 'code') return wizard.advance(checkProviderCode(form.code), 'review');
    onSubmit({ name: form.name.trim(), type: form.type, code: form.code.trim() });
  }

  const typeLabel = types.find((t) => t.value === form.type)?.label ?? form.type;

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="Add payment provider"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'who' ? (
        <WizardStep
          wizard={wizard}
          title="Who do you take payments through?"
          hint="The card, POS or mobile money company."
        >
          <Field id="provider-name" label="Provider name" error={errors['provider-name']} required>
            <input
              id="provider-name"
              value={form.name}
              maxLength={160}
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>
          <Field id="provider-type" label="Provider type" error={errors['provider-type']} required>
            <Select
              id="provider-type"
              value={form.type}
              placeholder="Choose a type"
              options={types}
              onChange={(event) => set({ type: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'code' ? (
        <WizardStep
          wizard={wizard}
          title="What short code should it have?"
          hint="We suggested one. You can change it."
        >
          <Field
            id="provider-code"
            label="Provider code"
            hint="A short unique code used in records."
            error={errors['provider-code']}
            required
          >
            <input
              id="provider-code"
              value={form.code}
              maxLength={80}
              autoComplete="off"
              autoFocus
              onChange={(event) => {
                setCodeTouched(true);
                set({ code: event.target.value });
              }}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the provider" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Provider" onChange={() => wizard.change('who')}>
              {form.name.trim()} · {typeLabel}
            </WizardSummaryRow>
            <WizardSummaryRow label="Code" onChange={() => wizard.change('code')}>
              {form.code.trim()}
            </WizardSummaryRow>
          </WizardSummary>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save provider"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}

/* ------------------------------ Account ------------------------------- */

type AccountStep = 'where' | 'details' | 'charges' | 'review';
const ACCOUNT_SEQUENCE: readonly AccountStep[] = ['where', 'details', 'charges', 'review'];

export type AccountValue = {
  stationId: string;
  providerId: string;
  name: string;
  reference: string;
  currency: string;
  feePercent: string;
  feeFixed: string;
};

export function AccountWizard({
  stations,
  providers,
  busy,
  error,
  onCancel,
  onSubmit,
}: Shared & {
  stations: readonly Choice[];
  providers: readonly Choice[];
  onSubmit: (value: AccountValue) => void;
}) {
  const [form, setForm] = useState<AccountValue>({
    stationId: stations.length === 1 ? stations[0]!.value : '',
    providerId: providers.length === 1 ? providers[0]!.value : '',
    name: '',
    reference: '',
    currency: 'USD',
    feePercent: '',
    feeFixed: '',
  });
  const wizard = useWizard<AccountStep>({ start: 'where', sequence: ACCOUNT_SEQUENCE, onCancel });
  const { step, errors } = wizard;
  const set = (patch: Partial<AccountValue>) => setForm((current) => ({ ...current, ...patch }));

  function next() {
    if (step === 'where') {
      return wizard.advance(
        checkAccountWhere(form.stationId, form.providerId),
        'details',
        'review',
      );
    }
    if (step === 'details') {
      return wizard.advance(
        checkAccountDetails(form.name, form.reference, form.currency),
        'charges',
        'review',
      );
    }
    if (step === 'charges') {
      return wizard.advance(checkAccountCharges(form.feePercent, form.feeFixed), 'review');
    }
    onSubmit({
      ...form,
      name: form.name.trim(),
      reference: form.reference.trim(),
      currency: form.currency.trim().toUpperCase(),
      feePercent: form.feePercent.trim(),
      feeFixed: form.feeFixed.trim(),
    });
  }

  const stationLabel = stations.find((s) => s.value === form.stationId)?.label ?? '';
  const providerLabel = providers.find((p) => p.value === form.providerId)?.label ?? '';
  const charges = [
    form.feePercent.trim() ? `${Number(form.feePercent)}%` : '',
    form.feeFixed.trim() ? `${Number(form.feeFixed)} each time` : '',
  ]
    .filter(Boolean)
    .join(' + ');

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="Add provider account"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'where' ? (
        <WizardStep
          wizard={wizard}
          title="Which station and provider?"
          hint="Needs a provider account at this station."
        >
          <Field id="account-station" label="Station" error={errors['account-station']} required>
            <Select
              id="account-station"
              value={form.stationId}
              placeholder="Choose a station"
              options={stations}
              onChange={(event) => set({ stationId: event.target.value })}
            />
          </Field>
          <Field id="account-provider" label="Provider" error={errors['account-provider']} required>
            <Select
              id="account-provider"
              value={form.providerId}
              placeholder="Choose a provider"
              options={providers}
              onChange={(event) => set({ providerId: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'details' ? (
        <WizardStep
          wizard={wizard}
          title="What are the account details?"
          hint="How this account is named and found on statements."
        >
          <Field id="account-name" label="Account name" error={errors['account-name']} required>
            <input
              id="account-name"
              value={form.name}
              maxLength={160}
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>
          <Field
            id="account-reference"
            label="Merchant or terminal reference"
            error={errors['account-reference']}
            required
          >
            <input
              id="account-reference"
              value={form.reference}
              maxLength={160}
              autoComplete="off"
              onChange={(event) => set({ reference: event.target.value })}
            />
          </Field>
          <Field
            id="account-currency"
            label="Currency"
            hint="Three-letter code, for example USD."
            error={errors['account-currency']}
            required
          >
            <input
              id="account-currency"
              value={form.currency}
              maxLength={3}
              autoComplete="off"
              onChange={(event) => set({ currency: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'charges' ? (
        <WizardStep
          wizard={wizard}
          title="Does the provider keep a charge?"
          hint="You can leave both empty and carry on."
        >
          <Field
            id="account-fee-percent"
            label="Charge as a percentage (%)"
            hint="What the provider keeps from each settlement, for example 1 for EcoCash at 1%."
            error={errors['account-fee-percent']}
            optional
          >
            <input
              id="account-fee-percent"
              inputMode="decimal"
              value={form.feePercent}
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ feePercent: event.target.value })}
            />
          </Field>
          <Field
            id="account-fee-fixed"
            label="Fixed charge each time"
            hint="A flat amount the provider keeps on top, if any."
            error={errors['account-fee-fixed']}
            optional
          >
            <input
              id="account-fee-fixed"
              inputMode="decimal"
              value={form.feeFixed}
              autoComplete="off"
              onChange={(event) => set({ feeFixed: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the account" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Where" onChange={() => wizard.change('where')}>
              {providerLabel} at {stationLabel}
            </WizardSummaryRow>
            <WizardSummaryRow label="Account" onChange={() => wizard.change('details')}>
              {form.name.trim()} · {form.reference.trim()} · {form.currency.trim().toUpperCase()}
            </WizardSummaryRow>
            <WizardSummaryRow label="Charges" onChange={() => wizard.change('charges')}>
              {charges || 'None'}
            </WizardSummaryRow>
          </WizardSummary>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save account"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}

/* ---------------------------- Bank account ---------------------------- */

type BankStep = 'company' | 'details' | 'review';
const BANK_SEQUENCE: readonly BankStep[] = ['company', 'details', 'review'];

export type BankValue = { companyId: string; name: string; bankName: string; masked: string };

export function BankWizard({
  companies,
  busy,
  error,
  onCancel,
  onSubmit,
}: Shared & { companies: readonly Choice[]; onSubmit: (value: BankValue) => void }) {
  const only = companies.length === 1 ? companies[0]!.value : '';
  const [form, setForm] = useState<BankValue>({
    companyId: only,
    name: '',
    bankName: '',
    masked: '',
  });
  const wizard = useWizard<BankStep>({
    start: only ? 'details' : 'company',
    sequence: BANK_SEQUENCE,
    onCancel,
  });
  const { step, errors } = wizard;
  const set = (patch: Partial<BankValue>) => setForm((current) => ({ ...current, ...patch }));

  function next() {
    if (step === 'company')
      return wizard.advance(checkBankCompany(form.companyId), 'details', 'review');
    if (step === 'details') {
      return wizard.advance(checkBankDetails(form.name, form.bankName, form.masked), 'review');
    }
    onSubmit({
      companyId: form.companyId,
      name: form.name.trim(),
      bankName: form.bankName.trim(),
      masked: form.masked.trim(),
    });
  }

  const companyLabel = companies.find((c) => c.value === form.companyId)?.label ?? '';

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="Add bank account"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'company' ? (
        <WizardStep
          wizard={wizard}
          title="Which company is the account for?"
          hint="The account belongs to the company. All its stations use it."
        >
          <Field id="bank-company" label="Company" error={errors['bank-company']} required>
            <Select
              id="bank-company"
              value={form.companyId}
              placeholder="Choose a company"
              options={companies}
              onChange={(event) => set({ companyId: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'details' ? (
        <WizardStep
          wizard={wizard}
          title="What are the bank account details?"
          hint="Bank deposits cannot be recorded until a bank account is entered."
        >
          <Field
            id="bank-account-name"
            label="Account name"
            error={errors['bank-account-name']}
            required
          >
            <input
              id="bank-account-name"
              value={form.name}
              maxLength={160}
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>
          <Field id="bank-name" label="Bank name" error={errors['bank-name']} required>
            <input
              id="bank-name"
              value={form.bankName}
              maxLength={160}
              autoComplete="off"
              onChange={(event) => set({ bankName: event.target.value })}
            />
          </Field>
          <Field
            id="bank-reference-masked"
            label="Masked account reference"
            hint="Do not enter the full bank account number."
            error={errors['bank-reference-masked']}
            required
          >
            <input
              id="bank-reference-masked"
              value={form.masked}
              maxLength={160}
              autoComplete="off"
              onChange={(event) => set({ masked: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the bank account" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow
              label="Company"
              onChange={only ? undefined : () => wizard.change('company')}
            >
              {companyLabel}
            </WizardSummaryRow>
            <WizardSummaryRow label="Account" onChange={() => wizard.change('details')}>
              {form.name.trim()} · {form.bankName.trim()} · {form.masked.trim()} · USD
            </WizardSummaryRow>
          </WizardSummary>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save bank account"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
