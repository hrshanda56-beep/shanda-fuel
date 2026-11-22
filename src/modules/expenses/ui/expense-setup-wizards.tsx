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
} from '@/design-system/wizard';
import { WizardOptions, WizardYesNo } from '@/design-system/wizard-kit';

import {
  LIMIT_CHOICES,
  NONE,
  OTHER,
  checkCategoryName,
  checkLimit,
  currentLimitChoice,
  limitChoices,
  limitFieldId,
  limitToSend,
  type LimitKey,
} from '../expense-setup-checks';
import styles from './expenses.module.css';

/* Manage categories ------------------------------------------------------------ */

type CategoryStep = 'list' | 'name' | 'fixed' | 'review';

export type CategoryValue = { name: string; fixed: boolean };

/**
 * The kinds of expense: the list, then "Add a kind of expense" one question at a time (name, is it
 * a fixed monthly cost, check). The page gives this a new `key` each time a kind is saved, so it
 * comes back to the updated list.
 */
export function CategoryWizard({
  categories,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  categories: ReadonlyArray<{ categoryId: string; name: string; note: string }>;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: CategoryValue) => void;
}) {
  const [name, setName] = useState('');
  const [fixed, setFixed] = useState<boolean | null>(null);
  const wizard = useWizard<CategoryStep>({
    start: 'list',
    sequence: ['list', 'name', 'fixed', 'review'],
    onCancel: onClose,
  });
  const { step, errors } = wizard;

  function next() {
    if (step === 'name') {
      return wizard.advance(
        checkCategoryName(
          name,
          categories.map((category) => category.name),
        ),
        'fixed',
        'review',
      );
    }
    if (step === 'fixed') {
      return wizard.advance(
        fixed === null ? { 'new-category-fixed': 'Choose Yes or No.' } : {},
        'review',
      );
    }
    onSubmit({ name: name.trim(), fixed: fixed === true });
  }

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="Manage categories"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'list' ? (
        <WizardStep
          wizard={wizard}
          title="Kinds of expense"
          hint="These are the choices people see when they enter an expense."
        >
          {categories.length === 0 ? (
            <p className={styles.hint}>
              No kinds of expense have been set up yet. Add the first one.
            </p>
          ) : (
            <ul className={styles.categoryList} aria-label="Expense kinds">
              {categories.map((category) => (
                <li key={category.categoryId}>
                  <span>{category.name}</span>
                  <span className={styles.muted}>{category.note}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="form-actions">
            <Button type="button" onClick={() => wizard.go('name')}>
              Add a kind of expense
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </WizardStep>
      ) : null}
      {step === 'name' ? (
        <WizardStep
          wizard={wizard}
          title="What is the new kind of expense called?"
          hint="Short and clear, for example Repairs or Staff meals."
        >
          <Field id="new-category" label="Name" error={errors['new-category']} required>
            <input
              id="new-category"
              value={name}
              maxLength={160}
              autoFocus
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'fixed' ? (
        <WizardStep
          wizard={wizard}
          title="Is it a fixed monthly cost?"
          hint="Say Yes for costs such as rent, salaries or insurance, which are the same every month."
        >
          <WizardYesNo
            label="Is it a fixed monthly cost?"
            name="new-category-fixed"
            value={fixed}
            onPick={setFixed}
          />
          {errors['new-category-fixed'] ? (
            <p className="field-error" role="alert">
              {errors['new-category-fixed']}
            </p>
          ) : null}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the new kind" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Name" onChange={() => wizard.change('name')}>
              {name.trim()}
            </WizardSummaryRow>
            <WizardSummaryRow label="Fixed monthly cost" onChange={() => wizard.change('fixed')}>
              {fixed ? 'Yes' : 'No'}
            </WizardSummaryRow>
          </WizardSummary>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <WizardActions wizard={wizard} onContinue={next} continueLabel="Add" busy={busy} />
        </WizardStep>
      ) : null}
    </form>
  );
}

/* Approval limits -------------------------------------------------------------- */

type LimitStep = LimitKey | 'review';

export type LimitsValue = Record<LimitKey, string>;

const ORDER: readonly LimitKey[] = ['stepUp', 'second', 'supervisor'];

const COPY: Record<LimitKey, { title: string; hint: string; field: string; summary: string }> = {
  stepUp: {
    title: 'When should the approver confirm their identity again?',
    hint: 'The person approving must confirm it is really them, for amounts above this.',
    field: 'Needs an extra identity check above',
    summary: 'Extra identity check',
  },
  second: {
    title: 'When must a second person approve?',
    hint: 'Above this amount, two people have to approve the expense.',
    field: 'Needs a second person to approve above',
    summary: 'Second approval',
  },
  supervisor: {
    title: 'How much can a supervisor approve?',
    hint: 'Anything above this goes to finance or the owner.',
    field: 'A supervisor can approve up to',
    summary: 'Supervisor approval',
  },
};

function sentence(key: LimitKey, value: string): string {
  const send = limitToSend(value);
  if (send === null) return LIMIT_CHOICES[key].none;
  return LIMIT_CHOICES[key].sentence(send);
}

/** Change the approval limits, one at a time, ending in a check screen. */
export function ApprovalLimitsWizard({
  current,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  current: LimitsValue;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: LimitsValue) => void;
}) {
  const [values, setValues] = useState<LimitsValue>(current);
  const [picks, setPicks] = useState<Record<LimitKey, string>>({
    stepUp: currentLimitChoice('stepUp', current.stepUp),
    second: currentLimitChoice('second', current.second),
    supervisor: currentLimitChoice('supervisor', current.supervisor),
  });
  const sequence: readonly LimitStep[] = [...ORDER, 'review'];
  const wizard = useWizard<LimitStep>({ start: 'stepUp', sequence, onCancel });
  const { step, errors } = wizard;

  function next() {
    if (step === 'review') return onSubmit(values);
    const following: LimitStep = ORDER[ORDER.indexOf(step) + 1] ?? 'review';
    return wizard.advance(checkLimit(step, values[step]), following, 'review');
  }

  const key = step === 'review' ? null : step;

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="Approval limits"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {key ? (
        <WizardStep wizard={wizard} title={COPY[key].title} hint={COPY[key].hint}>
          <WizardOptions<string>
            label={COPY[key].title}
            name={`limit-${key}`}
            value={picks[key]}
            onPick={(choice) => {
              setPicks((p) => ({ ...p, [key]: choice }));
              if (choice === NONE) setValues((v) => ({ ...v, [key]: '' }));
              else if (choice !== OTHER) setValues((v) => ({ ...v, [key]: choice }));
            }}
            options={limitChoices(key)}
          />
          {picks[key] === OTHER ? (
            <NumericInput
              id={limitFieldId(key)}
              label={COPY[key].field}
              unit="USD"
              inputMode="decimal"
              required
              autoFocus
              error={errors[limitFieldId(key)]}
              value={values[key]}
              onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.value }))}
            />
          ) : null}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : (
        <WizardStep wizard={wizard} title="Check the approval limits" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            {ORDER.map((item) => (
              <WizardSummaryRow
                key={item}
                label={COPY[item].summary}
                onChange={() => wizard.change(item)}
              >
                {sentence(item, values[item])}
              </WizardSummaryRow>
            ))}
          </WizardSummary>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save limits"
            busy={busy}
          />
        </WizardStep>
      )}
    </form>
  );
}
