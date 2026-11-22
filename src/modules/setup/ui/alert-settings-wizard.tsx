'use client';

import { useState } from 'react';

import { NumericInput } from '@/design-system/primitives';
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
  OTHER,
  REMINDER_CHOICES,
  checkDueSoon,
  checkGrace,
  checkMinimum,
  checkPosLag,
  choiceFor,
  cleanMinimum,
  daysLabel,
  type ReminderSetting,
} from '../alert-settings-checks';

type ReminderStep = ReminderSetting | 'review';

export type ReminderValues = Record<ReminderSetting, string>;

const ORDER: readonly ReminderSetting[] = ['dueSoon', 'posLag', 'grace', 'minimum'];

const COPY: Record<
  ReminderSetting,
  { title: string; hint: string; field: string; id: string; unit: string }
> = {
  dueSoon: {
    title: 'How early should we warn you about supplier invoices?',
    hint: 'Invoices falling due within this many days show as “due soon”.',
    field: 'Number of days',
    id: 'alert-due-soon',
    unit: 'days',
  },
  posLag: {
    title: 'When is a card or mobile payment late?',
    hint: 'If a payment has not been matched to a payout by then, it is flagged.',
    field: 'Number of days',
    id: 'alert-pos-lag',
    unit: 'days',
  },
  grace: {
    title: 'When is a daily report late?',
    hint: '0 flags a report the day after the day worked; larger numbers allow more time.',
    field: 'Number of days',
    id: 'alert-grace',
    unit: 'days',
  },
  minimum: {
    title: 'Which cash shortages should we ignore?',
    hint: 'Tiny differences are not worth a reminder. Shortages smaller than this are ignored.',
    field: 'Amount',
    id: 'alert-cash-minimum',
    unit: 'USD',
  },
};

const CHECKS: Record<ReminderSetting, (value: string) => WizardErrors> = {
  dueSoon: checkDueSoon,
  posLag: checkPosLag,
  grace: checkGrace,
  minimum: checkMinimum,
};

function show(setting: ReminderSetting, value: string): string {
  return setting === 'minimum' ? `US$${cleanMinimum(value)}` : daysLabel(value);
}

/** Change the reminder settings one at a time, ending in a check screen. */
export function AlertSettingsWizard({
  current,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  current: ReminderValues;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: ReminderValues) => void;
}) {
  const [values, setValues] = useState<ReminderValues>(current);
  const [picks, setPicks] = useState<Record<ReminderSetting, string>>({
    dueSoon: choiceFor('dueSoon', current.dueSoon),
    posLag: choiceFor('posLag', current.posLag),
    grace: choiceFor('grace', current.grace),
    minimum: choiceFor('minimum', current.minimum),
  });
  const sequence: readonly ReminderStep[] = [...ORDER, 'review'];
  const wizard = useWizard<ReminderStep>({ start: 'dueSoon', sequence, onCancel });
  const { step, errors } = wizard;

  function next() {
    if (step === 'review') return onSubmit(values);
    const index = ORDER.indexOf(step);
    const following: ReminderStep = ORDER[index + 1] ?? 'review';
    return wizard.advance(CHECKS[step](values[step]), following, 'review');
  }

  const setting = step === 'review' ? null : step;
  const copy = setting ? COPY[setting] : null;

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="Change reminders"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {setting && copy ? (
        <WizardStep wizard={wizard} title={copy.title} hint={copy.hint}>
          <WizardOptions<string>
            label={copy.title}
            name={`reminder-${setting}`}
            value={picks[setting]}
            onPick={(choice) => {
              setPicks((p) => ({ ...p, [setting]: choice }));
              if (choice !== OTHER) setValues((v) => ({ ...v, [setting]: choice }));
            }}
            options={[
              ...REMINDER_CHOICES[setting].map((choice) => ({
                value: choice,
                label: setting === 'minimum' ? `US$${choice}` : daysLabel(choice),
              })),
              { value: OTHER, label: 'Another number' },
            ]}
          />
          {picks[setting] === OTHER ? (
            <NumericInput
              id={copy.id}
              label={copy.field}
              unit={copy.unit}
              inputMode={setting === 'minimum' ? 'decimal' : 'numeric'}
              required
              autoFocus
              error={errors[copy.id]}
              value={values[setting]}
              onChange={(event) => setValues((v) => ({ ...v, [setting]: event.target.value }))}
            />
          ) : null}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : (
        <WizardStep wizard={wizard} title="Check the reminders" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            {ORDER.map((item) => (
              <WizardSummaryRow
                key={item}
                label={COPY[item].title}
                onChange={() => wizard.change(item)}
              >
                {show(item, values[item])}
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
            continueLabel="Save reminders"
            busy={busy}
          />
        </WizardStep>
      )}
    </form>
  );
}
