'use client';

import { useState } from 'react';

import { Field } from '@/design-system/primitives';
import {
  WizardActions,
  WizardNotice,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import { WizardAnother, WizardOptions } from '@/design-system/wizard-kit';
import type { SetupNozzle, SetupPump } from '../contracts';
import { describeMeterWorkingSince } from '../meter-working-since';
import {
  BLANK_ADD,
  BLANK_RENUMBER,
  BLANK_SINCE,
  MAX_METER,
  MAX_NUMBER,
  MAX_PUMP_NAME,
  NEW_PUMP,
  addSteps,
  checkMeter,
  checkNewPump,
  checkNozzleNumber,
  checkPumpPick,
  checkRenumber,
  checkSinceDate,
  checkSincePick,
  checkWhen,
  nextNumber,
  planAddNozzle,
  planRenumber,
  planSince,
  pumpLabel,
  renumberFrom,
  renumberIsUnchanged,
  renumberSteps,
  sinceSteps,
  type AddAnswers,
  type AddStep,
  type PumpFlow,
  type RenumberAnswers,
  type RenumberStep,
  type SinceAnswers,
  type SinceStep,
} from '../pump-wizard';
import type { StagedChange } from '../staged-changes';

type Screen = 'menu' | 'done' | AddStep | RenumberStep | SinceStep;

/**
 * The pumps and nozzles of one fuel, one question at a time (#249): add a nozzle (on a pump you
 * have or a new one), change a pump or nozzle number, or correct the day a meter started working.
 * Ends with "Do you want to change something else?". Nothing is saved here; the page that opens it
 * keeps the changes in its list of waiting changes.
 */
export function PumpWizard({
  tenantId,
  stationId,
  productId,
  fuelName,
  pumps,
  nozzles,
  canManage,
  startWith,
  onStage,
  onAnother,
  onFinish,
  onCancel,
}: {
  tenantId: string;
  stationId: string;
  productId: string;
  fuelName: string;
  /** Every active pump at the station: a nozzle for this fuel can go on any of them. */
  pumps: readonly SetupPump[];
  /** Every active nozzle at the station, so numbers stay unique on a pump. */
  nozzles: readonly SetupNozzle[];
  canManage: boolean;
  /** Opens straight on correcting a meter day, e.g. from a blocked shift close. */
  startWith?: 'meter-start';
  onStage: (changes: StagedChange[]) => void;
  onAnother: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const own = nozzles.filter((n) => n.productId === productId);
  const ownPumps = pumps.filter((p) => own.some((n) => n.pumpId === p.id));
  const editable = own.filter((n) => n.meterWorkingSinceEditable);
  const where = { tenantId, stationId };

  // Coming from a blocked shift close, go straight to correcting the meter day.
  const direct = Boolean(startWith) && editable.length > 0;
  const [flow, setFlow] = useState<PumpFlow | null>(direct ? 'since' : null);
  const [add, setAdd] = useState<AddAnswers>(BLANK_ADD);
  const [renumber, setRenumber] = useState<RenumberAnswers>(BLANK_RENUMBER);
  const [since, setSince] = useState<SinceAnswers>(
    direct && editable.length === 1 ? { nozzleId: editable[0]!.id, date: '' } : BLANK_SINCE,
  );
  const [menuPick, setMenuPick] = useState<PumpFlow | null>(null);

  const hasPumps = pumps.length > 0;
  const sequence: readonly Screen[] =
    flow === 'add'
      ? addSteps(add, hasPumps)
      : flow === 'renumber'
        ? renumberSteps()
        : flow === 'since'
          ? sinceSteps()
          : [];
  const wizard = useWizard<Screen>({
    start: direct ? (editable.length === 1 ? 'date' : 'pickNozzle') : 'menu',
    sequence,
    onCancel,
  });
  const shown = { ...wizard, total: sequence.length };
  const alone = { ...wizard, position: 1, total: 0 };
  const errors = wizard.errors;

  const pumpOf = (id: string | null) => pumps.find((p) => p.id === id);
  const numbersOn = (pumpId: string | null) =>
    nozzles.filter((n) => n.pumpId === pumpId).map((n) => n.number);
  const chosenPump = add.pump === NEW_PUMP ? null : pumpOf(add.pump);
  const setA = (patch: Partial<AddAnswers>) => setAdd((c) => ({ ...c, ...patch }));
  const setR = (patch: Partial<RenumberAnswers>) => setRenumber((c) => ({ ...c, ...patch }));
  const nozzleLabel = (n: SetupNozzle) => {
    const pump = pumpOf(n.pumpId);
    return `${pump ? pumpLabel(pump) : 'Pump'}, nozzle ${n.number}`;
  };

  function startFlow(choice: PumpFlow) {
    setFlow(choice);
    if (choice === 'add') {
      setAdd(BLANK_ADD);
      if (!hasPumps) {
        setAdd({ ...BLANK_ADD, pump: NEW_PUMP, pumpNumber: nextNumber([]) });
        wizard.go('newPump');
      } else wizard.go('pump');
    } else if (choice === 'renumber') {
      const only = ownPumps.length === 1 ? ownPumps[0]! : null;
      if (only) {
        setRenumber(
          renumberFrom(
            only,
            own.filter((n) => n.pumpId === only.id),
          ),
        );
        wizard.go('numbers');
      } else {
        setRenumber(BLANK_RENUMBER);
        wizard.go('pickPump');
      }
    } else {
      const only = editable.length === 1 ? editable[0]! : null;
      setSince({ nozzleId: only?.id ?? null, date: '' });
      wizard.go(only ? 'date' : 'pickNozzle');
    }
  }

  if (!canManage) {
    return (
      <WizardStep wizard={alone} title="You cannot change pumps or nozzles">
        <WizardNotice>
          Changing pumps and nozzles needs the right to set up the station. Ask the owner or a
          manager.
        </WizardNotice>
      </WizardStep>
    );
  }

  /* ------------------------------- the menu ------------------------------- */
  if (wizard.step === 'menu') {
    return (
      <WizardStep
        wizard={alone}
        title={`What do you want to do with the pumps and nozzles of ${fuelName}?`}
      >
        <WizardOptions<PumpFlow>
          label="What to do"
          name="pump-flow"
          value={menuPick}
          onPick={setMenuPick}
          options={[
            { value: 'add', label: 'Add a nozzle', detail: 'On a pump you have, or a new pump' },
            ...(ownPumps.length > 0
              ? [
                  {
                    value: 'renumber' as const,
                    label: 'Change a pump or nozzle number',
                    detail: 'Rename a pump or renumber its nozzles',
                  },
                ]
              : []),
            ...(editable.length > 0
              ? [
                  {
                    value: 'since' as const,
                    label: 'Correct when a meter started working',
                    detail: 'Move the day earlier, before any readings are recorded',
                  },
                ]
              : []),
          ]}
        />
        {errors.menu ? (
          <p className="field-error" role="alert">
            {errors.menu}
          </p>
        ) : null}
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            menuPick ? startFlow(menuPick) : wizard.setErrors({ menu: 'Choose what to do.' })
          }
        />
      </WizardStep>
    );
  }

  /* ----------------------------- add a nozzle ----------------------------- */
  if (wizard.step === 'pump') {
    return (
      <WizardStep wizard={shown} title="Which pump is the nozzle on?">
        <WizardOptions<string>
          label="Pump"
          name="nozzle-pump"
          value={add.pump}
          onPick={(pump) =>
            setA({
              pump,
              ...(pump === NEW_PUMP && !add.pumpNumber
                ? { pumpNumber: nextNumber(pumps.map((p) => p.number)) }
                : {}),
            })
          }
          options={[
            ...pumps.map((pump) => ({
              value: pump.id,
              label: pumpLabel(pump),
              detail: `${numbersOn(pump.id).length} nozzle${numbersOn(pump.id).length === 1 ? '' : 's'} now`,
            })),
            { value: NEW_PUMP, label: 'A new pump', detail: 'A pump that is not listed here' },
          ]}
        />
        {errors.pump ? (
          <p className="field-error" role="alert">
            {errors.pump}
          </p>
        ) : null}
        <WizardActions
          wizard={wizard}
          onContinue={() => {
            const found = checkPumpPick(add);
            if (!found.pump && add.pump !== NEW_PUMP && !add.nozzleNumber) {
              setA({ nozzleNumber: nextNumber(numbersOn(add.pump)) });
            }
            wizard.advance(found, add.pump === NEW_PUMP ? 'newPump' : 'nozzle');
          }}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'newPump') {
    return (
      <WizardStep wizard={shown} title="What is the new pump called?">
        <Field id="pumpNumber" label="Pump number" error={errors.pumpNumber} required>
          <input
            id="pumpNumber"
            value={add.pumpNumber}
            maxLength={MAX_NUMBER}
            autoComplete="off"
            onChange={(event) => setA({ pumpNumber: event.target.value })}
          />
        </Field>
        <Field
          id="pumpName"
          label="Pump name"
          hint="Optional, for example Island 1."
          error={errors.pumpName}
          optional
        >
          <input
            id="pumpName"
            value={add.pumpName}
            maxLength={MAX_PUMP_NAME}
            autoComplete="off"
            onChange={(event) => setA({ pumpName: event.target.value })}
          />
        </Field>
        <WizardActions
          wizard={wizard}
          onContinue={() => {
            const found = checkNewPump(
              add,
              pumps.map((p) => p.number),
            );
            if (Object.keys(found).length === 0 && !add.nozzleNumber) setA({ nozzleNumber: '1' });
            wizard.advance(found, 'nozzle', 'review');
          }}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'nozzle') {
    return (
      <WizardStep wizard={shown} title={`What is the number of the ${fuelName} nozzle?`}>
        <Field id="nozzleNumber" label="Nozzle number" error={errors.nozzleNumber} required>
          <input
            id="nozzleNumber"
            value={add.nozzleNumber}
            maxLength={MAX_NUMBER}
            autoComplete="off"
            onChange={(event) => setA({ nozzleNumber: event.target.value })}
          />
        </Field>
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            wizard.advance(
              checkNozzleNumber(add, add.pump === NEW_PUMP ? [] : numbersOn(add.pump)),
              'meter',
              'review',
            )
          }
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'meter') {
    return (
      <WizardStep
        wizard={shown}
        title="What is the serial number of the meter?"
        hint="It is printed on the meter. Opening readings are taken at the first shift."
      >
        <Field id="meter" label="Meter serial number" error={errors.meter} required>
          <input
            id="meter"
            value={add.meter}
            maxLength={MAX_METER}
            autoComplete="off"
            onChange={(event) => setA({ meter: event.target.value })}
          />
        </Field>
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkMeter(add), 'when', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'when') {
    return (
      <WizardStep
        wizard={shown}
        title="When was the meter fitted?"
        hint="If it was fitted before the current shift started, choose that day."
      >
        <WizardOptions<'today' | 'earlier'>
          label="When the meter was fitted"
          name="meter-fitted"
          value={add.since}
          onPick={(value) => setA({ since: value })}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'earlier', label: 'On an earlier day' },
          ]}
        />
        {errors.since ? (
          <p className="field-error" role="alert">
            {errors.since}
          </p>
        ) : null}
        {add.since === 'earlier' ? (
          <Field id="sinceDate" label="The day it was fitted" error={errors.sinceDate} required>
            <input
              id="sinceDate"
              type="date"
              value={add.sinceDate}
              onChange={(event) => setA({ sinceDate: event.target.value })}
            />
          </Field>
        ) : null}
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkWhen(add), 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'review') {
    return (
      <WizardStep wizard={shown} title="Check the new nozzle" hint={WIZARD_REVIEW_HINT}>
        <WizardSummary>
          <WizardSummaryRow
            label="Pump"
            onChange={() => wizard.change(add.pump === NEW_PUMP ? 'newPump' : 'pump')}
          >
            {add.pump === NEW_PUMP
              ? `New: ${pumpLabel({ number: add.pumpNumber.trim(), name: add.pumpName.trim() || null })}`
              : chosenPump
                ? pumpLabel(chosenPump)
                : ''}
          </WizardSummaryRow>
          <WizardSummaryRow label="Nozzle" onChange={() => wizard.change('nozzle')}>
            {add.nozzleNumber.trim()} ({fuelName})
          </WizardSummaryRow>
          <WizardSummaryRow label="Meter" onChange={() => wizard.change('meter')}>
            {add.meter.trim()}
          </WizardSummaryRow>
          <WizardSummaryRow label="Fitted" onChange={() => wizard.change('when')}>
            {add.since === 'earlier' ? add.sinceDate : 'Today'}
          </WizardSummaryRow>
        </WizardSummary>
        <WizardActions
          wizard={wizard}
          continueLabel="Add the nozzle"
          onContinue={() => {
            onStage(planAddNozzle({ ...where, productId, answers: add }));
            wizard.go('done');
          }}
        />
      </WizardStep>
    );
  }

  /* --------------------------- change the numbers --------------------------- */
  if (wizard.step === 'pickPump') {
    return (
      <WizardStep wizard={shown} title="Which pump do you want to change?">
        <WizardOptions<string>
          label="Pump"
          name="renumber-pump"
          value={renumber.pumpId}
          onPick={(id) => {
            const pump = pumpOf(id);
            if (pump) {
              setRenumber(
                renumberFrom(
                  pump,
                  own.filter((n) => n.pumpId === id),
                ),
              );
            }
          }}
          options={ownPumps.map((pump) => ({
            value: pump.id,
            label: pumpLabel(pump),
            detail: own
              .filter((n) => n.pumpId === pump.id)
              .map((n) => `nozzle ${n.number}`)
              .join(', '),
          }))}
        />
        {errors.pickPump ? (
          <p className="field-error" role="alert">
            {errors.pickPump}
          </p>
        ) : null}
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            renumber.pumpId
              ? wizard.go('numbers')
              : wizard.setErrors({ pickPump: 'Choose a pump.' })
          }
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'numbers') {
    const pump = pumpOf(renumber.pumpId);
    const mine = own.filter((n) => n.pumpId === renumber.pumpId);
    return (
      <WizardStep wizard={shown} title={pump ? `Change ${pumpLabel(pump)}` : 'Change the pump'}>
        <Field id="pumpNumber" label="Pump number" error={errors.pumpNumber} required>
          <input
            id="pumpNumber"
            value={renumber.pumpNumber}
            maxLength={MAX_NUMBER}
            autoComplete="off"
            onChange={(event) => setR({ pumpNumber: event.target.value })}
          />
        </Field>
        <Field
          id="pumpName"
          label="Pump name"
          hint="Optional, for example Island 1."
          error={errors.pumpName}
          optional
        >
          <input
            id="pumpName"
            value={renumber.pumpName}
            maxLength={MAX_PUMP_NAME}
            autoComplete="off"
            onChange={(event) => setR({ pumpName: event.target.value })}
          />
        </Field>
        {mine.map((n) => (
          <Field
            key={n.id}
            id={`nozzle-${n.id}`}
            label={`Nozzle number (${fuelName})`}
            hint="The fuel and meter of a nozzle cannot be changed because sales use them."
            error={errors[`nozzle-${n.id}`]}
            required
          >
            <input
              id={`nozzle-${n.id}`}
              value={renumber.nozzles[n.id] ?? ''}
              maxLength={MAX_NUMBER}
              autoComplete="off"
              onChange={(event) =>
                setR({ nozzles: { ...renumber.nozzles, [n.id]: event.target.value } })
              }
            />
          </Field>
        ))}
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            wizard.advance(
              checkRenumber(
                renumber,
                pumps.filter((p) => p.id !== renumber.pumpId).map((p) => p.number),
              ),
              'reviewNumbers',
              'reviewNumbers',
            )
          }
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'reviewNumbers') {
    const pump = pumpOf(renumber.pumpId);
    const mine = own.filter((n) => n.pumpId === renumber.pumpId);
    const unchanged = pump ? renumberIsUnchanged({ pump, nozzles: mine, answers: renumber }) : true;
    return (
      <WizardStep
        wizard={shown}
        title={pump ? `Check the changes to ${pumpLabel(pump)}` : 'Check the changes'}
        hint={WIZARD_REVIEW_HINT}
      >
        {unchanged ? (
          <WizardNotice>Nothing is different from what the pump has now.</WizardNotice>
        ) : (
          <WizardSummary>
            <WizardSummaryRow label="Pump" onChange={() => wizard.change('numbers')}>
              {pumpLabel({
                number: renumber.pumpNumber.trim(),
                name: renumber.pumpName.trim() || null,
              })}
            </WizardSummaryRow>
            {mine.map((n) => (
              <WizardSummaryRow
                key={n.id}
                label={`Nozzle ${n.number}`}
                onChange={() => wizard.change('numbers')}
              >
                {(renumber.nozzles[n.id] ?? '').trim() === n.number
                  ? 'Stays the same'
                  : `Becomes ${(renumber.nozzles[n.id] ?? '').trim()}`}
              </WizardSummaryRow>
            ))}
          </WizardSummary>
        )}
        <WizardActions
          wizard={wizard}
          continueLabel={unchanged ? 'Done' : 'Save changes'}
          onContinue={() => {
            if (pump && !unchanged) {
              onStage(planRenumber({ ...where, pump, nozzles: mine, answers: renumber }));
            }
            wizard.go('done');
          }}
        />
      </WizardStep>
    );
  }

  /* --------------------- when a meter started working --------------------- */
  if (wizard.step === 'pickNozzle') {
    return (
      <WizardStep wizard={shown} title="Which nozzle's meter do you want to correct?">
        <WizardOptions<string>
          label="Nozzle"
          name="since-nozzle"
          value={since.nozzleId}
          onPick={(nozzleId) => setSince({ ...since, nozzleId })}
          options={editable.map((n) => ({
            value: n.id,
            label: nozzleLabel(n),
            detail: `Meter working since ${describeMeterWorkingSince(n.meterWorkingSince)}`,
          }))}
        />
        {errors.nozzle ? (
          <p className="field-error" role="alert">
            {errors.nozzle}
          </p>
        ) : null}
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkSincePick(since), 'date')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'date') {
    return (
      <WizardStep
        wizard={shown}
        title="Which day was the meter fitted?"
        hint="A shift cannot be closed for a nozzle whose meter started working after the shift opened. You can only move the date earlier, and only until readings are recorded."
      >
        <Field id="date" label="The day it was fitted" error={errors.date} required>
          <input
            id="date"
            type="date"
            value={since.date}
            onChange={(event) => setSince({ ...since, date: event.target.value })}
          />
        </Field>
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkSinceDate(since), 'reviewSince', 'reviewSince')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'reviewSince') {
    const nozzle = own.find((n) => n.id === since.nozzleId);
    return (
      <WizardStep wizard={shown} title="Check the new day" hint={WIZARD_REVIEW_HINT}>
        <WizardSummary>
          <WizardSummaryRow label="Nozzle">{nozzle ? nozzleLabel(nozzle) : ''}</WizardSummaryRow>
          <WizardSummaryRow label="Now">
            {describeMeterWorkingSince(nozzle?.meterWorkingSince ?? null)}
          </WizardSummaryRow>
          <WizardSummaryRow label="New day" onChange={() => wizard.change('date')}>
            {since.date}
          </WizardSummaryRow>
        </WizardSummary>
        <WizardActions
          wizard={wizard}
          continueLabel="Use this day"
          onContinue={() => {
            onStage(planSince({ ...where, answers: since }));
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
