'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { Button, Field, NumericInput } from '../../../design-system/primitives';
import {
  WizardActions,
  WizardNotice,
  WizardQuiet,
  WizardStep,
} from '../../../design-system/wizard';
import { WizardOptions, type WizardOption } from '../../../design-system/wizard-kit';
import { paymentNeeds } from './figures-wizard';

/**
 * The questions of the shift figures, one per screen (#253). Each component draws one screen and
 * holds no state of its own: the workspace owns the answers, checks them and decides where to go.
 */

/** "Question 5 of 14" and the focus handle every screen shares. */
export type Frame = {
  position: number;
  total: number;
  captureHeading: Dispatch<SetStateAction<HTMLHeadingElement | null>>;
};

type Navigation = {
  frame: Frame;
  onBack: () => void;
  onContinue: () => void;
  continueLabel?: string;
  busy?: boolean;
  /** An extra button after Back, for example "Remove this line". */
  extra?: ReactNode;
};

function Screen({
  title,
  hint,
  children,
  problem,
  nav,
  enterContinues = true,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  problem?: string | null;
  nav: Navigation;
  /** Enter in a single-line box moves on. Off where the box has its own button. */
  enterContinues?: boolean;
}) {
  return (
    <WizardStep wizard={nav.frame} title={title} hint={hint} calm>
      <div
        className="wizard-fields"
        {...(enterContinues ? {} : { 'data-no-enter': '' })}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          if (!enterContinues || event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') {
            event.preventDefault();
            nav.onContinue();
          }
        }}
      >
        {children}
        {problem ? (
          <p className="field-error" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
      <WizardActions
        wizard={{ atStart: false, back: nav.onBack }}
        onContinue={nav.onContinue}
        continueLabel={nav.continueLabel}
        busy={nav.busy}
        extra={nav.extra}
      />
    </WizardStep>
  );
}

/* ----------------------------------- team ----------------------------------- */

type Person = { id: string; name: string; stationName?: string };

export function TeamScreen({
  nav,
  title,
  hint,
  people,
  selected,
  onToggle,
  emptyText,
  problem,
}: {
  nav: Navigation;
  title: string;
  hint: string;
  people: readonly Person[];
  selected: readonly string[];
  onToggle: (id: string, checked: boolean) => void;
  emptyText?: string;
  problem?: string | null;
}) {
  return (
    <Screen title={title} hint={hint} nav={nav} problem={problem}>
      {people.length === 0 && emptyText ? <WizardNotice>{emptyText}</WizardNotice> : null}
      <fieldset className="attendant-fieldset">
        <legend className="sr-only">{title}</legend>
        <div className="choice-grid">
          {people.map((person) => (
            <label className="choice-card" key={person.id}>
              <input
                type="checkbox"
                checked={selected.includes(person.id)}
                onChange={(event) => onToggle(person.id, event.target.checked)}
              />
              <span>
                <strong>{person.name}</strong>
                {person.stationName ? (
                  <span className="metric-meta"> Usually at {person.stationName}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </Screen>
  );
}

/* ----------------------------------- pumps ---------------------------------- */

export function NoPumpsScreen({ nav }: { nav: Navigation }) {
  return (
    <Screen
      title="No pumps are set up yet"
      hint="Ask your manager to set them up."
      nav={{ ...nav, continueLabel: 'Continue' }}
    >
      {null}
    </Screen>
  );
}

export function PumpScreen({
  nav,
  pumpLabel,
  fuelName,
  opening,
  closing,
  error,
  unit,
  litresLabel,
  result,
  belowOpening,
  noPrice,
  onChange,
  correcting,
  onChangeOpening,
  correctionButton,
}: {
  nav: Navigation;
  pumpLabel: string;
  fuelName: string;
  opening: string;
  /** What is typed in the closing box (empty until the person types). */
  closing: string;
  error?: string;
  unit: string;
  litresLabel: string;
  /** "643 L sold · USD 964.50", empty until a reading is typed. */
  result: string;
  belowOpening: boolean;
  noPrice: boolean;
  onChange: (value: string) => void;
  /** Correcting the opening reading (a manager's right): the opening is typed too. */
  correcting: boolean;
  onChangeOpening: (value: string) => void;
  correctionButton?: ReactNode;
}) {
  const id = `closing-${pumpLabel.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Screen
      title={`What does the meter show on ${pumpLabel.toLowerCase()}?`}
      hint={`${fuelName}. Opening ${opening}.`}
      nav={nav}
    >
      {correcting ? (
        <NumericInput
          id={`${id}-opening`}
          label="Opening reading"
          value={opening}
          onChange={(event) => onChangeOpening(event.target.value)}
          unit={unit}
        />
      ) : null}
      <NumericInput
        id={id}
        label="Reading now"
        value={closing}
        error={error}
        onChange={(event) => onChange(event.target.value)}
        unit={unit}
        required
        autoComplete="off"
      />
      {result && !belowOpening ? (
        <WizardQuiet>
          {litresLabel === 'Kilograms sold' ? 'Kilograms' : 'Litres'} sold: {result}
        </WizardQuiet>
      ) : null}
      {belowOpening && !error ? (
        <p className="field-error" role="alert">
          That is lower than the opening reading. Check both numbers.
        </p>
      ) : null}
      {noPrice ? (
        <p className="field-error" role="alert">
          No selling price is set for this fuel. Ask your manager.
        </p>
      ) : null}
      {correctionButton}
    </Screen>
  );
}

/* ------------------------------ payments and expenses ----------------------- */

type Choice = { value: string; label: string };

/** "Any other way?": pick one, or say no. One tap either way, so there is no Continue button. */
export function AddMoreScreen({
  nav,
  title,
  hint,
  name,
  choices,
  doneLabel,
  onPick,
  onDone,
}: {
  nav: Pick<Navigation, 'frame' | 'onBack'>;
  title: string;
  hint?: string;
  name: string;
  choices: readonly Choice[];
  doneLabel: string;
  /** A way was picked: the workspace adds a line and opens it. */
  onPick: (value: string) => void;
  onDone: () => void;
}) {
  const options: WizardOption<string>[] = [
    ...choices.map((choice) => ({ value: choice.value, label: choice.label })),
    { value: '__done', label: doneLabel },
  ];
  return (
    <WizardStep wizard={nav.frame} title={title} hint={hint} calm>
      <WizardOptions<string>
        label={title}
        name={name}
        options={options}
        value={null}
        onPick={(value) => (value === '__done' ? onDone() : onPick(value))}
      />
      <div className="wizard-back">
        <Button type="button" variant="secondary" onClick={nav.onBack}>
          Back
        </Button>
      </div>
    </WizardStep>
  );
}

/** One of the usual ways of paying: a single amount, left empty when nobody paid this way. */
export function PaymentNameScreen({
  nav,
  title,
  amount,
  error,
  onAmount,
}: {
  nav: Navigation;
  title: string;
  amount: string;
  error?: string;
  onAmount: (value: string) => void;
}) {
  return (
    <Screen title={title} hint="Leave empty if none." nav={nav}>
      <NumericInput
        id="payment-name-amount"
        label="Amount"
        value={amount}
        error={error}
        onChange={(event) => onAmount(event.target.value)}
        unit="USD"
        autoComplete="off"
      />
    </Screen>
  );
}

/** A way of paying that is for a named person: the customer, or who received the fuel. */
export function PaymentWhoScreen({
  nav,
  method,
  customerAccountId,
  beneficiaryName,
  customers,
  errors,
  onCustomer,
  onBeneficiary,
  onRemove,
}: {
  nav: Navigation;
  method: string;
  customerAccountId: string;
  beneficiaryName: string;
  customers: readonly Choice[];
  errors: Record<string, string>;
  onCustomer: (value: string) => void;
  onBeneficiary: (value: string) => void;
  onRemove: () => void;
}) {
  const needs = paymentNeeds(method);
  return (
    <Screen
      title={needs.customer ? 'Which customer?' : 'Who received the fuel?'}
      nav={{
        ...nav,
        extra: (
          <Button type="button" variant="quiet" onClick={onRemove}>
            Remove
          </Button>
        ),
      }}
    >
      {needs.customer ? (
        <Field id="payment-customer" label="Customer" error={errors.customer} required>
          <select
            id="payment-customer"
            value={customerAccountId}
            onChange={(event) => onCustomer(event.target.value)}
          >
            <option value="">Choose the customer</option>
            {customers.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field id="payment-beneficiary" label="Name" error={errors.beneficiary} required>
          <input
            id="payment-beneficiary"
            value={beneficiaryName}
            maxLength={160}
            onChange={(event) => onBeneficiary(event.target.value)}
          />
        </Field>
      )}
    </Screen>
  );
}

/** How much was paid a way picked from "any other way". */
export function PaymentLineScreen({
  nav,
  title,
  amount,
  error,
  onAmount,
  onRemove,
}: {
  nav: Navigation;
  title: string;
  amount: string;
  error?: string;
  onAmount: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <Screen
      title={title}
      nav={{
        ...nav,
        extra: (
          <Button type="button" variant="quiet" onClick={onRemove}>
            Remove
          </Button>
        ),
      }}
    >
      <NumericInput
        id="payment-line-amount"
        label="Amount"
        value={amount}
        error={error}
        onChange={(event) => onAmount(event.target.value)}
        unit="USD"
        required
        autoComplete="off"
      />
    </Screen>
  );
}

/** First question of an expense: what the money was for, in a few words. */
export function ExpenseWhatScreen({
  nav,
  value,
  error,
  onChange,
  onRemove,
}: {
  nav: Navigation;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <Screen
      title="What was paid for?"
      hint="For example repairs, or cleaning supplies."
      nav={{
        ...nav,
        extra: (
          <Button type="button" variant="quiet" onClick={onRemove}>
            Remove
          </Button>
        ),
      }}
    >
      <Field id="expense-what" label="What for" error={error} required>
        <input
          id="expense-what"
          value={value}
          maxLength={160}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    </Screen>
  );
}

export function ExpenseAmountScreen({
  nav,
  amount,
  error,
  onAmount,
}: {
  nav: Navigation;
  amount: string;
  error?: string;
  onAmount: (value: string) => void;
}) {
  return (
    <Screen title="How much was it?" nav={nav}>
      <NumericInput
        id="expense-amount"
        label="Amount"
        value={amount}
        error={error}
        onChange={(event) => onAmount(event.target.value)}
        unit="USD"
        required
        autoComplete="off"
      />
    </Screen>
  );
}

/** How it was paid: one tap picks the way and moves on. */
export function ExpensePaidScreen({
  nav,
  methods,
  value,
  onPick,
  onContinue,
}: {
  nav: Pick<Navigation, 'frame' | 'onBack'>;
  methods: readonly Choice[];
  value: string;
  onPick: (value: string) => void;
  /** For when the way already shown (Cash) is the right one. */
  onContinue: () => void;
}) {
  return (
    <WizardStep wizard={nav.frame} title="How was it paid?" calm>
      <WizardOptions<string>
        label="How was it paid?"
        name="expense-paid"
        options={methods.map((choice) => ({ value: choice.value, label: choice.label }))}
        value={value}
        onPick={onPick}
      />
      <WizardActions wizard={{ atStart: false, back: nav.onBack }} onContinue={onContinue} />
    </WizardStep>
  );
}

/* ------------------------------------ cash ---------------------------------- */

export function CashScreen({
  nav,
  value,
  error,
  onChange,
  expected,
  difference,
}: {
  nav: Navigation;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  /** Cash we expected to be holding, after payouts. */
  expected: string;
  /** The cash difference, empty until a count is typed. */
  difference: string | null;
}) {
  return (
    <Screen title="How much cash did you count?" nav={nav}>
      <NumericInput
        id="cash-counted"
        label="Cash counted"
        value={value}
        error={error}
        onChange={(event) => onChange(event.target.value)}
        unit="USD"
        required
        autoComplete="off"
      />
      <WizardQuiet>
        Expected {expected}
        {difference ? ` · Difference ${difference}` : ''}
      </WizardQuiet>
    </Screen>
  );
}

/* ------------------------------ tanks and explanations ---------------------- */

export function TankScreen({
  nav,
  title,
  hint,
  problem,
  children,
}: {
  nav: Navigation;
  title: string;
  hint: string;
  problem?: string | null;
  children: ReactNode;
}) {
  return (
    <Screen title={title} hint={hint} nav={nav} problem={problem} enterContinues={false}>
      {children}
    </Screen>
  );
}

export function ExplainScreen({
  nav,
  question,
  detail,
  id,
  value,
  error,
  onChange,
}: {
  nav: Navigation;
  question: string;
  detail: string;
  id: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Screen title={question} hint={detail} nav={nav}>
      <Field id={id} label="Explanation" error={error} required>
        <textarea
          id={id}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    </Screen>
  );
}

/** The last screen: what is done and what is not, any papers, then save or submit. */
export function SubmitScreen({
  frame,
  onBack,
  checklist,
  banners,
  summary,
  children,
  actions,
}: {
  frame: Frame;
  onBack: () => void;
  /** One small line with the sales and cash differences. */
  summary?: string;
  checklist: readonly { label: string; ok: boolean }[];
  banners?: ReactNode;
  /** Photos and papers. */
  children?: ReactNode;
  /** Save now and Submit for review. */
  actions: ReactNode;
}) {
  return (
    <WizardStep wizard={frame} title="Ready to submit?" calm>
      <ul className="entry-checklist" aria-label="Before you submit">
        {checklist.map((item) => (
          <li key={item.label} data-ok={item.ok || undefined}>
            <span aria-hidden="true">{item.ok ? '✓' : '!'}</span>
            {item.label}
          </li>
        ))}
      </ul>
      {summary ? <WizardQuiet>{summary}</WizardQuiet> : null}
      {banners}
      {children}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        {actions}
      </div>
    </WizardStep>
  );
}
