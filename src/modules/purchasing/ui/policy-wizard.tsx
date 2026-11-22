'use client';

import { useState } from 'react';

import { Button, Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
  type WizardErrors,
} from '@/design-system/wizard';
import { WizardOptions } from '@/design-system/wizard-kit';

import {
  ALLOWANCE_FIELDS,
  FIELD_IDS,
  OTHER,
  allowanceChoices,
  applyAllowanceChoice,
  checkAllowance,
  checkChoice,
  checkPolicyReason,
  checkVatRate,
  currentAllowanceChoice,
  vatRateNeeded,
  type AllowanceKey,
  type PolicyFormValues,
} from './policy-wizard-checks';
import {
  TOLERANCE_ACTION_OPTIONS,
  VAT_MODE_OPTIONS,
  allowanceText,
  toleranceActionText,
  vatModeText,
} from './purchasing-format';

type PolicyStep =
  AllowanceKey | 'action' | 'vat' | 'vatRate' | 'lines' | 'transport' | 'reason' | 'review';

const ALLOWANCE_COPY: Record<AllowanceKey, { title: string; hint: string; summary: string }> = {
  qty: {
    title: 'How much can the invoice quantity differ from what was received?',
    hint: 'An invoice is only flagged when it is further off than this.',
    summary: 'Invoice quantity vs received',
  },
  over: {
    title: 'How much extra can be received compared with the delivery note?',
    hint: 'More fuel arriving than the delivery note says is only flagged beyond this.',
    summary: 'Received vs delivery note',
  },
  price: {
    title: 'How far can the invoice price differ from the agreed price?',
    hint: 'A percentage of the agreed price.',
    summary: 'Invoice price vs agreed price',
  },
  amount: {
    title: 'How far can the invoice total differ from the expected total?',
    hint: 'An amount in US dollars.',
    summary: 'Invoice total vs expected total',
  },
};

const ALLOWANCE_ORDER: readonly AllowanceKey[] = ['qty', 'over', 'price', 'amount'];

function yesNoOptions(isCompany: boolean, yes: string, no: string) {
  return [
    ...(isCompany ? [] : [{ value: 'follow', label: 'Same as the company' }]),
    { value: 'true', label: yes },
    { value: 'false', label: no },
  ];
}

/** Change purchasing settings one rule at a time. A supplier can follow the company on any rule. */
export function PolicyWizard({
  initial,
  isCompany,
  who,
  companyNote,
  busy,
  error,
  readOnly,
  onCancel,
  onSubmit,
}: {
  initial: PolicyFormValues;
  isCompany: boolean;
  /** "the whole company" or the supplier's name. */
  who: string;
  /** What the company currently allows, shown on a supplier's first screen. */
  companyNote?: string | null;
  busy: boolean;
  error: string | null;
  /** Someone who may look but not change: only the summary is shown. */
  readOnly: boolean;
  onCancel: () => void;
  onSubmit: (form: PolicyFormValues, reason: string) => void;
}) {
  const [form, setForm] = useState<PolicyFormValues>(initial);
  const [reason, setReason] = useState('');
  const [picks, setPicks] = useState<Record<AllowanceKey, string>>({
    qty: currentAllowanceChoice('qty', initial, isCompany),
    over: currentAllowanceChoice('over', initial, isCompany),
    price: currentAllowanceChoice('price', initial, isCompany),
    amount: currentAllowanceChoice('amount', initial, isCompany),
  });
  const set = (patch: Partial<PolicyFormValues>) =>
    setForm((current) => ({ ...current, ...patch }));

  const sequence: readonly PolicyStep[] = [
    ...ALLOWANCE_ORDER,
    'action',
    'vat',
    ...(vatRateNeeded(form.vatMode) ? (['vatRate'] as const) : []),
    'lines',
    'transport',
    'reason',
    'review',
  ];
  const wizard = useWizard<PolicyStep>({
    start: readOnly ? 'review' : 'qty',
    sequence: readOnly ? ['review'] : sequence,
    onCancel,
  });
  const { step, errors } = wizard;

  function next() {
    if (step === 'review') {
      if (readOnly) return onCancel();
      const missing = checkPolicyReason(reason);
      if (Object.keys(missing).length > 0) {
        wizard.show('reason');
        wizard.setErrors(missing);
        return;
      }
      return onSubmit(form, reason);
    }
    const follow = (id: string, value: string) => checkChoice(id, value, isCompany);
    switch (step) {
      case 'qty':
        return wizard.advance(checkAllowance('qty', form), 'over', 'review');
      case 'over':
        return wizard.advance(checkAllowance('over', form), 'price', 'review');
      case 'price':
        return wizard.advance(checkAllowance('price', form), 'amount', 'review');
      case 'amount':
        return wizard.advance(checkAllowance('amount', form), 'action', 'review');
      case 'action':
        return wizard.advance(follow('pp-action', form.toleranceAction), 'vat', 'review');
      case 'vat': {
        const found = follow('pp-vat', form.vatMode);
        return wizard.advance(found, vatRateNeeded(form.vatMode) ? 'vatRate' : 'lines', 'review');
      }
      case 'vatRate':
        return wizard.advance(checkVatRate(form), 'lines', 'review');
      case 'lines':
        return wizard.advance(follow('pp-lines', form.requireInvoiceLines), 'transport', 'review');
      case 'transport':
        return wizard.advance(
          follow('pp-transport-bill', form.requireTransportBill),
          'reason',
          'review',
        );
      case 'reason':
        return wizard.advance(checkPolicyReason(reason), 'review');
    }
  }

  function allowanceStep(key: AllowanceKey) {
    const copy = ALLOWANCE_COPY[key];
    const f = ALLOWANCE_FIELDS[key];
    const typed = (field: keyof PolicyFormValues, label: string, unit: string, first: boolean) => (
      <NumericInput
        key={field}
        id={FIELD_IDS[field]}
        label={label}
        unit={unit}
        inputMode="decimal"
        optional
        autoFocus={first}
        error={(errors as WizardErrors)[FIELD_IDS[field]]}
        value={form[field]}
        onChange={(event) => set({ [field]: event.target.value })}
      />
    );
    return (
      <WizardStep
        wizard={wizard}
        title={copy.title}
        hint={`${copy.hint}${isCompany ? '' : ' Choose “Same as the company” to follow the company setting.'}`}
      >
        {companyNote && key === 'qty' ? <p className="field-hint">{companyNote}</p> : null}
        <WizardOptions<string>
          label={copy.title}
          name={`pp-${key}`}
          value={picks[key]}
          onPick={(choice) => {
            setPicks((p) => ({ ...p, [key]: choice }));
            set(applyAllowanceChoice(key, choice, isCompany));
          }}
          options={allowanceChoices(key, isCompany)}
        />
        {picks[key] === OTHER ? (
          <>
            {f.litres ? typed(f.litres, 'Difference in litres or kg', 'L / kg', true) : null}
            {f.percent
              ? typed(f.percent, f.litres ? '…or as a percentage' : 'Percentage', '%', !f.litres)
              : null}
            {f.usd ? typed(f.usd, 'Amount', 'USD', true) : null}
          </>
        ) : null}
        <WizardActions wizard={wizard} onContinue={next} />
      </WizardStep>
    );
  }

  function pickStep(
    title: string,
    name: string,
    value: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    onPick: (value: string) => void,
    id: string,
    hint?: string,
  ) {
    return (
      <WizardStep wizard={wizard} title={title} {...(hint ? { hint } : {})}>
        <WizardOptions<string>
          label={title}
          name={name}
          value={value === '' ? (isCompany ? null : 'follow') : value}
          onPick={(picked) => onPick(picked === 'follow' ? '' : picked)}
          options={options}
        />
        {errors[id] ? (
          <p className="field-error" role="alert">
            {errors[id]}
          </p>
        ) : null}
        <WizardActions wizard={wizard} onContinue={next} />
      </WizardStep>
    );
  }

  const follow = (isCompany ? [] : [{ value: 'follow', label: 'Same as the company' }]) as Array<{
    value: string;
    label: string;
  }>;

  const allowanceSummary = (key: AllowanceKey): string => {
    const f = ALLOWANCE_FIELDS[key];
    const parts = [
      f.litres ? allowanceText(form[f.litres] || null, ' litres or kg') : null,
      f.percent ? allowanceText(form[f.percent] || null, '%') : null,
      f.usd ? allowanceText(form[f.usd] || null, ' USD') : null,
    ].filter(Boolean);
    return parts.length > 0
      ? parts.join(' or ')
      : isCompany
        ? 'No difference allowed'
        : 'Same as the company';
  };

  return (
    <form
      className="form-stack"
      noValidate
      aria-label={readOnly ? `Settings for ${who}` : `Change settings for ${who}`}
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'qty' || step === 'over' || step === 'price' || step === 'amount'
        ? allowanceStep(step)
        : null}
      {step === 'action'
        ? pickStep(
            'What should happen if a difference is bigger than allowed?',
            'pp-action',
            form.toleranceAction,
            [...follow, ...TOLERANCE_ACTION_OPTIONS],
            (value) => set({ toleranceAction: value }),
            'pp-action',
          )
        : null}
      {step === 'vat'
        ? pickStep(
            'How do suppliers show VAT on their invoices?',
            'pp-vat',
            form.vatMode,
            [...follow, ...VAT_MODE_OPTIONS],
            (value) => set({ vatMode: value }),
            'pp-vat',
          )
        : null}
      {step === 'vatRate' ? (
        <WizardStep
          wizard={wizard}
          title="What is the VAT rate?"
          hint="The rate that applies to supplier invoices."
        >
          <NumericInput
            id="pp-vat-rate"
            label="VAT rate"
            unit="%"
            inputMode="decimal"
            required
            autoFocus
            error={errors['pp-vat-rate']}
            value={form.defaultVatRate}
            onChange={(event) => set({ defaultVatRate: event.target.value })}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'lines'
        ? pickStep(
            'Must each invoice list the fuel it is for?',
            'pp-lines',
            form.requireInvoiceLines,
            yesNoOptions(
              isCompany,
              'Yes, each invoice must list the fuel it is for',
              'No, invoices can be entered as a single total',
            ),
            (value) => set({ requireInvoiceLines: value }),
            'pp-lines',
          )
        : null}
      {step === 'transport'
        ? pickStep(
            'Does a delivery carried by another company need its bill?',
            'pp-transport-bill',
            form.requireTransportBill,
            yesNoOptions(
              isCompany,
              'Yes, every such delivery needs its transport bill',
              'No, a transport bill is optional',
            ),
            (value) => set({ requireTransportBill: value }),
            'pp-transport-bill',
            'Fuel is often brought by a different company that sends its own bill.',
          )
        : null}
      {step === 'reason' ? (
        <WizardStep
          wizard={wizard}
          title="Why are you changing these settings?"
          hint="This is kept in the record of changes."
        >
          <Field id="pp-reason" label="Reason" error={errors['pp-reason']} required>
            <input
              id="pp-reason"
              autoFocus
              maxLength={500}
              placeholder="e.g. Agreed new terms with the supplier"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep
          wizard={wizard}
          title={readOnly ? `Settings for ${who}` : 'Check the settings'}
          hint={readOnly ? 'You can see these settings but not change them.' : WIZARD_REVIEW_HINT}
        >
          <WizardSummary>
            {ALLOWANCE_ORDER.map((key) => (
              <WizardSummaryRow
                key={key}
                label={ALLOWANCE_COPY[key].summary}
                {...(readOnly ? {} : { onChange: () => wizard.change(key) })}
              >
                {allowanceSummary(key)}
              </WizardSummaryRow>
            ))}
            <WizardSummaryRow
              label="A difference bigger than allowed"
              {...(readOnly ? {} : { onChange: () => wizard.change('action') })}
            >
              {form.toleranceAction
                ? toleranceActionText(form.toleranceAction)
                : 'Same as the company'}
            </WizardSummaryRow>
            <WizardSummaryRow
              label="VAT"
              {...(readOnly ? {} : { onChange: () => wizard.change('vat') })}
            >
              {form.vatMode
                ? vatModeText(form.vatMode, form.defaultVatRate || null)
                : 'Same as the company'}
            </WizardSummaryRow>
            <WizardSummaryRow
              label="Invoice lines"
              {...(readOnly ? {} : { onChange: () => wizard.change('lines') })}
            >
              {form.requireInvoiceLines === ''
                ? 'Same as the company'
                : form.requireInvoiceLines === 'true'
                  ? 'Each invoice must list the fuel it is for'
                  : 'Invoices can be entered as a single total'}
            </WizardSummaryRow>
            <WizardSummaryRow
              label="Transport bills"
              {...(readOnly ? {} : { onChange: () => wizard.change('transport') })}
            >
              {form.requireTransportBill === ''
                ? 'Same as the company'
                : form.requireTransportBill === 'true'
                  ? 'Every delivery carried by another company needs its bill'
                  : 'A transport bill is optional'}
            </WizardSummaryRow>
            {readOnly ? null : (
              <WizardSummaryRow label="Reason" onChange={() => wizard.change('reason')}>
                {reason.trim()}
              </WizardSummaryRow>
            )}
          </WizardSummary>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          {readOnly ? (
            <div>
              <Button type="button" variant="secondary" onClick={onCancel}>
                Close
              </Button>
            </div>
          ) : (
            <WizardActions
              wizard={wizard}
              onContinue={next}
              continueLabel="Save settings"
              busy={busy}
            />
          )}
        </WizardStep>
      ) : null}
    </form>
  );
}
