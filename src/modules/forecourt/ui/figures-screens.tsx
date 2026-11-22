'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { Button, Field, NumericInput } from '../../../design-system/primitives';
import {
  WizardActions,
  WizardNotice,
  WizardStep,
  WizardSummary,
  WizardSummaryRow,
} from '../../../design-system/wizard';
import { WizardOptions, type WizardOption } from '../../../design-system/wizard-kit';
import { paymentNeeds } from './figures-wizard';
import { PumpReadout } from './pump-readout';

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
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  problem?: string | null;
  nav: Navigation;
}) {
  return (
    <WizardStep wizard={nav.frame} title={title} hint={hint}>
      {children}
      {problem ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : null}
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
      hint="Your manager needs to set up the pumps for this station before readings can be entered."
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
  litresSold,
  priceText,
  salesValue,
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
  litresSold: string;
  priceText: string;
  salesValue: string;
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
      title={`What does the meter show now on ${pumpLabel.toLowerCase()}?`}
      hint={`${fuelName}. It showed ${opening} when the shift opened.`}
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
        label="Closing reading"
        value={closing}
        error={error}
        onChange={(event) => onChange(event.target.value)}
        unit={unit}
        required
        autoComplete="off"
      />
      <div className="pump-row-readings">
        <PumpReadout label={litresLabel} value={litresSold} result />
        <PumpReadout label="Price / litre" value={priceText} />
        <PumpReadout label="Sales value" value={salesValue} result />
      </div>
      {belowOpening && !error ? (
        <p className="field-error" role="alert">
          The closing reading is lower than the opening reading. Check both numbers.
        </p>
      ) : null}
      {noPrice ? (
        <p className="field-error" role="alert">
          No selling price is set for this fuel. Ask your manager before continuing.
        </p>
      ) : null}
      {correctionButton}
    </Screen>
  );
}

/* ------------------------------ payments and expenses ----------------------- */

type Choice = { value: string; label: string };

/** "Did customers pay another way?": pick a way, or say that is all. */
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
    <WizardStep wizard={nav.frame} title={title} hint={hint}>
      <WizardOptions<string>
        label={title}
        name={name}
        options={options}
        value={null}
        onPick={(value) => (value === '__done' ? onDone() : onPick(value))}
      />
      <WizardActions
        wizard={{ atStart: false, back: nav.onBack }}
        onContinue={onDone}
        continueLabel="That is all"
      />
    </WizardStep>
  );
}

export function PaymentLineScreen({
  nav,
  number,
  method,
  methods,
  amount,
  reference,
  customerAccountId,
  beneficiaryName,
  customers,
  errors,
  onMethod,
  onAmount,
  onReference,
  onCustomer,
  onBeneficiary,
  onRemove,
  runningTotal,
}: {
  nav: Navigation;
  number: number;
  method: string;
  methods: readonly Choice[];
  amount: string;
  reference: string;
  customerAccountId: string;
  beneficiaryName: string;
  customers: readonly Choice[];
  errors: Record<string, string>;
  onMethod: (value: string) => void;
  onAmount: (value: string) => void;
  onReference: (value: string) => void;
  onCustomer: (value: string) => void;
  onBeneficiary: (value: string) => void;
  onRemove: () => void;
  /** "Entered so far" across every line, shown beside the amount. */
  runningTotal?: string;
}) {
  const needs = paymentNeeds(method);
  return (
    <Screen
      title={
        number > 1
          ? `How much did customers pay this way? (line ${number})`
          : 'How much did customers pay this way?'
      }
      hint="One way of paying at a time. The total should match the expected sales."
      nav={{
        ...nav,
        extra: (
          <Button type="button" variant="quiet" onClick={onRemove}>
            Remove this line
          </Button>
        ),
      }}
    >
      <Field id={`payment-method-${number}`} label="Paid by">
        <select
          id={`payment-method-${number}`}
          value={method}
          onChange={(event) => onMethod(event.target.value)}
        >
          {methods.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </Field>
      {needs.customer ? (
        <Field
          id={`payment-customer-${number}`}
          label="Customer"
          hint={
            method === 'CUSTOMER_CREDIT'
              ? 'Who is buying on credit.'
              : 'Whose prepaid balance pays for this.'
          }
          error={errors.customer}
          required
        >
          <select
            id={`payment-customer-${number}`}
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
      ) : null}
      {needs.beneficiary ? (
        <Field
          id={`payment-beneficiary-${number}`}
          label="Who received the fuel"
          hint="Name of the staff member or manager."
          error={errors.beneficiary}
          required
        >
          <input
            id={`payment-beneficiary-${number}`}
            value={beneficiaryName}
            maxLength={160}
            onChange={(event) => onBeneficiary(event.target.value)}
          />
        </Field>
      ) : null}
      <NumericInput
        id={`payment-amount-${number}`}
        label="Amount"
        value={amount}
        error={errors.amount}
        onChange={(event) => onAmount(event.target.value)}
        unit="USD"
        required
        autoComplete="off"
      />
      <Field id={`payment-reference-${number}`} label="Reference or note" optional>
        <input
          id={`payment-reference-${number}`}
          value={reference}
          onChange={(event) => onReference(event.target.value)}
        />
      </Field>
      {runningTotal ? (
        <p className="entry-sum">
          Entered so far<strong>{runningTotal}</strong>
        </p>
      ) : null}
    </Screen>
  );
}

export function ExpenseLineScreen({
  nav,
  number,
  category,
  description,
  amount,
  paymentMethod,
  methods,
  errors,
  onCategory,
  onDescription,
  onAmount,
  onMethod,
  onRemove,
  runningTotal,
}: {
  nav: Navigation;
  number: number;
  category: string;
  description: string;
  amount: string;
  paymentMethod: string;
  methods: readonly Choice[];
  errors: Record<string, string>;
  onCategory: (value: string) => void;
  onDescription: (value: string) => void;
  onAmount: (value: string) => void;
  onMethod: (value: string) => void;
  onRemove: () => void;
  runningTotal?: string;
}) {
  return (
    <Screen
      title={number > 1 ? `What was paid out? (expense ${number})` : 'What was paid out?'}
      hint="One expense at a time."
      nav={{
        ...nav,
        extra: (
          <Button type="button" variant="quiet" onClick={onRemove}>
            Remove this expense
          </Button>
        ),
      }}
    >
      <Field id={`expense-category-${number}`} label="What for" error={errors.category} required>
        <input
          id={`expense-category-${number}`}
          value={category}
          onChange={(event) => onCategory(event.target.value)}
        />
      </Field>
      <Field
        id={`expense-description-${number}`}
        label="Details"
        error={errors.description}
        required
      >
        <input
          id={`expense-description-${number}`}
          value={description}
          onChange={(event) => onDescription(event.target.value)}
        />
      </Field>
      <NumericInput
        id={`expense-amount-${number}`}
        label="Amount"
        value={amount}
        error={errors.amount}
        onChange={(event) => onAmount(event.target.value)}
        unit="USD"
        required
        autoComplete="off"
      />
      <Field id={`expense-payment-${number}`} label="Paid with">
        <select
          id={`expense-payment-${number}`}
          value={paymentMethod}
          onChange={(event) => onMethod(event.target.value)}
        >
          {methods.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </Field>
      {runningTotal ? (
        <p className="entry-sum">
          Entered so far<strong>{runningTotal}</strong>
        </p>
      ) : null}
    </Screen>
  );
}

/* ------------------------------------ cash ---------------------------------- */

export function CashScreen({
  nav,
  value,
  error,
  onChange,
  rows,
}: {
  nav: Navigation;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  /** Cash we expected, paid out, expected after payouts and the difference. */
  rows: readonly { label: string; value: string }[];
}) {
  return (
    <Screen
      title="How much cash did you count?"
      hint="Count the cash you are holding and enter the total."
      nav={nav}
    >
      <NumericInput
        id="cash-counted"
        label="Cash counted"
        hint="The figures below update as you type."
        value={value}
        error={error}
        onChange={(event) => onChange(event.target.value)}
        unit="USD"
        required
        autoComplete="off"
      />
      <WizardSummary>
        {rows.map((row) => (
          <WizardSummaryRow key={row.label} label={row.label}>
            {row.value}
          </WizardSummaryRow>
        ))}
      </WizardSummary>
      <p className="semantic-note">
        Counting the cash here does not bank it. Collection and banking are recorded under Cash.
      </p>
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
    <Screen title={title} hint={hint} nav={nav} problem={problem}>
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
      <Field id={id} label="Your explanation" error={error} required>
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
  children,
  actions,
}: {
  frame: Frame;
  onBack: () => void;
  checklist: readonly { label: string; ok: boolean }[];
  banners?: ReactNode;
  /** Photos and papers. */
  children?: ReactNode;
  /** Save now and Submit for review. */
  actions: ReactNode;
}) {
  return (
    <WizardStep
      wizard={frame}
      title="Check the shift, then submit"
      hint="Nothing goes to review until you press Submit for review."
    >
      <ul className="entry-checklist" aria-label="Before you submit">
        {checklist.map((item) => (
          <li key={item.label} data-ok={item.ok || undefined}>
            <span aria-hidden="true">{item.ok ? '✓' : '!'}</span>
            {item.label}
          </li>
        ))}
      </ul>
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
