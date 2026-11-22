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
import {
  BLEND_PERCENTS,
  PRODUCT_KINDS,
  PRODUCT_KIND_LABELS,
} from '@/platform/domain/product-order';

import type { SetupProduct, SetupShiftTemplate, SetupSupervisor } from '../contracts';
import { describeFuelKind, unitLabel, type FuelUnitChoice } from '../guided-setup';
import {
  BLANK_FUEL,
  BLANK_SHIFT,
  MAX_FUEL_NAME,
  MAX_SHIFT_NAME,
  addFuelSteps,
  afterKindPick,
  checkBlendPick,
  checkFuelName,
  checkInChargePick,
  checkKindPick,
  checkShiftName,
  checkShiftPick,
  checkShiftTimes,
  checkUnitPick,
  describeShiftTimes,
  fuelEditFrom,
  fuelEditSteps,
  fuelFlowsFor,
  planAddFuel,
  planFuelEdit,
  planInCharge,
  planShift,
  shiftFrom,
  shiftIsUnchanged,
  shiftSteps,
  type AddFuelAnswers,
  type AddFuelStep,
  type FuelEditAnswers,
  type FuelEditStep,
  type FuelFlow,
  type PlannedCommand,
  type ShiftAnswers,
  type ShiftFlow,
  type ShiftStep,
} from '../station-wizards';

const KIND_OPTIONS = PRODUCT_KINDS.map((value) => ({
  value,
  label: PRODUCT_KIND_LABELS[value],
}));
const UNIT_OPTIONS = (['LITRES', 'KILOGRAMS'] as const).map((value) => ({
  value,
  label: unitLabel(value),
}));

const FieldError = ({ text }: { text?: string }) =>
  text ? (
    <p className="field-error" role="alert">
      {text}
    </p>
  ) : null;

/* ================================ add a fuel ================================ */

/** A new fuel for the station: its type, name and how it is measured, then "add another?". */
export function AddFuelWizard({
  tenantId,
  stationId,
  products,
  onStage,
  onFinish,
  onCancel,
}: {
  tenantId: string;
  stationId: string;
  /** Every fuel the company has, so a name or code is not used twice. */
  products: readonly SetupProduct[];
  onStage: (changes: PlannedCommand[]) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const [answers, setAnswers] = useState<AddFuelAnswers>(BLANK_FUEL);
  const [round, setRound] = useState(0);
  const sequence = addFuelSteps(answers);
  const wizard = useWizard<AddFuelStep | 'done'>({ start: 'kind', sequence, onCancel });
  const alone = { ...wizard, position: 1, total: 0 };
  const errors = wizard.errors;

  const taken = products.map((p) => p.name);
  const set = (patch: Partial<AddFuelAnswers>) => setAnswers((c) => ({ ...c, ...patch }));

  if (wizard.step === 'kind') {
    return (
      <WizardStep wizard={wizard} title="What type of fuel is it?">
        <WizardOptions<string>
          key={round}
          label="Type of fuel"
          name="fuel-kind"
          value={answers.kind}
          onPick={(kind) => setAnswers((c) => afterKindPick(c, kind, null))}
          options={KIND_OPTIONS}
        />
        <FieldError text={errors.kind} />
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            wizard.advance(checkKindPick(answers), answers.kind === 'BLEND' ? 'blend' : 'name')
          }
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'blend') {
    return (
      <WizardStep wizard={wizard} title="How much is the blend?">
        <WizardOptions<string>
          label="Blend"
          name="fuel-blend"
          value={answers.blendPercent}
          onPick={(percent) => setAnswers((c) => afterKindPick(c, 'BLEND', percent))}
          options={BLEND_PERCENTS.map((value) => ({ value: String(value), label: `${value}%` }))}
        />
        <FieldError text={errors.blendPercent} />
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkBlendPick(answers), 'name', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'name') {
    return (
      <WizardStep
        wizard={wizard}
        title="What is the fuel called?"
        hint={answers.kind === 'OTHER' ? 'Type the name of this fuel.' : 'You can change the name.'}
      >
        <Field id="name" label="Fuel name" error={errors.name} required>
          <input
            id="name"
            value={answers.name}
            maxLength={MAX_FUEL_NAME}
            autoComplete="off"
            onChange={(event) => set({ name: event.target.value, nameEdited: true })}
          />
        </Field>
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            wizard.advance(checkFuelName(answers.name, taken, answers.kind), 'unit', 'review')
          }
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'unit') {
    return (
      <WizardStep wizard={wizard} title="How is it measured?">
        <WizardOptions<FuelUnitChoice>
          label="Measured in"
          name="fuel-unit"
          value={answers.unit}
          onPick={(unit) => set({ unit })}
          options={UNIT_OPTIONS}
        />
        <FieldError text={errors.unit} />
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkUnitPick(answers), 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'review') {
    return (
      <WizardStep wizard={wizard} title="Check the new fuel" hint={WIZARD_REVIEW_HINT}>
        <WizardSummary>
          <WizardSummaryRow label="Type" onChange={() => wizard.change('kind')}>
            {describeFuelKind(answers.kind, Number(answers.blendPercent) || null) ?? ''}
          </WizardSummaryRow>
          <WizardSummaryRow label="Name" onChange={() => wizard.change('name')}>
            {answers.name.trim()}
          </WizardSummaryRow>
          <WizardSummaryRow label="Measured in" onChange={() => wizard.change('unit')}>
            {answers.unit ? unitLabel(answers.unit) : ''}
          </WizardSummaryRow>
        </WizardSummary>
        <WizardActions
          wizard={wizard}
          continueLabel="Add the fuel"
          onContinue={() => {
            onStage(
              planAddFuel({
                tenantId,
                stationId,
                answers,
                takenCodes: products.map((p) => p.code),
              }),
            );
            wizard.go('done');
          }}
        />
      </WizardStep>
    );
  }

  return (
    <WizardAnother
      wizard={alone}
      title="Do you want to add another fuel?"
      onYes={() => {
        // The new fuel is only waiting, so its name must not be offered again.
        setAnswers(BLANK_FUEL);
        setRound((n) => n + 1);
        wizard.show('kind');
      }}
      onNo={onFinish}
    />
  );
}

/* ============================ change a fuel itself ============================ */

type EditScreen = 'menu' | 'done' | FuelEditStep;

/**
 * The fuel itself rather than its price, tanks or pumps: its name, type, how it is measured, hiding
 * or showing it, or deleting one that was never used. Ends with "change something else?".
 */
export function FuelEditWizard({
  tenantId,
  stationId,
  product,
  others,
  canDelete,
  startWith,
  canManage,
  onStage,
  onAnother,
  onFinish,
  onCancel,
}: {
  tenantId: string;
  stationId: string;
  product: SetupProduct;
  /** The names of the company's other fuels. */
  others: readonly string[];
  /** True when nothing is recorded against the fuel, so it may be deleted. */
  canDelete: boolean;
  /** Opens straight on one job, e.g. "Show it again" for a hidden fuel. */
  startWith?: FuelFlow;
  canManage: boolean;
  onStage: (changes: PlannedCommand[]) => void;
  onAnother: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const [flow, setFlow] = useState<FuelFlow | null>(startWith ?? null);
  const [pick, setPick] = useState<FuelFlow | null>(null);
  const [answers, setAnswers] = useState<FuelEditAnswers>(fuelEditFrom(product));
  const sequence = flow ? fuelEditSteps(flow, answers) : [];
  const wizard = useWizard<EditScreen>({
    start: startWith ? 'review' : 'menu',
    sequence,
    onCancel,
  });
  const shown = { ...wizard, total: sequence.length };
  const alone = { ...wizard, position: 1, total: 0 };
  const errors = wizard.errors;
  const set = (patch: Partial<FuelEditAnswers>) => setAnswers((c) => ({ ...c, ...patch }));
  const first = (choice: FuelFlow): FuelEditStep => fuelEditSteps(choice, answers)[0]!;

  if (!canManage) {
    return (
      <WizardStep wizard={alone} title="You cannot change this fuel">
        <WizardNotice>
          Changing a fuel needs the right to set up the station. Ask the owner or a manager.
        </WizardNotice>
      </WizardStep>
    );
  }

  if (wizard.step === 'menu') {
    return (
      <WizardStep wizard={alone} title={`What do you want to change about ${product.name}?`}>
        <WizardOptions<FuelFlow>
          label="What to change"
          name="fuel-edit"
          value={pick}
          onPick={setPick}
          options={fuelFlowsFor(product, canDelete)}
        />
        <FieldError text={errors.menu} />
        <WizardActions
          wizard={wizard}
          onContinue={() => {
            if (!pick) return wizard.setErrors({ menu: 'Choose what to change.' });
            setFlow(pick);
            wizard.go(first(pick));
          }}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'name') {
    return (
      <WizardStep wizard={shown} title="What is the fuel called now?">
        <Field
          id="name"
          label="Fuel name"
          hint="The new name shows at every station of the company."
          error={errors.name}
          required
        >
          <input
            id="name"
            value={answers.name}
            maxLength={MAX_FUEL_NAME}
            autoComplete="off"
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            wizard.advance(checkFuelName(answers.name, others, answers.kind), 'review', 'review')
          }
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'kind') {
    return (
      <WizardStep wizard={shown} title={`What type of fuel is ${product.name}?`}>
        <WizardOptions<string>
          label="Type of fuel"
          name="fuel-kind"
          value={answers.kind}
          onPick={(kind) =>
            set({ kind, blendPercent: kind === 'BLEND' ? answers.blendPercent : null })
          }
          options={KIND_OPTIONS}
        />
        <FieldError text={errors.kind} />
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            wizard.advance(
              checkKindPick(answers),
              answers.kind === 'BLEND' ? 'blend' : 'review',
              'review',
            )
          }
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'blend') {
    return (
      <WizardStep wizard={shown} title="How much is the blend?">
        <WizardOptions<string>
          label="Blend"
          name="fuel-blend"
          value={answers.blendPercent}
          onPick={(blendPercent) => set({ blendPercent })}
          options={BLEND_PERCENTS.map((value) => ({ value: String(value), label: `${value}%` }))}
        />
        <FieldError text={errors.blendPercent} />
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkBlendPick(answers), 'review', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'unit') {
    return (
      <WizardStep
        wizard={shown}
        title={`How is ${product.name} measured?`}
        hint="This can only be changed before the fuel has deliveries or sales recorded."
      >
        <WizardOptions<FuelUnitChoice>
          label="Measured in"
          name="fuel-unit"
          value={answers.unit}
          onPick={(unit) => set({ unit })}
          options={UNIT_OPTIONS}
        />
        <FieldError text={errors.unit} />
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkUnitPick(answers), 'review', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'review' && flow) {
    const now = fuelEditFrom(product);
    const hiding = product.status === 'ACTIVE';
    const title =
      flow === 'delete'
        ? `Delete ${product.name}?`
        : flow === 'visibility'
          ? hiding
            ? `Hide ${product.name}?`
            : `Show ${product.name} again?`
          : 'Check the change';
    return (
      <WizardStep wizard={shown} title={title} hint={WIZARD_REVIEW_HINT}>
        {flow === 'rename' ? (
          <WizardSummary>
            <WizardSummaryRow label="Now">{now.name}</WizardSummaryRow>
            <WizardSummaryRow label="New name" onChange={() => wizard.change('name')}>
              {answers.name.trim()}
            </WizardSummaryRow>
          </WizardSummary>
        ) : null}
        {flow === 'type' ? (
          <WizardSummary>
            <WizardSummaryRow label="Now">
              {describeFuelKind(now.kind, Number(now.blendPercent) || null) ?? 'No type yet'}
            </WizardSummaryRow>
            <WizardSummaryRow label="New type" onChange={() => wizard.change('kind')}>
              {describeFuelKind(answers.kind, Number(answers.blendPercent) || null) ?? ''}
            </WizardSummaryRow>
          </WizardSummary>
        ) : null}
        {flow === 'unit' ? (
          <WizardSummary>
            <WizardSummaryRow label="Now">{unitLabel(now.unit ?? 'LITRES')}</WizardSummaryRow>
            <WizardSummaryRow label="New" onChange={() => wizard.change('unit')}>
              {answers.unit ? unitLabel(answers.unit) : ''}
            </WizardSummaryRow>
          </WizardSummary>
        ) : null}
        {flow === 'visibility' ? (
          <WizardNotice>
            {hiding
              ? `${product.name} will no longer be offered for sale. Nothing recorded for it is lost, and you can show it again later.`
              : `${product.name} will be offered for sale again.`}
          </WizardNotice>
        ) : null}
        {flow === 'delete' ? (
          <WizardNotice>
            This cannot be undone. A fuel that already has tanks, nozzles, prices or sales cannot be
            deleted. Hide it instead.
          </WizardNotice>
        ) : null}
        <WizardActions
          wizard={wizard}
          continueLabel={
            flow === 'delete'
              ? 'Delete the fuel'
              : flow === 'visibility'
                ? hiding
                  ? 'Hide the fuel'
                  : 'Show the fuel'
                : 'Save changes'
          }
          onContinue={() => {
            onStage(planFuelEdit({ tenantId, stationId, product, flow, answers }));
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

/* ================================== shifts ================================== */

type ShiftScreen = 'menu' | 'done' | ShiftStep;

/** Add, change or remove a shift, one question at a time, then "change something else?". */
export function ShiftsWizard({
  tenantId,
  stationId,
  shifts,
  canManage,
  onStage,
  onAnother,
  onFinish,
  onCancel,
}: {
  tenantId: string;
  stationId: string;
  /** The shifts the station runs now (active ones). */
  shifts: readonly SetupShiftTemplate[];
  canManage: boolean;
  onStage: (changes: PlannedCommand[]) => void;
  onAnother: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const [flow, setFlow] = useState<ShiftFlow | null>(null);
  const [pick, setPick] = useState<ShiftFlow | null>(null);
  const [answers, setAnswers] = useState<ShiftAnswers>(BLANK_SHIFT);
  const sequence = flow ? shiftSteps(flow) : [];
  const wizard = useWizard<ShiftScreen>({ start: 'menu', sequence, onCancel });
  const shown = { ...wizard, total: sequence.length };
  const alone = { ...wizard, position: 1, total: 0 };
  const errors = wizard.errors;
  const set = (patch: Partial<ShiftAnswers>) => setAnswers((c) => ({ ...c, ...patch }));
  const chosen = shifts.find((s) => s.id === answers.shiftId);
  const otherNames = shifts.filter((s) => s.id !== answers.shiftId).map((s) => s.name);

  if (!canManage) {
    return (
      <WizardStep wizard={alone} title="You cannot change shifts">
        <WizardNotice>
          Changing shifts needs the right to set up the station. Ask the owner or a manager.
        </WizardNotice>
      </WizardStep>
    );
  }

  if (wizard.step === 'menu') {
    return (
      <WizardStep wizard={alone} title="What do you want to do with the shifts?">
        <WizardOptions<ShiftFlow>
          label="What to do"
          name="shift-flow"
          value={pick}
          onPick={setPick}
          options={[
            { value: 'add', label: 'Add a shift', detail: 'For example a night shift' },
            ...(shifts.length > 0
              ? [
                  {
                    value: 'change' as const,
                    label: 'Change a shift',
                    detail: 'Its name or the times it runs',
                  },
                  {
                    value: 'remove' as const,
                    label: 'Remove a shift',
                    detail: 'Shifts already worked are not changed',
                  },
                ]
              : []),
          ]}
        />
        <FieldError text={errors.menu} />
        <WizardActions
          wizard={wizard}
          onContinue={() => {
            if (!pick) return wizard.setErrors({ menu: 'Choose what to do.' });
            setFlow(pick);
            setAnswers(BLANK_SHIFT);
            wizard.go(shiftSteps(pick)[0]!);
          }}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'pick') {
    return (
      <WizardStep
        wizard={shown}
        title={
          flow === 'remove'
            ? 'Which shift do you want to remove?'
            : 'Which shift do you want to change?'
        }
      >
        <WizardOptions<string>
          label="Shift"
          name="shift-pick"
          value={answers.shiftId}
          onPick={(id) => {
            const shift = shifts.find((s) => s.id === id);
            if (shift) setAnswers(shiftFrom(shift));
          }}
          options={shifts.map((shift) => ({
            value: shift.id,
            label: shift.name,
            detail: describeShiftTimes(shiftFrom(shift)),
          }))}
        />
        <FieldError text={errors.shift} />
        <WizardActions
          wizard={wizard}
          onContinue={() =>
            wizard.advance(checkShiftPick(answers), flow === 'remove' ? 'review' : 'name')
          }
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'name') {
    return (
      <WizardStep wizard={shown} title="What is the shift called?">
        <Field id="name" label="Shift name" error={errors.name} required>
          <input
            id="name"
            value={answers.name}
            maxLength={MAX_SHIFT_NAME}
            autoComplete="off"
            placeholder="Day shift"
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkShiftName(answers, otherNames), 'times', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'times') {
    return (
      <WizardStep
        wizard={shown}
        title="When does the shift run?"
        hint="An end time before the start time means the shift ends the next day."
      >
        <Field id="start" label="Starts at" error={errors.start} required>
          <input
            id="start"
            type="time"
            value={answers.start}
            onChange={(event) => set({ start: event.target.value })}
          />
        </Field>
        <Field id="end" label="Ends at" error={errors.end} required>
          <input
            id="end"
            type="time"
            value={answers.end}
            onChange={(event) => set({ end: event.target.value })}
          />
        </Field>
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkShiftTimes(answers), 'review', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'review' && flow) {
    const unchanged = flow === 'change' && chosen ? shiftIsUnchanged(chosen, answers) : false;
    return (
      <WizardStep
        wizard={shown}
        title={flow === 'remove' ? `Remove ${chosen?.name ?? 'this shift'}?` : 'Check the shift'}
        hint={WIZARD_REVIEW_HINT}
      >
        {flow === 'remove' ? (
          <WizardNotice>
            {chosen?.name} will no longer be offered when planning shifts. Shifts already worked are
            not changed.
          </WizardNotice>
        ) : unchanged ? (
          <WizardNotice>Nothing is different from what the shift is now.</WizardNotice>
        ) : (
          <WizardSummary>
            <WizardSummaryRow label="Name" onChange={() => wizard.change('name')}>
              {answers.name.trim()}
            </WizardSummaryRow>
            <WizardSummaryRow label="Runs" onChange={() => wizard.change('times')}>
              {describeShiftTimes(answers)}
            </WizardSummaryRow>
          </WizardSummary>
        )}
        <WizardActions
          wizard={wizard}
          continueLabel={
            unchanged
              ? 'Done'
              : flow === 'remove'
                ? 'Remove the shift'
                : flow === 'add'
                  ? 'Add the shift'
                  : 'Save changes'
          }
          onContinue={() => {
            if (!unchanged) {
              onStage(planShift({ tenantId, stationId, flow, answers, shifts }));
            }
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

/* ============================== who is in charge ============================== */

type ChargeScreen = 'pick' | 'review' | 'done';

/** Choose the supervisor in charge of the station. With nobody to choose, it points to Staff. */
export function InChargeWizard({
  tenantId,
  stationId,
  supervisors,
  currentId,
  canManage,
  onOpenStaff,
  onStage,
  onFinish,
  onCancel,
}: {
  tenantId: string;
  stationId: string;
  supervisors: readonly SetupSupervisor[];
  currentId: string | null;
  canManage: boolean;
  /** Takes the person to Staff, to give someone the supervisor role at this station. */
  onOpenStaff?: () => void;
  onStage: (changes: PlannedCommand[]) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<string | null>(currentId);
  const sequence: readonly ChargeScreen[] = ['pick', 'review'];
  const wizard = useWizard<ChargeScreen>({ start: 'pick', sequence, onCancel });
  const alone = { ...wizard, position: 1, total: 0 };
  const errors = wizard.errors;
  const chosen = supervisors.find((s) => s.membershipId === choice);

  if (!canManage) {
    return (
      <WizardStep wizard={alone} title="You cannot change who is in charge">
        <WizardNotice>
          This needs the right to set up the station. Ask the owner or a manager.
        </WizardNotice>
      </WizardStep>
    );
  }

  if (supervisors.length === 0) {
    return (
      <WizardStep wizard={alone} title="Nobody can be put in charge yet">
        <WizardNotice>
          Only a supervisor assigned to this station can be in charge. Give someone the supervisor
          role for this station in Staff, then come back.
        </WizardNotice>
        <WizardActions
          wizard={wizard}
          continueLabel={onOpenStaff ? 'Go to Staff' : 'Close'}
          onContinue={() => (onOpenStaff ? onOpenStaff() : onCancel())}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'pick') {
    return (
      <WizardStep wizard={wizard} title="Who is in charge of this station?">
        <WizardOptions<string>
          label="Who is in charge"
          name="in-charge"
          value={choice}
          onPick={setChoice}
          options={supervisors.map((s) => ({
            value: s.membershipId,
            label: s.name,
            detail: s.membershipId === currentId ? 'In charge now' : undefined,
          }))}
        />
        <FieldError text={errors.supervisor} />
        <WizardActions
          wizard={wizard}
          onContinue={() => wizard.advance(checkInChargePick(choice), 'review', 'review')}
        />
      </WizardStep>
    );
  }

  if (wizard.step === 'review') {
    const unchanged = choice === currentId;
    return (
      <WizardStep wizard={wizard} title="Check who is in charge" hint={WIZARD_REVIEW_HINT}>
        {unchanged ? (
          <WizardNotice>{chosen?.name} is already in charge of this station.</WizardNotice>
        ) : (
          <WizardSummary>
            <WizardSummaryRow label="In charge" onChange={() => wizard.change('pick')}>
              {chosen?.name ?? ''}
            </WizardSummaryRow>
          </WizardSummary>
        )}
        <WizardActions
          wizard={wizard}
          continueLabel={unchanged ? 'Done' : 'Save the choice'}
          onContinue={() => {
            if (!unchanged && choice) {
              onStage(planInCharge({ tenantId, stationId, membershipId: choice }));
            }
            onFinish();
          }}
        />
      </WizardStep>
    );
  }

  return null;
}
