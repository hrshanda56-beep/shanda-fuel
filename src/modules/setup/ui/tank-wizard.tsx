'use client';

import { useState } from 'react';

import { Button, Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardNotice,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import {
  WizardAnother,
  WizardOptions,
  WizardUsualOrOwn,
  WizardYesNo,
} from '@/design-system/wizard-kit';
import type { SetupTank } from '../contracts';
import {
  BLANK_TANK,
  MAX_TANK_NAME,
  STANDARD_ALERT_PERCENT,
  STANDARD_WARNING_PERCENT,
  answersFromTank,
  checkLimits,
  checkName,
  checkReminder,
  checkSentence,
  checkSize,
  deleteTankCommand,
  retireTankCommand,
  reminderSentence,
  reorderSuggestions,
  tankCommand,
  tankFuelMismatch,
  tankSteps,
  withSeparators,
  type ReorderChoice,
  type TankAnswers,
  type TankExtraScreen,
  type TankStep,
} from '../tank-wizard';

type Screen = TankStep | TankExtraScreen | 'pick' | 'done';

/** A fuel the tank could hold. */
export type TankFuel = { id: string; name: string; kind?: string | null };

/** Saves one command; resolves true when it went through. Provided by the screen that owns saving. */
export type SaveCommand = (body: Record<string, unknown>, success: string) => Promise<boolean>;

const NEW_TANK = 'new';

/**
 * Add a tank, or change one, one question at a time (#256): its name, its size, whether to remind
 * you to order fuel, and how big a stock difference is acceptable. Ends with "Do you want to change
 * something else?". It draws no card of its own; the page that opens it supplies one.
 */
export function TankWizard({
  tenantId,
  stationId,
  productId,
  word,
  tanks,
  allCodes,
  fuels,
  allTanks,
  canManage,
  save,
  busy,
  onAnother,
  onFinish,
  onCancel,
}: {
  tenantId: string;
  stationId: string;
  productId: string;
  /** "litres" or "kilograms". */
  word: string;
  /** This fuel's active tanks. */
  tanks: readonly SetupTank[];
  /** Every tank name at the station, so a new one never repeats one. */
  allCodes: readonly string[];
  /** The station's active fuels, to name the fuel and to move an unused tank to another (#315). */
  fuels: readonly TankFuel[];
  /** Every active tank at the station, so a tank is never moved onto a fuel that has one. */
  allTanks: readonly SetupTank[];
  canManage: boolean;
  save: SaveCommand;
  busy: boolean;
  /** "Yes, change something else": back to the question of what to change. */
  onAnother: () => void;
  /** "No, I am done". */
  onFinish: () => void;
  /** Back from the first screen. */
  onCancel: () => void;
}) {
  const sequence = tankSteps();
  const wizard = useWizard<Screen>({
    start: tanks.length > 0 && canManage ? 'pick' : 'name',
    sequence,
    onCancel,
  });
  const [answers, setAnswers] = useState<TankAnswers>(BLANK_TANK);
  const [editing, setEditing] = useState<SetupTank | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  /** The fuel the tank will hold: the one the wizard was opened for, unless changed (#315). */
  const [fuelId, setFuelId] = useState(productId);
  const [fuelPick, setFuelPick] = useState<string | null>(productId);
  const set = (patch: Partial<TankAnswers>) => setAnswers((current) => ({ ...current, ...patch }));
  const errors = wizard.errors;
  const upper = word.charAt(0).toUpperCase() + word.slice(1);
  /** Names the tank being changed may keep. */
  const others = allCodes.filter((code) => code !== editing?.code);
  const unitShort = word === 'kilograms' ? 'kg' : 'L';
  const shown = { ...wizard, position: wizard.position, total: sequence.length };
  /** Screens that are not one of the numbered steps (the pick list and the ending). */
  const alone = { ...wizard, position: 1, total: 0 };

  const fuelOf = (id: string) => fuels.find((f) => f.id === id);
  const chosenFuel = fuelOf(fuelId) ?? { id: fuelId, name: 'this fuel' };
  /** A new tank, or one with no stock records yet, may still change fuel or be deleted. */
  const canMove = !editing || editing.unused;
  const otherTankOn = (id: string) =>
    allTanks.find((t) => t.status === 'ACTIVE' && t.productId === id && t.id !== editing?.id);

  function startFrom(choice: string) {
    setFuelId(productId);
    setFuelPick(productId);
    if (choice === NEW_TANK) {
      setEditing(null);
      setAnswers(BLANK_TANK);
    } else {
      const tank = tanks.find((t) => t.id === choice) ?? null;
      setEditing(tank);
      setAnswers(tank ? answersFromTank(tank) : BLANK_TANK);
    }
    wizard.go('name');
  }

  async function finish() {
    const command = tankCommand({
      answers,
      tenantId,
      stationId,
      existingCodes: others,
      productId: fuelId,
      ...(editing ? { tankId: editing.id, currentProductId: editing.productId } : {}),
    });
    const name = answers.name.trim();
    const saved = await save(command, editing ? `${name} was changed.` : `${name} was added.`);
    if (saved) wizard.go('done');
  }

  async function remove() {
    if (!editing) return;
    const saved = await save(
      deleteTankCommand({ tenantId, stationId, tankId: editing.id }),
      `${editing.code} was deleted.`,
    );
    if (saved) wizard.go('done');
  }

  async function retire() {
    if (!editing) return;
    const saved = await save(
      retireTankCommand({ tenantId, stationId, tankId: editing.id }),
      `${editing.code} is no longer in use.`,
    );
    if (saved) wizard.go('done');
  }

  if (wizard.step === 'pick') {
    return (
      <WizardStep wizard={alone} title="Which tank?">
        <WizardOptions
          label="Which tank?"
          name="tank-pick"
          value={picked}
          onPick={setPicked}
          options={[
            ...tanks.map((tank) => ({
              value: tank.id,
              label: tank.code,
              detail: `Holds ${withSeparators(tank.capacityLitres)} ${word}`,
            })),
            { value: NEW_TANK, label: 'Add a new tank', detail: 'A tank that is not listed here' },
          ]}
        />
        {errors.pick ? (
          <p className="field-error" role="alert">
            {errors.pick}
          </p>
        ) : null}
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            picked
              ? startFrom(picked)
              : wizard.setErrors({ pick: 'Choose a tank, or add a new one.' })
          }
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'name') {
    return (
      <WizardStep wizard={shown} title="What is this tank called?">
        <Field id="name" label="Tank name" error={errors.name} required>
          <input
            id="name"
            value={answers.name}
            maxLength={MAX_TANK_NAME}
            autoComplete="off"
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkName(answers.name, others), 'size', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'size') {
    return (
      <WizardStep wizard={shown} title={`How many ${word} does it hold?`}>
        <NumericInput
          id="capacity"
          label={`${upper} the tank holds`}
          unit={unitShort}
          value={answers.capacity}
          error={errors.capacity}
          required
          autoComplete="off"
          onChange={(event) => set({ capacity: event.target.value })}
        />
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkSize(answers.capacity, word), 'reminder', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'reminder') {
    const suggestions = reorderSuggestions(answers.capacity);
    return (
      <WizardStep
        wizard={shown}
        title="Should we remind you to order more fuel when it gets low?"
        hint="You will see a reminder once the tank is down to the amount you choose."
      >
        <WizardYesNo
          label="Remind me to order more fuel"
          name="remind"
          value={answers.remind}
          onPick={(remind) => set({ remind })}
        />
        {errors.remind ? (
          <p className="field-error" role="alert">
            {errors.remind}
          </p>
        ) : null}
        {answers.remind === true ? (
          <>
            <WizardOptions<ReorderChoice>
              label="Remind me when it falls to"
              name="reorder"
              value={answers.reorderChoice}
              onPick={(reorderChoice) => set({ reorderChoice })}
              options={[
                ...suggestions.map((option) => ({
                  value: option.value,
                  label: `${withSeparators(option.amount)} ${word}`,
                  detail: `${option.percent}% of the tank`,
                })),
                { value: 'own' as const, label: 'A different amount' },
              ]}
            />
            {errors.reorderChoice ? (
              <p className="field-error" role="alert">
                {errors.reorderChoice}
              </p>
            ) : null}
            {answers.reorderChoice === 'own' ? (
              <NumericInput
                id="reorderOwn"
                label={`Remind me when it falls to`}
                unit={unitShort}
                value={answers.reorderOwn}
                error={errors.reorderOwn}
                autoComplete="off"
                onChange={(event) => set({ reorderOwn: event.target.value })}
              />
            ) : null}
          </>
        ) : null}
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkReminder(answers, word), 'check', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'check') {
    return (
      <WizardStep
        wizard={shown}
        title="How big a difference is acceptable?"
        hint="Each dip is compared with the stock the books expect."
      >
        <WizardUsualOrOwn
          label="Check differences"
          name="limits"
          mode={answers.limitMode}
          onPick={(limitMode) => set({ limitMode })}
          usualLabel="Use the standard check"
          usualDetail={`A warning past ${STANDARD_WARNING_PERCENT}% and an alert past ${STANDARD_ALERT_PERCENT}% of the fuel sold since the last dip`}
          ownLabel="Set my own limits"
          ownDetail={`Choose the amounts in ${word}`}
        >
          <NumericInput
            id="explain"
            label="Ask for an explanation when the difference is more than"
            unit={unitShort}
            value={answers.explain}
            error={errors.explain}
            autoComplete="off"
            onChange={(event) => set({ explain: event.target.value })}
          />
          <NumericInput
            id="urgent"
            label="Treat it as urgent when the difference is more than"
            unit={unitShort}
            value={answers.urgent}
            error={errors.urgent}
            autoComplete="off"
            onChange={(event) => set({ urgent: event.target.value })}
          />
        </WizardUsualOrOwn>
        {errors.limitMode ? (
          <p className="field-error" role="alert">
            {errors.limitMode}
          </p>
        ) : null}
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkLimits(answers, word), 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'fuel') {
    return (
      <WizardStep
        wizard={alone}
        title={`Which fuel is in ${answers.name.trim() || 'this tank'}?`}
        hint="Choose the fuel the tank really holds."
      >
        <WizardOptions<string>
          label="Fuel"
          name="tank-fuel"
          value={fuelPick}
          onPick={setFuelPick}
          options={fuels.map((fuel) => ({
            value: fuel.id,
            label: fuel.name,
            detail: otherTankOn(fuel.id)
              ? `Already has ${otherTankOn(fuel.id)!.code}`
              : fuel.id === fuelId
                ? 'Chosen now'
                : undefined,
          }))}
        />
        {errors.fuel ? (
          <p className="field-error" role="alert">
            {errors.fuel}
          </p>
        ) : null}
        <WizardActions
          wizard={wizard}
          onContinue={() => {
            if (!fuelPick) return wizard.setErrors({ fuel: 'Choose a fuel.' });
            const clash = otherTankOn(fuelPick);
            if (clash && fuelPick !== fuelId) {
              return wizard.setErrors({
                fuel: `${fuelOf(fuelPick)?.name ?? 'That fuel'} already has a tank (${clash.code}). Two tanks of one fuel cannot be tracked yet.`,
              });
            }
            setFuelId(fuelPick);
            // Back to the check screen it was opened from, without adding it to the trail again.
            wizard.back();
          }}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'delete' && editing) {
    return (
      <WizardStep wizard={alone} title={`Delete ${editing.code}?`}>
        <WizardNotice>
          {editing.code} has no stock records yet, so it can be deleted completely. This cannot be
          undone, but you can add the tank again later.
        </WizardNotice>
        <WizardActions
          wizard={wizard}
          busy={busy}
          continueLabel="Delete the tank"
          onContinue={() => void remove()}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'retire' && editing) {
    return (
      <WizardStep wizard={alone} title={`Stop using ${editing.code}?`}>
        <WizardNotice>
          {editing.code} has stock records, so it cannot be deleted. Stopping use of it hides it
          from new entries and from this list. Everything already recorded is kept, and past reports
          still show it. It can only be done when the tank holds no fuel and no shift is open.
        </WizardNotice>
        <WizardActions
          wizard={wizard}
          busy={busy}
          continueLabel="Stop using the tank"
          onContinue={() => void retire()}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'review') {
    const mismatch = tankFuelMismatch(answers.name, chosenFuel, fuels);
    return (
      <WizardStep
        wizard={shown}
        title={editing ? `Check the changes to ${editing.code}` : 'Check the new tank'}
        hint={WIZARD_REVIEW_HINT}
      >
        {editing && !editing.unused ? (
          <WizardNotice>
            The fuel in this tank cannot be changed because past stock records use it. To store a
            different fuel, add a new tank.
          </WizardNotice>
        ) : null}
        {mismatch ? (
          <WizardNotice>
            The name {answers.name.trim()} sounds like {mismatch.name}, but this tank is set to hold{' '}
            {chosenFuel.name}. If it holds {mismatch.name}, change the fuel below.
          </WizardNotice>
        ) : null}
        <WizardSummary>
          <WizardSummaryRow
            label="Fuel"
            {...(canMove && fuels.length > 1
              ? {
                  onChange: () => {
                    setFuelPick(fuelId);
                    wizard.go('fuel');
                  },
                }
              : {})}
          >
            {chosenFuel.name}
          </WizardSummaryRow>
          <WizardSummaryRow label="Name" onChange={() => wizard.change('name')}>
            {answers.name.trim()}
          </WizardSummaryRow>
          <WizardSummaryRow label="Size" onChange={() => wizard.change('size')}>
            {withSeparators(answers.capacity)} {word}
          </WizardSummaryRow>
          <WizardSummaryRow label="Reminder" onChange={() => wizard.change('reminder')}>
            {reminderSentence(answers, word)}
          </WizardSummaryRow>
          <WizardSummaryRow label="Differences" onChange={() => wizard.change('check')}>
            {checkSentence(answers, word)}
          </WizardSummaryRow>
        </WizardSummary>
        <WizardActions
          wizard={wizard}
          busy={busy}
          continueLabel={editing ? 'Save changes' : 'Add the tank'}
          onContinue={() => void finish()}
        />
        {editing?.unused ? (
          <Button variant="quiet" onClick={() => wizard.go('delete')}>
            Delete this tank
          </Button>
        ) : editing ? (
          <Button variant="quiet" onClick={() => wizard.go('retire')}>
            Stop using this tank
          </Button>
        ) : null}
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
