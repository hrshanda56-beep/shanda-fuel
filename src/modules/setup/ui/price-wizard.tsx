'use client';

import { useState } from 'react';

import { Button, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardNotice,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import { WizardAnother } from '@/design-system/wizard-kit';
import type { SetupPrice } from '../contracts';
import { describePriceState } from '../guided-setup';
import { checkPrice, priceSteps, priceText, type PriceStep, type UnitWord } from '../price-wizard';

type Screen = PriceStep | 'waiting' | 'done';

/** A price that is already on its way, and what this person may do to take it further. */
export type WaitingPrice = {
  price: SetupPrice;
  /** The button text, or null when this person cannot take it further. */
  label: string | null;
};

/**
 * Change the price of one fuel (#249): one question, then a check screen that says in plain words
 * what happens. Nothing is saved here. The page that opens it keeps the change in its list of
 * waiting changes, to be reviewed and saved once.
 */
export function PriceWizard({
  fuelName,
  word,
  current,
  waiting,
  canRequest,
  outcome,
  onStage,
  onAdvance,
  onAnother,
  onFinish,
  onCancel,
}: {
  fuelName: string;
  word: UnitWord;
  /** The price in use now, or null for a fuel with none. */
  current: string | null;
  /** Prices already waiting for the next step. A new one cannot start until they are dealt with. */
  waiting: readonly WaitingPrice[];
  /** Whether this person may suggest a price at all. */
  canRequest: boolean;
  /** What will happen after saving, e.g. "It is sent for approval…". */
  outcome: string;
  /** Adds the new price to the waiting changes. */
  onStage: (price: string) => void;
  /** Takes a waiting price one step further. */
  onAdvance: (priceId: string) => void;
  onAnother: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const sequence = priceSteps();
  const wizard = useWizard<Screen>({
    start: waiting.length > 0 ? 'waiting' : 'price',
    sequence,
    onCancel,
  });
  const [typed, setTyped] = useState('');
  const [value, setValue] = useState('');
  const [moved, setMoved] = useState<ReadonlySet<string>>(new Set());
  const shown = { ...wizard, total: sequence.length };
  const alone = { ...wizard, position: 1, total: 0 };
  const per = word === 'kilogram' ? 'kilogram' : 'litre';

  if (!canRequest && waiting.length === 0) {
    return (
      <WizardStep wizard={alone} title="You cannot change prices">
        <WizardNotice>
          Changing a price needs the right to suggest one. Ask the owner or a manager.
        </WizardNotice>
        <div>
          <Button variant="secondary" onClick={onCancel}>
            Back
          </Button>
        </div>
      </WizardStep>
    );
  }

  if (wizard.step === 'waiting') {
    return (
      <WizardStep
        wizard={alone}
        title={waiting.length === 1 ? 'A new price is already waiting' : 'New prices are waiting'}
        hint="Deal with it first. Then you can set another price."
      >
        <WizardSummary>
          {waiting.map(({ price, label }) => (
            <WizardSummaryRow key={price.id} label={describePriceState(price.state)}>
              <strong>{priceText(price.unitPrice, word)}</strong>{' '}
              {label ? (
                moved.has(price.id) ? (
                  <span>Added to your changes.</span>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      onAdvance(price.id);
                      setMoved((current) => new Set(current).add(price.id));
                    }}
                  >
                    {label}
                  </Button>
                )
              ) : (
                <span>Waiting for someone with the right to take it further.</span>
              )}
            </WizardSummaryRow>
          ))}
        </WizardSummary>
        <WizardActions wizard={wizard} onContinue={() => wizard.go('done')} />
      </WizardStep>
    );
  }

  if (wizard.step === 'price') {
    return (
      <WizardStep
        wizard={shown}
        title={`What is the new price per ${per} of ${fuelName}?`}
        hint={current ? `It costs ${priceText(current, word)} now.` : 'It has no price yet.'}
      >
        <NumericInput
          id="price"
          label={`New price per ${per}`}
          unit={`US$ per ${per === 'litre' ? 'L' : 'kg'}`}
          value={typed}
          error={wizard.errors.price}
          required
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
        <WizardActions
          wizard={wizard}
          onContinue={() => {
            const checked = checkPrice(typed, current, word);
            if (checked.ok) setValue(checked.value);
            wizard.advance(checked.ok ? {} : { price: checked.message }, 'review', 'review');
          }}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'review') {
    return (
      <WizardStep
        wizard={shown}
        title={`Check the new price of ${fuelName}`}
        hint={WIZARD_REVIEW_HINT}
      >
        <WizardSummary>
          <WizardSummaryRow label="Now">{priceText(current, word)}</WizardSummaryRow>
          <WizardSummaryRow label="New price" onChange={() => wizard.change('price')}>
            {priceText(value, word)}
          </WizardSummaryRow>
        </WizardSummary>
        <WizardNotice>{outcome}</WizardNotice>
        <WizardActions
          wizard={wizard}
          continueLabel="Use this price"
          onContinue={() => {
            onStage(value);
            wizard.go('done');
          }}
        />
      </WizardStep>
    );
  }

  return (
    <WizardAnother
      wizard={alone}
      title="Do you want to change something else?"
      onYes={onAnother}
      onNo={onFinish}
    />
  );
}
