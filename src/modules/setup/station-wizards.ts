import {
  BLEND_PERCENTS,
  PRODUCT_KINDS,
  suggestedFuelName,
  type ProductKind,
} from '@/platform/domain/product-order';

import {
  defaultUnitForKind,
  endTimeFrom,
  minutesBetween,
  suggestCode,
  validateFuelKind,
  type FuelUnitChoice,
} from './guided-setup';
import type { SetupProduct, SetupShiftTemplate } from './contracts';

/**
 * The rules of the station-level wizards (#250): add a fuel, change a fuel itself (name, type,
 * unit, hidden or shown, delete), the shifts, and who is in charge. One question per screen. Pure,
 * so the screens only draw what these decide. Nothing is saved here: every plan is a list of
 * commands that joins the page's list of waiting changes.
 */
export type PlannedCommand = { url: string; body: Record<string, unknown> };

type Errors = Record<string, string>;
const SETUP = '/api/setup/commands';
const FORECOURT = '/api/forecourt/commands';

export const MAX_FUEL_NAME = 120;
export const MAX_SHIFT_NAME = 80;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/* ------------------------------- fuel names ------------------------------- */

/** The name of a fuel: needed, short enough, and not another fuel's name. */
export function checkFuelName(
  name: string,
  others: readonly string[],
  kind?: string | null,
): Errors {
  const value = name.trim();
  if (!value) {
    return {
      name:
        kind === 'OTHER'
          ? 'Enter the name of the fuel, for example Paraffin.'
          : 'Enter the name of the fuel, for example Diesel.',
    };
  }
  if (value.length > MAX_FUEL_NAME) return { name: `Use at most ${MAX_FUEL_NAME} letters.` };
  if (others.some((other) => same(other, value))) {
    return { name: 'Another fuel already has this name.' };
  }
  return {};
}

/* ------------------------------- add a fuel ------------------------------- */

export type AddFuelStep = 'kind' | 'blend' | 'name' | 'unit' | 'review';

export type AddFuelAnswers = {
  kind: string | null;
  blendPercent: string | null;
  name: string;
  /** Once the person types their own name, the suggestion stops replacing it. */
  nameEdited: boolean;
  unit: FuelUnitChoice | null;
};

export const BLANK_FUEL: AddFuelAnswers = {
  kind: null,
  blendPercent: null,
  name: '',
  nameEdited: false,
  unit: null,
};

export function addFuelSteps(answers: AddFuelAnswers): readonly AddFuelStep[] {
  return answers.kind === 'BLEND'
    ? ['kind', 'blend', 'name', 'unit', 'review']
    : ['kind', 'name', 'unit', 'review'];
}

export function checkKindPick(answers: { kind: string | null }): Errors {
  return (PRODUCT_KINDS as readonly string[]).includes(answers.kind ?? '')
    ? {}
    : { kind: 'Choose the type of fuel.' };
}

export function checkBlendPick(answers: { blendPercent: string | null }): Errors {
  return (BLEND_PERCENTS as readonly number[]).includes(Number(answers.blendPercent))
    ? {}
    : { blendPercent: 'Choose the blend: 5%, 10%, 15% or 20%.' };
}

/** Picking a type fills in a name and unit the person may keep or change. */
export function afterKindPick(
  answers: AddFuelAnswers,
  kind: string,
  blendPercent: string | null,
): AddFuelAnswers {
  const isKind = (PRODUCT_KINDS as readonly string[]).includes(kind);
  return {
    ...answers,
    kind,
    blendPercent: kind === 'BLEND' ? blendPercent : null,
    unit: defaultUnitForKind(kind),
    name:
      answers.nameEdited || !isKind
        ? answers.name
        : suggestedFuelName(kind as ProductKind, Number(blendPercent) || null),
  };
}

export const checkUnitPick = (answers: { unit: FuelUnitChoice | null }): Errors =>
  answers.unit ? {} : { unit: 'Choose how this fuel is measured.' };

export function planAddFuel(input: {
  tenantId: string;
  stationId: string;
  answers: AddFuelAnswers;
  takenCodes: readonly string[];
}): PlannedCommand[] {
  const { answers } = input;
  const checked = validateFuelKind({
    kind: answers.kind ?? '',
    blendPercent: answers.blendPercent ?? '',
  });
  if (!checked.ok) return [];
  const name = answers.name.trim();
  return [
    {
      url: SETUP,
      body: {
        commandType: 'CreateProduct',
        tenantId: input.tenantId,
        stationId: input.stationId,
        code: suggestCode(name, input.takenCodes),
        name,
        kind: checked.value.kind,
        blendPercent: checked.value.blendPercent,
        unit: answers.unit ?? 'LITRES',
      },
    },
  ];
}

/* ------------------------- change a fuel itself ------------------------- */

export type FuelFlow = 'rename' | 'type' | 'unit' | 'visibility' | 'delete';
export type FuelEditStep = 'name' | 'kind' | 'blend' | 'unit' | 'review';

export type FuelEditAnswers = {
  name: string;
  kind: string | null;
  blendPercent: string | null;
  unit: FuelUnitChoice | null;
};

export function fuelEditFrom(
  product: Pick<SetupProduct, 'name' | 'kind' | 'blendPercent' | 'unit'>,
) {
  return {
    name: product.name,
    kind: product.kind ?? null,
    blendPercent: product.blendPercent ? String(product.blendPercent) : null,
    unit: product.unit === 'KILOGRAMS' ? 'KILOGRAMS' : 'LITRES',
  } satisfies FuelEditAnswers;
}

export function fuelEditSteps(flow: FuelFlow, answers: FuelEditAnswers): readonly FuelEditStep[] {
  switch (flow) {
    case 'rename':
      return ['name', 'review'];
    case 'type':
      return answers.kind === 'BLEND' ? ['kind', 'blend', 'review'] : ['kind', 'review'];
    case 'unit':
      return ['unit', 'review'];
    default:
      return ['review'];
  }
}

/** What can be done to this fuel, in the order they are offered. */
export function fuelFlowsFor(
  product: Pick<SetupProduct, 'status'>,
  canDelete: boolean,
): { value: FuelFlow; label: string; detail: string }[] {
  const shown = product.status === 'ACTIVE';
  return [
    { value: 'rename', label: 'Rename it', detail: 'The new name shows at every station' },
    { value: 'type', label: 'Change the type of fuel', detail: 'Petrol, diesel, blend or gas' },
    { value: 'unit', label: 'Change how it is measured', detail: 'Litres or kilograms' },
    {
      value: 'visibility',
      label: shown ? 'Hide it' : 'Show it again',
      detail: shown ? 'It is no longer offered for sale' : 'It is offered for sale again',
    },
    ...(canDelete
      ? [
          {
            value: 'delete' as const,
            label: 'Delete it',
            detail: 'Only a fuel with no tanks, nozzles, prices or sales',
          },
        ]
      : []),
  ];
}

export function planFuelEdit(input: {
  tenantId: string;
  stationId: string;
  product: Pick<SetupProduct, 'id'> & { status: string };
  flow: FuelFlow;
  answers: FuelEditAnswers;
}): PlannedCommand[] {
  const base = {
    tenantId: input.tenantId,
    stationId: input.stationId,
    productId: input.product.id,
  };
  const { answers } = input;
  switch (input.flow) {
    case 'rename':
      return [
        { url: SETUP, body: { commandType: 'RenameProduct', ...base, name: answers.name.trim() } },
      ];
    case 'type': {
      const checked = validateFuelKind({
        kind: answers.kind ?? '',
        blendPercent: answers.blendPercent ?? '',
      });
      return checked.ok
        ? [
            {
              url: SETUP,
              body: {
                commandType: 'SetProductKind',
                ...base,
                kind: checked.value.kind,
                blendPercent: checked.value.blendPercent,
              },
            },
          ]
        : [];
    }
    case 'unit':
      return [
        {
          url: SETUP,
          body: { commandType: 'SetProductUnit', ...base, unit: answers.unit ?? 'LITRES' },
        },
      ];
    case 'visibility':
      return [
        {
          url: SETUP,
          body: {
            commandType: 'SetProductStatus',
            ...base,
            status: input.product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
          },
        },
      ];
    case 'delete':
      return [{ url: SETUP, body: { commandType: 'DeleteProduct', ...base } }];
  }
}

/* --------------------------------- shifts --------------------------------- */

export type ShiftFlow = 'add' | 'change' | 'remove';
export type ShiftStep = 'pick' | 'name' | 'times' | 'review';

export type ShiftAnswers = {
  /** The shift being changed or removed; null when adding. */
  shiftId: string | null;
  name: string;
  /** `HH:MM`. */
  start: string;
  end: string;
};

export const BLANK_SHIFT: ShiftAnswers = { shiftId: null, name: '', start: '', end: '' };

export function shiftSteps(flow: ShiftFlow): readonly ShiftStep[] {
  return flow === 'add'
    ? ['name', 'times', 'review']
    : flow === 'change'
      ? ['pick', 'name', 'times', 'review']
      : ['pick', 'review'];
}

export function shiftFrom(shift: SetupShiftTemplate): ShiftAnswers {
  return {
    shiftId: shift.id,
    name: shift.name,
    start: shift.startTime?.slice(0, 5) ?? '',
    end: endTimeFrom(shift.startTime ?? '', shift.durationMinutes),
  };
}

export const checkShiftPick = (answers: ShiftAnswers): Errors =>
  answers.shiftId ? {} : { shift: 'Choose a shift.' };

export function checkShiftName(answers: ShiftAnswers, others: readonly string[]): Errors {
  const name = answers.name.trim();
  if (!name) return { name: 'Give the shift a name, for example Day shift.' };
  if (name.length > MAX_SHIFT_NAME) return { name: `Use at most ${MAX_SHIFT_NAME} letters.` };
  if (others.some((other) => same(other, name))) {
    return { name: 'Another shift already has this name.' };
  }
  return {};
}

export function checkShiftTimes(answers: ShiftAnswers): Errors {
  const errors: Errors = {};
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(answers.start)) errors.start = 'Choose the start time.';
  if (!minutesBetween(answers.start, answers.end)) {
    errors.end = 'Choose an end time that is different from the start time.';
  }
  return errors;
}

/** How long a shift runs, in plain words, e.g. "12 hours", noting when it ends the next day. */
export function describeShiftTimes(answers: Pick<ShiftAnswers, 'start' | 'end'>): string {
  const minutes = minutesBetween(answers.start, answers.end);
  if (!minutes) return '';
  const nextDay = answers.end <= answers.start ? ' (ends the next day)' : '';
  return `${answers.start} to ${answers.end}${nextDay}`;
}

export function planShift(input: {
  tenantId: string;
  stationId: string;
  flow: ShiftFlow;
  answers: ShiftAnswers;
  shifts: readonly SetupShiftTemplate[];
  /** Makes the id of a new shift; a parameter so tests stay steady. */
  newId?: () => string;
}): PlannedCommand[] {
  const { answers, flow } = input;
  const base = { tenantId: input.tenantId, stationId: input.stationId };
  if (flow === 'add') {
    const minutes = minutesBetween(answers.start, answers.end);
    if (!minutes) return [];
    return [
      {
        url: FORECOURT,
        body: {
          commandType: 'DefineShiftTemplate',
          ...base,
          shiftTemplateId: (input.newId ?? (() => crypto.randomUUID()))(),
          expectedVersion: 0,
          code: suggestCode(
            answers.name.trim(),
            input.shifts.map((s) => s.code),
          ),
          name: answers.name.trim(),
          startTime: answers.start,
          durationMinutes: minutes,
          active: true,
        },
      },
    ];
  }
  const shift = input.shifts.find((s) => s.id === answers.shiftId);
  if (!shift) return [];
  if (flow === 'remove') {
    return [
      {
        url: FORECOURT,
        body: {
          commandType: 'DefineShiftTemplate',
          ...base,
          shiftTemplateId: shift.id,
          expectedVersion: shift.version,
          code: shift.code,
          name: shift.name,
          startTime: shift.startTime?.slice(0, 5),
          durationMinutes: shift.durationMinutes,
          active: false,
        },
      },
    ];
  }
  const minutes = minutesBetween(answers.start, answers.end);
  if (!minutes) return [];
  return [
    {
      url: FORECOURT,
      body: {
        commandType: 'DefineShiftTemplate',
        ...base,
        shiftTemplateId: shift.id,
        expectedVersion: shift.version,
        code: shift.code,
        name: answers.name.trim(),
        startTime: answers.start,
        durationMinutes: minutes,
        active: true,
      },
    },
  ];
}

/** True when the answers are exactly what the shift already is, so nothing needs saving. */
export function shiftIsUnchanged(shift: SetupShiftTemplate, answers: ShiftAnswers): boolean {
  const now = shiftFrom(shift);
  return now.name === answers.name.trim() && now.start === answers.start && now.end === answers.end;
}

/* ------------------------------ who is in charge ------------------------------ */

export const checkInChargePick = (membershipId: string | null): Errors =>
  membershipId ? {} : { supervisor: 'Choose who is in charge of this station.' };

export function planInCharge(input: {
  tenantId: string;
  stationId: string;
  membershipId: string;
}): PlannedCommand[] {
  return [
    {
      url: SETUP,
      body: {
        commandType: 'SetResponsibleSupervisor',
        tenantId: input.tenantId,
        stationId: input.stationId,
        membershipId: input.membershipId,
      },
    },
  ];
}
