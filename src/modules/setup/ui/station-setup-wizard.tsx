'use client';

import { useState } from 'react';

import { Select } from '@/design-system/forms';
import { Button, Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardCard,
  WizardChoice,
  WizardChoices,
  WizardNotice,
  WizardPair,
  WizardStep,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import {
  BLEND_PERCENTS,
  PRODUCT_KINDS,
  PRODUCT_KIND_LABELS,
  suggestedFuelName,
  type ProductKind,
} from '@/platform/domain/product-order';

import type { ConfigurationSetupOverview } from '../contracts';
import {
  defaultUnitForKind,
  describeFuelKind,
  unitLabel,
  validateFuelChoice,
  type FuelUnitChoice,
} from '../guided-setup';
import type { StagedChange } from '../staged-changes';
import {
  NEW_PUMP,
  blankFuel,
  blankNozzle,
  blankTank,
  checkFuelName,
  checkNozzle,
  checkPrice,
  checkShift,
  checkTank,
  planSetupChanges,
  type Errors,
  type FuelDraft,
  type NozzleDraft,
  type ShiftDraft,
  type TankDraft,
} from '../wizard-plan';
import styles from './setup.module.css';

type Step = 'kind' | 'name' | 'price' | 'tank' | 'pump' | 'nozzle' | 'another' | 'shift' | 'review';

const nextNumber = (existing: readonly string[]): string => {
  const biggest = existing.reduce((max, value) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return String(biggest + 1);
};

const perUnit = (unit: FuelUnitChoice) => (unit === 'KILOGRAMS' ? 'kilogram' : 'litre');
const unitWord = (unit: FuelUnitChoice) => (unit === 'KILOGRAMS' ? 'kilograms' : 'litres');

/**
 * Sets up a station one question at a time: a fuel, its price, its tank, the pump and nozzle that
 * sell it, then the next fuel, then the shifts. Nothing is saved here. At the end the answers join
 * the list of waiting changes, which the person reviews and confirms once, as before.
 */
export function StationSetupWizard({
  tenantId,
  stationId,
  stationName,
  data,
  onCancel,
  onDone,
}: {
  tenantId: string;
  stationId: string;
  stationName: string;
  data: ConfigurationSetupOverview;
  onCancel: () => void;
  onDone: (changes: StagedChange[]) => void;
}) {
  const caps = data.capabilities;
  const [fuels, setFuels] = useState<FuelDraft[]>([blankFuel()]);
  const [shiftOn, setShiftOn] = useState(true);
  const [shiftDraft, setShiftDraft] = useState<ShiftDraft>({
    name: 'Day shift',
    start: '',
    end: '',
  });
  const [more, setMore] = useState<boolean | null>(null);

  const needShift = caps.shiftTemplates && (data.shiftTemplates ?? []).every((s) => !s.active);
  const sequence: Step[] = [
    'kind',
    'name',
    ...(caps.priceRequest ? (['price'] as Step[]) : []),
    ...(caps.tanks ? (['tank'] as Step[]) : []),
    ...(caps.forecourt ? (['pump', 'nozzle'] as Step[]) : []),
    'another',
    ...(needShift ? (['shift'] as Step[]) : []),
    'review',
  ];
  const wizard = useWizard<Step>({ start: 'kind', sequence, onCancel });
  const { step, index, errors } = wizard;
  const fuel = fuels[index] ?? fuels[0]!;
  const e = (key: string) => errors[`ssw-${key}`];
  const keyed = (found: Errors): Errors =>
    Object.fromEntries(Object.entries(found).map(([key, value]) => [`ssw-${key}`, value]));

  const patchFuel = (change: Partial<FuelDraft>) =>
    setFuels((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));

  const takenNames = (except: number) => [
    ...(data.products ?? []).filter((p) => p.status === 'ACTIVE').map((p) => p.name),
    ...fuels.filter((_, i) => i !== except).map((f) => f.name),
  ];

  // Pumps: the ones already saved, plus any an earlier fuel in this guide is adding.
  const earlier = fuels.slice(0, index);
  const earlierNewPumps = [
    ...new Map(
      earlier
        .filter((f) => f.nozzle && (f.nozzle.pump === NEW_PUMP || f.nozzle.pump.startsWith('new:')))
        .map((f) => {
          const nozzle = f.nozzle!;
          const number =
            nozzle.pump === NEW_PUMP ? nozzle.newPumpNumber.trim() : nozzle.pump.slice(4);
          return [number, number] as const;
        }),
    ).keys(),
  ];
  const savedPumps = (data.pumps ?? []).filter((p) => p.status === 'ACTIVE');
  const pumpNumbers = [...savedPumps.map((p) => p.number), ...earlierNewPumps];
  const pumpOptions = [
    ...savedPumps.map((p) => ({ value: p.id, label: `Pump ${p.number}` })),
    ...earlierNewPumps.map((n) => ({
      value: `new:${n}`,
      label: `Pump ${n} (added in this guide)`,
    })),
    { value: NEW_PUMP, label: 'A new pump' },
  ];

  const tankCount =
    (data.tanks ?? []).filter((t) => t.status === 'ACTIVE').length +
    earlier.filter((f) => f.tank).length;
  const tankValue: TankDraft = fuel.tank ?? blankTank(`Tank ${tankCount + 1}`);
  const nozzleValue: NozzleDraft =
    fuel.nozzle ??
    (savedPumps.length === 0 && earlierNewPumps.length === 0
      ? {
          ...blankNozzle(),
          pump: NEW_PUMP,
          newPumpNumber: nextNumber(pumpNumbers),
          number: '1',
        }
      : blankNozzle());

  function choosePump(value: string) {
    const onThisPump = (data.nozzles ?? []).filter(
      (n) => n.pumpId === value && n.status === 'ACTIVE',
    ).length;
    patchFuel({
      nozzle: {
        ...nozzleValue,
        pump: value,
        newPumpNumber:
          value === NEW_PUMP ? nozzleValue.newPumpNumber || nextNumber(pumpNumbers) : '',
        number: nozzleValue.number || (value.startsWith('new:') ? '2' : String(onThisPump + 1)),
      },
    });
    if (value === NEW_PUMP) wizard.setFocusId('ssw-newPumpNumber');
  }

  function chooseKind(kind: string) {
    patchFuel({
      kind,
      blendPercent: kind === 'BLEND' ? fuel.blendPercent : '',
      unit: defaultUnitForKind(kind),
      ...(fuel.nameEdited ? {} : { name: '' }),
    });
  }

  function suggestedName(): string {
    return PRODUCT_KINDS.includes(fuel.kind as ProductKind)
      ? suggestedFuelName(fuel.kind as ProductKind, Number(fuel.blendPercent) || null)
      : '';
  }

  function next() {
    const after = sequence[sequence.indexOf(step) + 1] ?? 'review';
    switch (step) {
      case 'kind': {
        const checked = validateFuelChoice({ ...fuel, name: 'x' });
        const found: Errors = checked.ok ? {} : { ...checked.errors };
        delete found.name;
        if (Object.keys(found).length === 0 && !fuel.nameEdited && !fuel.name) {
          patchFuel({ name: suggestedName() });
        }
        wizard.advance(keyed(found), after, 'review');
        return;
      }
      case 'name':
        wizard.advance(keyed(checkFuelName(fuel, takenNames(index))), after, 'review');
        return;
      case 'price':
        wizard.advance(keyed(checkPrice(fuel.price, fuel.unit)), after, 'review');
        return;
      case 'tank': {
        const found = checkTank(tankValue, fuel.unit);
        if (Object.keys(found).length === 0) patchFuel({ tank: tankValue });
        wizard.advance(keyed(found), after, 'review');
        return;
      }
      case 'pump': {
        // Only the pump is asked here. The nozzle's own details are checked on the next screen.
        const found: Errors = {};
        const all = checkNozzle(nozzleValue, pumpNumbers);
        if (all.pump) found.pump = all.pump;
        if (all.newPumpNumber) found.newPumpNumber = all.newPumpNumber;
        if (Object.keys(found).length === 0) patchFuel({ nozzle: nozzleValue });
        wizard.advance(keyed(found), after);
        return;
      }
      case 'nozzle': {
        const found = checkNozzle(nozzleValue, pumpNumbers);
        if (Object.keys(found).length === 0) patchFuel({ nozzle: nozzleValue });
        wizard.advance(keyed(found), after, 'review');
        return;
      }
      case 'another':
        if (more === null) {
          wizard.setErrors({ 'ssw-another-yes': 'Choose yes or no.' });
          wizard.setFocusId('ssw-another-yes');
          return;
        }
        if (more) {
          setFuels((current) => [...current, blankFuel()]);
          setMore(null);
          wizard.go('kind', fuels.length);
          return;
        }
        wizard.advance({}, after);
        return;
      case 'shift':
        if (!shiftOn) return void wizard.advance({}, after);
        wizard.advance(keyed(checkShift(shiftDraft)), after, 'review');
        return;
      default:
        finish();
    }
  }

  function skip(change: Partial<FuelDraft>) {
    patchFuel(change);
    // Skipping the pump also skips the nozzle that goes with it.
    const last = step === 'pump' ? 'nozzle' : step;
    wizard.advance({}, sequence[sequence.indexOf(last) + 1] ?? 'review', 'review');
  }

  function finish() {
    const changes = planSetupChanges({
      tenantId,
      stationId,
      fuels,
      shift: needShift && shiftOn ? shiftDraft : null,
      data,
    });
    onDone(changes);
  }

  const actions = (label = 'Continue', extra?: React.ReactNode) => (
    <WizardActions wizard={wizard} onContinue={next} continueLabel={label} extra={extra} />
  );
  const fuelName = fuel.name.trim() || 'this fuel';

  return (
    <form
      className={styles.wizardForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      <WizardCard>
        {step === 'kind' ? (
          <WizardStep
            wizard={wizard}
            title={
              index === 0 ? 'What kind of fuel do you sell?' : 'What kind of fuel is the next one?'
            }
            hint={
              index === 0
                ? `Setting up ${stationName}. Start with one fuel. You can add more after this.`
                : 'Pick the kind. You will name it next.'
            }
          >
            <WizardChoices label="Kind of fuel">
              {PRODUCT_KINDS.map((kind, i) => (
                <WizardChoice
                  key={kind}
                  id={i === 0 ? 'ssw-kind' : `ssw-kind-${kind}`}
                  name="ssw-kind"
                  checked={fuel.kind === kind}
                  onPick={() => chooseKind(kind)}
                >
                  {PRODUCT_KIND_LABELS[kind]}
                </WizardChoice>
              ))}
            </WizardChoices>
            {e('kind') ? (
              <p className="field-error" role="alert">
                {e('kind')}
              </p>
            ) : null}
            {fuel.kind === 'BLEND' ? (
              <Field
                id="ssw-blendPercent"
                label="Blend percentage"
                error={e('blendPercent')}
                required
              >
                <Select
                  id="ssw-blendPercent"
                  value={fuel.blendPercent}
                  placeholder="Choose the blend"
                  options={BLEND_PERCENTS.map((value) => ({
                    value: String(value),
                    label: `${value}%`,
                  }))}
                  onChange={(event) => patchFuel({ blendPercent: event.target.value })}
                />
              </Field>
            ) : null}
            {actions()}
          </WizardStep>
        ) : null}

        {step === 'name' ? (
          <WizardStep
            wizard={wizard}
            title="What should this fuel be called?"
            hint="This is the name staff and customers will see."
          >
            <Field id="ssw-name" label="Fuel name" error={e('name')} required>
              <input
                id="ssw-name"
                value={fuel.name}
                maxLength={120}
                autoComplete="off"
                placeholder="Diesel"
                onChange={(event) => patchFuel({ name: event.target.value, nameEdited: true })}
              />
            </Field>
            <Field id="ssw-unit" label="Measured in">
              <select
                id="ssw-unit"
                value={fuel.unit}
                onChange={(event) => patchFuel({ unit: event.target.value as FuelUnitChoice })}
              >
                {(['LITRES', 'KILOGRAMS'] as const).map((unit) => (
                  <option key={unit} value={unit}>
                    {unitLabel(unit)}
                  </option>
                ))}
              </select>
            </Field>
            {actions()}
          </WizardStep>
        ) : null}

        {step === 'price' ? (
          <WizardStep
            wizard={wizard}
            title={`What do you charge for ${fuelName} per ${perUnit(fuel.unit)}?`}
            hint="You can leave this empty and set the price later."
          >
            <NumericInput
              id="ssw-price"
              label={`Price per ${perUnit(fuel.unit)} (USD)`}
              optional
              error={e('price')}
              value={fuel.price}
              onChange={(event) => patchFuel({ price: event.target.value })}
            />
            {actions()}
          </WizardStep>
        ) : null}

        {step === 'tank' ? (
          <WizardStep
            wizard={wizard}
            title={`Which tank holds ${fuelName}?`}
            hint="Add the tank and how much it holds. You can skip this and add tanks later."
          >
            <Field id="ssw-name" label="Tank name" error={e('name')} required>
              <input
                id="ssw-name"
                value={tankValue.name}
                maxLength={32}
                autoComplete="off"
                onChange={(event) =>
                  patchFuel({ tank: { ...tankValue, name: event.target.value } })
                }
              />
            </Field>
            <NumericInput
              id="ssw-capacity"
              label={`How many ${unitWord(fuel.unit)} the tank holds`}
              required
              error={e('capacity')}
              value={tankValue.capacity}
              onChange={(event) =>
                patchFuel({ tank: { ...tankValue, capacity: event.target.value } })
              }
            />
            <details
              className={styles.more}
              open={Boolean(e('difference') || e('red') || e('reorder')) || undefined}
            >
              <summary>Stock warnings (optional)</summary>
              <NumericInput
                id="ssw-difference"
                label={`Ask for an explanation above (${unitWord(fuel.unit)})`}
                hint="How far the dip reading may be from the book stock before the difference must be explained."
                optional
                error={e('difference')}
                value={tankValue.difference}
                onChange={(event) =>
                  patchFuel({ tank: { ...tankValue, difference: event.target.value } })
                }
              />
              <NumericInput
                id="ssw-red"
                label={`Treat as urgent above (${unitWord(fuel.unit)})`}
                hint="A difference above this is urgent."
                optional
                error={e('red')}
                value={tankValue.red}
                onChange={(event) => patchFuel({ tank: { ...tankValue, red: event.target.value } })}
              />
              <NumericInput
                id="ssw-reorder"
                label={`Order more fuel when it falls to (${unitWord(fuel.unit)})`}
                hint="Used for low-stock reminders."
                optional
                error={e('reorder')}
                value={tankValue.reorder}
                onChange={(event) =>
                  patchFuel({ tank: { ...tankValue, reorder: event.target.value } })
                }
              />
            </details>
            {actions(
              'Continue',
              <Button type="button" variant="quiet" onClick={() => skip({ tank: null })}>
                Skip for now
              </Button>,
            )}
          </WizardStep>
        ) : null}

        {step === 'pump' ? (
          <WizardStep
            wizard={wizard}
            title={`Which pump sells ${fuelName}?`}
            hint="A pump can sell more than one fuel. You can skip this and add pumps later."
          >
            <Field id="ssw-pump" label="Pump" error={e('pump')} required>
              <Select
                id="ssw-pump"
                value={nozzleValue.pump}
                placeholder="Choose the pump"
                options={pumpOptions}
                onChange={(event) => choosePump(event.target.value)}
              />
            </Field>
            {nozzleValue.pump === NEW_PUMP ? (
              <WizardPair>
                <Field
                  id="ssw-newPumpNumber"
                  label="Pump number"
                  error={e('newPumpNumber')}
                  required
                >
                  <input
                    id="ssw-newPumpNumber"
                    value={nozzleValue.newPumpNumber}
                    maxLength={16}
                    autoComplete="off"
                    onChange={(event) =>
                      patchFuel({ nozzle: { ...nozzleValue, newPumpNumber: event.target.value } })
                    }
                  />
                </Field>
                <Field id="ssw-newPumpName" label="Pump name" optional>
                  <input
                    id="ssw-newPumpName"
                    value={nozzleValue.newPumpName}
                    maxLength={80}
                    autoComplete="off"
                    onChange={(event) =>
                      patchFuel({ nozzle: { ...nozzleValue, newPumpName: event.target.value } })
                    }
                  />
                </Field>
              </WizardPair>
            ) : null}
            {actions(
              'Continue',
              <Button type="button" variant="quiet" onClick={() => skip({ nozzle: null })}>
                Skip for now
              </Button>,
            )}
          </WizardStep>
        ) : null}

        {step === 'nozzle' ? (
          <WizardStep
            wizard={wizard}
            title={`Which nozzle on the pump sells ${fuelName}?`}
            hint="Each fuel has its own nozzle. You can skip this and add it later."
          >
            <Field id="ssw-number" label="Nozzle number" error={e('number')} required>
              <input
                id="ssw-number"
                value={nozzleValue.number}
                maxLength={16}
                autoComplete="off"
                onChange={(event) =>
                  patchFuel({ nozzle: { ...nozzleValue, number: event.target.value } })
                }
              />
            </Field>
            <Field
              id="ssw-meter"
              label="Meter serial number"
              hint="Printed on the meter. Opening readings are taken at the first shift."
              error={e('meter')}
              required
            >
              <input
                id="ssw-meter"
                value={nozzleValue.meter}
                maxLength={80}
                autoComplete="off"
                onChange={(event) =>
                  patchFuel({ nozzle: { ...nozzleValue, meter: event.target.value } })
                }
              />
            </Field>
            <Field
              id="ssw-since"
              label="Meter working since"
              hint="Optional. Leave empty if the meter was fitted today."
              optional
            >
              <input
                id="ssw-since"
                type="date"
                value={nozzleValue.since}
                onChange={(event) =>
                  patchFuel({ nozzle: { ...nozzleValue, since: event.target.value } })
                }
              />
            </Field>
            {actions(
              'Continue',
              <Button type="button" variant="quiet" onClick={() => skip({ nozzle: null })}>
                Skip for now
              </Button>,
            )}
          </WizardStep>
        ) : null}

        {step === 'another' ? (
          <WizardStep wizard={wizard} title="Do you sell another fuel?">
            <WizardChoices label="Another fuel">
              <WizardChoice
                id="ssw-another-yes"
                name="ssw-another"
                checked={more === true}
                onPick={() => setMore(true)}
              >
                Yes, add another fuel
              </WizardChoice>
              <WizardChoice
                id="ssw-another-no"
                name="ssw-another"
                checked={more === false}
                onPick={() => setMore(false)}
              >
                No, that is all
              </WizardChoice>
            </WizardChoices>
            {e('another-yes') ? (
              <p className="field-error" role="alert">
                {e('another-yes')}
              </p>
            ) : null}
            {actions()}
          </WizardStep>
        ) : null}

        {step === 'shift' ? (
          <WizardStep
            wizard={wizard}
            title="When does a shift run?"
            hint="Shifts are how each day is split between staff. You can add more later."
          >
            <WizardChoices label="Add a shift">
              <WizardChoice
                id="ssw-shift-yes"
                name="ssw-shift"
                checked={shiftOn}
                onPick={() => setShiftOn(true)}
              >
                Add a shift now
              </WizardChoice>
              <WizardChoice
                id="ssw-shift-no"
                name="ssw-shift"
                checked={!shiftOn}
                onPick={() => setShiftOn(false)}
              >
                I will do this later
              </WizardChoice>
            </WizardChoices>
            {shiftOn ? (
              <>
                <Field id="ssw-name" label="Shift name" error={e('name')} required>
                  <input
                    id="ssw-name"
                    value={shiftDraft.name}
                    maxLength={60}
                    autoComplete="off"
                    onChange={(event) => setShiftDraft({ ...shiftDraft, name: event.target.value })}
                  />
                </Field>
                <WizardPair>
                  <Field id="ssw-start" label="Starts at" error={e('start')} required>
                    <input
                      id="ssw-start"
                      type="time"
                      value={shiftDraft.start}
                      onChange={(event) =>
                        setShiftDraft({ ...shiftDraft, start: event.target.value })
                      }
                    />
                  </Field>
                  <Field id="ssw-end" label="Ends at" error={e('end')} required>
                    <input
                      id="ssw-end"
                      type="time"
                      value={shiftDraft.end}
                      onChange={(event) =>
                        setShiftDraft({ ...shiftDraft, end: event.target.value })
                      }
                    />
                  </Field>
                </WizardPair>
              </>
            ) : null}
            {actions()}
          </WizardStep>
        ) : null}

        {step === 'review' ? (
          <WizardStep
            wizard={wizard}
            title="Check your station setup"
            hint="Nothing is saved yet. The next screen lists everything and you confirm once."
          >
            <WizardSummary>
              {fuels.map((item, i) => (
                <FuelSummary
                  key={item.key}
                  item={item}
                  number={i + 1}
                  pumpName={(id) => savedPumps.find((p) => p.id === id)?.number ?? ''}
                  onChange={wizard.change}
                />
              ))}
              {needShift ? (
                <WizardSummaryRow label="Shift" onChange={() => wizard.change('shift', 0)}>
                  {shiftOn
                    ? `${shiftDraft.name} · ${shiftDraft.start} to ${shiftDraft.end}`
                    : 'Not now'}
                </WizardSummaryRow>
              ) : null}
            </WizardSummary>
            <WizardNotice>
              Who is in charge of the station is chosen separately, once your staff have been
              invited.
            </WizardNotice>
            {actions('Add to my changes')}
          </WizardStep>
        ) : null}
      </WizardCard>
    </form>
  );
}

function FuelSummary({
  item,
  number,
  pumpName,
  onChange,
}: {
  item: FuelDraft;
  number: number;
  pumpName: (pumpId: string) => string;
  onChange: (to: Step, index: number) => void;
}) {
  const index = number - 1;
  const kind = describeFuelKind(item.kind, Number(item.blendPercent) || null);
  return (
    <>
      <WizardSummaryRow label={`Fuel ${number}`} onChange={() => onChange('kind', index)}>
        <strong>{item.name || 'No name yet'}</strong>
        <small>
          {kind ? `${kind} · ` : ''}
          {unitLabel(item.unit)}
        </small>
      </WizardSummaryRow>
      <WizardSummaryRow label="Price" onChange={() => onChange('price', index)}>
        {item.price.trim() ? `${item.price} per ${perUnit(item.unit)}` : 'Set later'}
      </WizardSummaryRow>
      <WizardSummaryRow label="Tank" onChange={() => onChange('tank', index)}>
        {item.tank
          ? `${item.tank.name} · holds ${item.tank.capacity} ${unitWord(item.unit)}`
          : 'Add later'}
      </WizardSummaryRow>
      <WizardSummaryRow label="Pump and nozzle" onChange={() => onChange('pump', index)}>
        {item.nozzle
          ? `${
              item.nozzle.pump === NEW_PUMP
                ? `Pump ${item.nozzle.newPumpNumber}`
                : item.nozzle.pump.startsWith('new:')
                  ? `Pump ${item.nozzle.pump.slice(4)}`
                  : `Pump ${pumpName(item.nozzle.pump)}`
            }, nozzle ${item.nozzle.number}`
          : 'Add later'}
      </WizardSummaryRow>
    </>
  );
}
