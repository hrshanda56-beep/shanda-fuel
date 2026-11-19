'use client';

import { useState, type ReactNode } from 'react';
import { ErrorState, Field } from '@/design-system/primitives';
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
  EXPENSE_ENTRY_PAYMENT_METHODS,
  EXPENSE_ENTRY_PAYMENT_METHOD_LABELS,
  type ExpenseEntryPaymentMethod,
} from '../domain';
import {
  checkExpenseMoney,
  checkExpensePaid,
  checkExpenseWhat,
  checkRegularMoney,
  checkRegularWhat,
  isOtherKind,
} from '../new-expense-checks';
import { formatFriendlyDate } from './expense-format';

type Choice = { id: string; name: string };

// ---------------------------------------------------------------- one-off expense

type ExpenseStep = 'what' | 'money' | 'paid' | 'extra' | 'review';

export type NewExpenseValue = {
  categoryId: string;
  description: string;
  amount: string;
  date: string;
  stationId: string;
  paymentMethod: ExpenseEntryPaymentMethod;
  paymentMethodOther: string;
  payee: string;
  receipt: string;
  receiptFile: File | null;
};

const EXPENSE_SEQUENCE: readonly ExpenseStep[] = ['what', 'money', 'paid', 'extra', 'review'];

/** Enter an expense one question at a time, ending in a check screen. */
export function ExpenseWizard({
  categories,
  stations,
  stationLocked,
  today,
  initial,
  kindsHint,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  categories: readonly Choice[];
  stations: readonly Choice[];
  /** True when the station is already decided (the person is working in one). */
  stationLocked: boolean;
  today: string;
  /** What was typed before the dialog was hidden (for the identity check); opens on the check screen. */
  initial: NewExpenseValue;
  /** Shown above the kinds when there are none yet. */
  kindsHint: ReactNode;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: NewExpenseValue) => void;
}) {
  const [form, setForm] = useState<NewExpenseValue>(initial);
  const [started] = useState(
    () => Boolean(initial.description || initial.amount) && Boolean(initial.categoryId),
  );
  const wizard = useWizard<ExpenseStep>({
    start: started ? 'review' : 'what',
    sequence: EXPENSE_SEQUENCE,
    onCancel,
  });
  const { step, errors } = wizard;
  const set = (patch: Partial<NewExpenseValue>) => setForm((current) => ({ ...current, ...patch }));
  const needsStation = stations.length > 1 && !stationLocked;
  const stationName = stations.find((station) => station.id === form.stationId)?.name ?? '';
  const kindName = categories.find((category) => category.id === form.categoryId)?.name ?? '';
  const isOther = isOtherKind(kindName);

  function next() {
    if (step === 'what') {
      return wizard.advance(
        checkExpenseWhat(form.categoryId, form.description, isOther),
        'money',
        'review',
      );
    }
    if (step === 'money') {
      return wizard.advance(checkExpenseMoney(form.amount, form.date, '', false), 'paid', 'review');
    }
    if (step === 'paid') {
      return wizard.advance(
        checkExpensePaid(form.stationId, needsStation, form.paymentMethod, form.paymentMethodOther),
        'extra',
        'review',
      );
    }
    if (step === 'extra') return wizard.advance({}, 'review');
    onSubmit(form);
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
      {step === 'what' ? (
        <WizardStep
          wizard={wizard}
          title="What was the money spent on?"
          hint="It counts as spending once it is approved and recorded."
        >
          {categories.length === 0 ? kindsHint : null}
          <Field
            id="expense-category"
            label="Kind of expense"
            error={errors['expense-category']}
            required
          >
            <select
              id="expense-category"
              value={form.categoryId}
              autoFocus
              onChange={(event) => set({ categoryId: event.target.value })}
            >
              <option value="">Choose…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="expense-description"
            label={isOther ? 'What kind of expense is it?' : 'What was it for?'}
            hint={isOther ? 'You chose Other, so tell us what it is.' : undefined}
            error={errors['expense-description']}
            required
          >
            <input
              id="expense-description"
              value={form.description}
              maxLength={500}
              placeholder={isOther ? 'e.g. Generator repair' : 'e.g. Replaced pump hose'}
              autoComplete="off"
              onChange={(event) => set({ description: event.target.value })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'money' ? (
        <WizardStep
          wizard={wizard}
          title="How much, and when?"
          hint="The amount spent and the day it was spent."
        >
          <WizardPair>
            <Field
              id="expense-amount"
              label="Amount (USD)"
              error={errors['expense-amount']}
              required
            >
              <input
                id="expense-amount"
                inputMode="decimal"
                value={form.amount}
                placeholder="0.00"
                autoComplete="off"
                autoFocus
                onChange={(event) => set({ amount: event.target.value })}
              />
            </Field>
            <Field id="expense-date" label="Date" error={errors['expense-date']} required>
              <input
                id="expense-date"
                type="date"
                value={form.date}
                max={today}
                onChange={(event) => set({ date: event.target.value })}
              />
            </Field>
          </WizardPair>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}

      {step === 'paid' ? (
        <WizardStep
          wizard={wizard}
          title="How was it paid?"
          hint="Cash paid out of the station's cash is taken off the cash to collect."
        >
          {needsStation ? (
            <Field
              id="expense-station"
              label="Which station is this for?"
              error={errors['expense-station']}
              required
            >
              <select
                id="expense-station"
                value={form.stationId}
                onChange={(event) => set({ stationId: event.target.value })}
              >
                <option value="">Choose a station…</option>
                {stations.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : stations.length > 1 ? (
            <p>
              Recording this for <strong>{stationName}</strong>.
            </p>
          ) : null}
          <Field id="expense-payment-method" label="Paid with" required>
            <select
              id="expense-payment-method"
              value={form.paymentMethod}
              onChange={(event) =>
                set({ paymentMethod: event.target.value as ExpenseEntryPaymentMethod })
              }
            >
              {EXPENSE_ENTRY_PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {EXPENSE_ENTRY_PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </Field>
          {form.paymentMethod === 'OTHER' ? (
            <Field
              id="expense-payment-other"
              label="How was it paid?"
              hint="You chose Other, so tell us how."
              error={errors['expense-payment-other']}
              required
            >
              <input
                id="expense-payment-other"
                value={form.paymentMethodOther}
                maxLength={60}
                placeholder="e.g. Cheque, or paid by a friend"
                autoComplete="off"
                onChange={(event) => set({ paymentMethodOther: event.target.value })}
              />
            </Field>
          ) : null}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'extra' ? (
        <WizardStep
          wizard={wizard}
          title="Anything to help find it later?"
          hint="You can leave all of this empty and carry on."
        >
          <Field id="expense-payee" label="Paid to" optional>
            <input
              id="expense-payee"
              value={form.payee}
              maxLength={160}
              placeholder="Shop or person"
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ payee: event.target.value })}
            />
          </Field>
          <Field id="expense-receipt" label="Receipt number" optional>
            <input
              id="expense-receipt"
              value={form.receipt}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => set({ receipt: event.target.value })}
            />
          </Field>
          <Field
            id="expense-receipt-photo"
            label="Photo of the receipt"
            hint={
              form.receiptFile
                ? `${form.receiptFile.name} chosen. A photo or PDF, up to 10 MB.`
                : 'A photo or PDF, up to 10 MB.'
            }
            optional
          >
            <input
              id="expense-receipt-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              capture="environment"
              onChange={(event) => set({ receiptFile: event.target.files?.[0] ?? null })}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the expense" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Spent on" onChange={() => wizard.change('what')}>
              {form.description.trim()} ({kindName})
            </WizardSummaryRow>
            <WizardSummaryRow label="Amount" onChange={() => wizard.change('money')}>
              USD {form.amount.trim()} on {formatFriendlyDate(form.date)}
            </WizardSummaryRow>
            <WizardSummaryRow label="Paid" onChange={() => wizard.change('paid')}>
              {stations.length > 1 && stationName ? `${stationName} · ` : ''}
              {form.paymentMethod === 'OTHER'
                ? `Other: ${form.paymentMethodOther.trim()}`
                : EXPENSE_ENTRY_PAYMENT_METHOD_LABELS[form.paymentMethod]}
            </WizardSummaryRow>
            <WizardSummaryRow label="Details" onChange={() => wizard.change('extra')}>
              {[
                form.payee.trim() ? `Paid to ${form.payee.trim()}` : '',
                form.receipt.trim() ? `Receipt ${form.receipt.trim()}` : '',
                form.receiptFile ? 'Photo attached' : '',
              ]
                .filter(Boolean)
                .join(' · ') || 'None'}
            </WizardSummaryRow>
          </WizardSummary>
          {error ? <ErrorState title="Could not save the expense" message={error} /> : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Enter expense"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------- regular cost

type RegularStep = 'what' | 'money' | 'review';

export type NewRegularCostValue = {
  name: string;
  categoryId: string;
  stationId: string;
  amount: string;
  start: string;
  end: string;
};

const REGULAR_SEQUENCE: readonly RegularStep[] = ['what', 'money', 'review'];

/** Add a cost that repeats every month, one question at a time. */
export function RegularCostWizard({
  categories,
  stations,
  initial,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  categories: readonly Choice[];
  stations: readonly Choice[];
  initial: NewRegularCostValue;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: NewRegularCostValue) => void;
}) {
  const [form, setForm] = useState<NewRegularCostValue>(initial);
  const wizard = useWizard<RegularStep>({
    start: 'what',
    sequence: REGULAR_SEQUENCE,
    onCancel,
  });
  const { step, errors } = wizard;
  const set = (patch: Partial<NewRegularCostValue>) =>
    setForm((current) => ({ ...current, ...patch }));
  const kindName = categories.find((category) => category.id === form.categoryId)?.name ?? '';
  const stationName = stations.find((station) => station.id === form.stationId)?.name ?? '';
  const isOther = isOtherKind(kindName);

  function next() {
    if (step === 'what') {
      return wizard.advance(
        checkRegularWhat(form.name, form.categoryId, form.stationId, isOther),
        'money',
        'review',
      );
    }
    if (step === 'money') {
      return wizard.advance(checkRegularMoney(form.amount, form.start, form.end), 'review');
    }
    onSubmit(form);
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
      {step === 'what' ? (
        <WizardStep
          wizard={wizard}
          title="What is the regular cost?"
          hint="A cost that repeats every month, such as rent or security."
        >
          <Field
            id="regular-name"
            label={isOther ? 'What is this cost?' : 'Name'}
            hint={isOther ? 'You chose Other, so tell us what it is.' : undefined}
            error={errors['regular-name']}
            required
          >
            <input
              id="regular-name"
              value={form.name}
              maxLength={160}
              placeholder="e.g. Rent"
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>
          <Field
            id="regular-category"
            label="Kind of expense"
            error={errors['regular-category']}
            required
          >
            <select
              id="regular-category"
              value={form.categoryId}
              onChange={(event) => set({ categoryId: event.target.value })}
            >
              <option value="">Choose…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="regular-station"
            label="Which station is this for?"
            error={errors['regular-station']}
            required
          >
            <select
              id="regular-station"
              value={form.stationId}
              onChange={(event) => set({ stationId: event.target.value })}
            >
              <option value="">Choose a station…</option>
              {stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'money' ? (
        <WizardStep
          wizard={wizard}
          title="How much, and from when?"
          hint="It is spread across every day automatically."
        >
          <Field
            id="regular-amount"
            label="Each month (USD)"
            error={errors['regular-amount']}
            required
          >
            <input
              id="regular-amount"
              inputMode="decimal"
              value={form.amount}
              placeholder="0.00"
              autoComplete="off"
              autoFocus
              onChange={(event) => set({ amount: event.target.value })}
            />
          </Field>
          <WizardPair>
            <Field id="regular-start" label="Starts on" error={errors['regular-start']} required>
              <input
                id="regular-start"
                type="date"
                value={form.start}
                onChange={(event) => set({ start: event.target.value })}
              />
            </Field>
            <Field id="regular-end" label="Stops on" error={errors['regular-end']} optional>
              <input
                id="regular-end"
                type="date"
                value={form.end}
                onChange={(event) => set({ end: event.target.value })}
              />
            </Field>
          </WizardPair>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the regular cost" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Cost" onChange={() => wizard.change('what')}>
              {form.name.trim()} ({kindName}) · {stationName}
            </WizardSummaryRow>
            <WizardSummaryRow label="Amount" onChange={() => wizard.change('money')}>
              USD {form.amount.trim()} a month from {formatFriendlyDate(form.start)}
              {form.end ? ` to ${formatFriendlyDate(form.end)}` : ', with no end date'}
            </WizardSummaryRow>
          </WizardSummary>
          {error ? <ErrorState title="Could not add the cost" message={error} /> : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Add regular cost"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
