'use client';

import { useState } from 'react';
import { Button, ErrorState, Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import { checkCompanyName, checkCompanyNumbers, checkCompanyTax } from '../company-checks';
import { LOGO_ACCEPT, isLogoFileType, makeLogoCopies } from '../logo-image';
import styles from './sales-documents.module.css';

type CompanyStep = 'name' | 'look' | 'tax' | 'payment' | 'numbers' | 'review';

export type CompanyValue = {
  displayName: string;
  address: string;
  phone: string;
  email: string;
  logo: string | null;
  /** The same logo as a PNG with its transparent background, for the loading screen. */
  appLogo: string | null;
  colour: string | null;
  taxLabel: string;
  taxNumber: string;
  taxRate: string;
  bank: string;
  terms: string;
  footer: string;
  qt: string;
  inv: string;
  rc: string;
  validDays: string;
  dueDays: string;
};

const SEQUENCE: readonly CompanyStep[] = ['name', 'look', 'tax', 'payment', 'numbers', 'review'];

/** Set up the details printed on every document, one question at a time, ending in a check screen. */
export function CompanyWizard({
  initial,
  existing,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initial: CompanyValue;
  /** True when details were saved before: the guide then opens on the check screen. */
  existing: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: CompanyValue) => void;
}) {
  const [form, setForm] = useState<CompanyValue>(initial);
  const [logoError, setLogoError] = useState<string | null>(null);
  const wizard = useWizard<CompanyStep>({
    start: existing ? 'review' : 'name',
    sequence: SEQUENCE,
    onCancel,
  });
  const { step, errors } = wizard;
  const set = (patch: Partial<CompanyValue>) => setForm((current) => ({ ...current, ...patch }));

  /** Keeps two small copies of the picture: a JPEG for printing and a transparent PNG for the loading screen. */
  async function pickLogo(file: File | undefined) {
    setLogoError(null);
    if (!file) return;
    if (!isLogoFileType(file.type)) {
      setLogoError('Choose a picture file (PNG, JPG or SVG).');
      return;
    }
    try {
      const copies = await makeLogoCopies(file);
      set({ logo: copies.jpeg, appLogo: copies.png });
    } catch (error) {
      setLogoError(
        error instanceof Error && error.message === 'too large'
          ? 'That picture is too large. Try a smaller one.'
          : 'That picture could not be read. Try a PNG, JPG or SVG file.',
      );
    }
  }

  function next() {
    if (step === 'name') {
      return wizard.advance(checkCompanyName(form.displayName, form.email), 'look', 'review');
    }
    if (step === 'look') return wizard.advance({}, 'tax', 'review');
    if (step === 'tax') {
      return wizard.advance(checkCompanyTax(form.taxLabel, form.taxRate), 'payment', 'review');
    }
    if (step === 'payment') return wizard.advance({}, 'numbers', 'review');
    if (step === 'numbers') {
      return wizard.advance(
        checkCompanyNumbers(form.qt, form.inv, form.rc, form.validDays, form.dueDays),
        'review',
      );
    }
    onSubmit(form);
  }

  const contact = [form.address, form.phone, form.email]
    .map((part) => part.trim().replace(/\s*\n\s*/g, ', '))
    .filter(Boolean)
    .join(' · ');
  const tax = [
    `${form.taxLabel.trim()} ${form.taxRate.trim() || '0'}%`,
    form.taxNumber.trim() ? `number ${form.taxNumber.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const payment = [
    form.bank.trim() ? 'Payment details' : '',
    form.terms.trim() ? 'usual terms' : '',
    form.footer.trim() ? 'bottom line' : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'name' ? (
        <WizardStep
          wizard={wizard}
          title="What is your company called?"
          hint="These details are printed at the top of every quotation, invoice and receipt."
        >
          <Field id="sd-c-name" label="Company name" error={errors['sd-c-name']} required>
            <input
              id="sd-c-name"
              value={form.displayName}
              maxLength={200}
              autoComplete="organization"
              autoFocus
              onChange={(e) => set({ displayName: e.target.value })}
            />
          </Field>
          <Field id="sd-c-address" label="Address" optional>
            <textarea
              id="sd-c-address"
              rows={2}
              value={form.address}
              maxLength={500}
              onChange={(e) => set({ address: e.target.value })}
            />
          </Field>
          <Field id="sd-c-phone" label="Phone" optional>
            <input
              id="sd-c-phone"
              type="tel"
              value={form.phone}
              maxLength={60}
              onChange={(e) => set({ phone: e.target.value })}
            />
          </Field>
          <Field id="sd-c-email" label="Email" error={errors['sd-c-email']} optional>
            <input
              id="sd-c-email"
              type="email"
              value={form.email}
              maxLength={200}
              onChange={(e) => set({ email: e.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'look' ? (
        <WizardStep
          wizard={wizard}
          title="How should your documents look?"
          hint="You can leave this empty and carry on."
        >
          <Field id="sd-c-logo" label="Logo" hint="PNG, JPG or SVG. Shown top left." optional>
            <div className={styles.logoRow}>
              {form.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- a small inline preview of the chosen picture
                <img
                  className={styles.logoPreview}
                  src={`data:image/jpeg;base64,${form.logo}`}
                  alt="Your logo"
                />
              ) : null}
              <input
                id="sd-c-logo"
                type="file"
                accept={LOGO_ACCEPT}
                onChange={(e) => void pickLogo(e.target.files?.[0])}
              />
              {form.logo ? (
                <Button variant="quiet" onClick={() => set({ logo: null, appLogo: null })}>
                  Remove logo
                </Button>
              ) : null}
            </div>
            {logoError ? <p role="alert">{logoError}</p> : null}
          </Field>
          <Field
            id="sd-c-colour"
            label="Brand colour"
            hint="Used for the title and lines on printed documents."
            optional
          >
            <div className={styles.logoRow}>
              <input
                id="sd-c-colour"
                type="color"
                value={form.colour ?? '#000000'}
                onChange={(e) => set({ colour: e.target.value })}
              />
              {form.colour ? (
                <Button variant="quiet" onClick={() => set({ colour: null })}>
                  Use plain black
                </Button>
              ) : (
                <span className={styles.muted}>Plain black</span>
              )}
            </div>
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'tax' ? (
        <WizardStep
          wizard={wizard}
          title="Do you charge tax?"
          hint="Use 0 if you do not. You can change the percentage on any item."
        >
          <Field
            id="sd-c-taxlabel"
            label="Name of your tax"
            hint="For example VAT, GST or Sales tax."
            error={errors['sd-c-taxlabel']}
          >
            <input
              id="sd-c-taxlabel"
              value={form.taxLabel}
              maxLength={30}
              autoFocus
              onChange={(e) => set({ taxLabel: e.target.value })}
            />
          </Field>
          <Field id="sd-c-taxno" label="Your tax number" optional>
            <input
              id="sd-c-taxno"
              value={form.taxNumber}
              maxLength={60}
              onChange={(e) => set({ taxNumber: e.target.value })}
            />
          </Field>
          <NumericInput
            id="sd-c-rate"
            label="Usual tax percentage"
            hint="Filled in on new items."
            unit="%"
            error={errors['sd-c-rate']}
            value={form.taxRate}
            onChange={(e) => set({ taxRate: e.target.value })}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'payment' ? (
        <WizardStep
          wizard={wizard}
          title="How should customers pay you?"
          hint="You can leave this empty and carry on."
        >
          <Field
            id="sd-c-bank"
            label="Bank or payment details"
            hint="Printed on invoices."
            optional
          >
            <textarea
              id="sd-c-bank"
              rows={3}
              value={form.bank}
              maxLength={1000}
              autoFocus
              onChange={(e) => set({ bank: e.target.value })}
            />
          </Field>
          <Field id="sd-c-terms" label="Usual terms" hint="Filled in on new documents." optional>
            <textarea
              id="sd-c-terms"
              rows={3}
              value={form.terms}
              maxLength={2000}
              onChange={(e) => set({ terms: e.target.value })}
            />
          </Field>
          <Field id="sd-c-footer" label="Line at the bottom" optional>
            <input
              id="sd-c-footer"
              value={form.footer}
              maxLength={500}
              onChange={(e) => set({ footer: e.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'numbers' ? (
        <WizardStep
          wizard={wizard}
          title="How should documents be numbered?"
          hint="The usual choices are already filled in."
        >
          <Field
            id="sd-c-qt"
            label="Quotation numbers start with"
            hint="QT gives QT-2026-0001."
            error={errors['sd-c-qt']}
          >
            <input
              id="sd-c-qt"
              value={form.qt}
              maxLength={10}
              autoFocus
              onChange={(e) => set({ qt: e.target.value })}
            />
          </Field>
          <Field id="sd-c-inv" label="Invoice numbers start with" error={errors['sd-c-inv']}>
            <input
              id="sd-c-inv"
              value={form.inv}
              maxLength={10}
              onChange={(e) => set({ inv: e.target.value })}
            />
          </Field>
          <Field id="sd-c-rc" label="Receipt numbers start with" error={errors['sd-c-rc']}>
            <input
              id="sd-c-rc"
              value={form.rc}
              maxLength={10}
              onChange={(e) => set({ rc: e.target.value })}
            />
          </Field>
          <NumericInput
            id="sd-c-valid"
            label="Quotations are valid for"
            unit="days"
            error={errors['sd-c-valid']}
            value={form.validDays}
            onChange={(e) => set({ validDays: e.target.value.replace(/\D/g, '') })}
          />
          <NumericInput
            id="sd-c-due"
            label="Invoices are due within"
            unit="days"
            error={errors['sd-c-due']}
            value={form.dueDays}
            onChange={(e) => set({ dueDays: e.target.value.replace(/\D/g, '') })}
          />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check your company details" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Company" onChange={() => wizard.change('name')}>
              {form.displayName.trim()}
              {contact ? ` · ${contact}` : ''}
            </WizardSummaryRow>
            <WizardSummaryRow label="Look" onChange={() => wizard.change('look')}>
              {form.logo ? 'Logo added' : 'No logo'} · {form.colour ? form.colour : 'plain black'}
            </WizardSummaryRow>
            <WizardSummaryRow label="Tax" onChange={() => wizard.change('tax')}>
              {tax}
            </WizardSummaryRow>
            <WizardSummaryRow label="Payment" onChange={() => wizard.change('payment')}>
              {payment || 'Not given'}
            </WizardSummaryRow>
            <WizardSummaryRow label="Numbering" onChange={() => wizard.change('numbers')}>
              {form.qt.trim()}, {form.inv.trim()}, {form.rc.trim()} · quotes valid {form.validDays}{' '}
              days · invoices due in {form.dueDays} days
            </WizardSummaryRow>
          </WizardSummary>
          {error ? <ErrorState title="Not saved" message={error} /> : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save details"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
