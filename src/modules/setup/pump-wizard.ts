import { planNozzleRenumbering } from './nozzle-renumber';
import { STAND_IN_PREFIX, type StagedChange } from './staged-changes';

/**
 * The rules of the pumps and nozzles wizard (#249, #317): add a pump and then its nozzles, add
 * nozzles to a pump you have, change or remove a pump and its nozzles, or correct the day a meter
 * started working. One question per screen. Pure, so the screen only draws what these decide;
 * nothing is saved here, the changes join the list of waiting changes.
 */
export type PumpFlow = 'addPump' | 'add' | 'renumber' | 'since';

export const NEW_PUMP = 'new';
export const MAX_NUMBER = 16;
export const MAX_PUMP_NAME = 80;
export const MAX_METER = 80;

type Errors = Record<string, string>;

/** One more than the biggest whole number in the list, for suggesting the next pump or nozzle. */
export function nextNumber(existing: readonly string[]): string {
  const biggest = existing.reduce((max, value) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return String(biggest + 1);
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/* ------------------------------ add a nozzle ------------------------------ */

export type AddStep = 'pump' | 'newPump' | 'nozzle' | 'meter' | 'when' | 'review';

export type AddAnswers = {
  /** A pump id, `NEW_PUMP`, or null before the choice. */
  pump: string | null;
  pumpNumber: string;
  pumpName: string;
  nozzleNumber: string;
  meter: string;
  /** Whether the meter was fitted today or on an earlier day. */
  since: 'today' | 'earlier' | null;
  /** `YYYY-MM-DD`, only for "earlier". */
  sinceDate: string;
};

export const BLANK_ADD: AddAnswers = {
  pump: null,
  pumpNumber: '',
  pumpName: '',
  nozzleNumber: '',
  meter: '',
  since: null,
  sinceDate: '',
};

/**
 * The steps that apply to these answers, in order, for "Step 2 of 5". `pickPump` is true when the
 * person is adding nozzles to a pump they already have, so the first question is which one; when
 * adding a new pump it starts with the pump itself (#317).
 */
export function addSteps(answers: AddAnswers, pickPump: boolean): readonly AddStep[] {
  const newPump = !pickPump || answers.pump === NEW_PUMP;
  return [
    ...(pickPump ? (['pump'] as const) : []),
    ...(newPump ? (['newPump'] as const) : []),
    'nozzle',
    'meter',
    'when',
    'review',
  ];
}

export function checkPumpPick(answers: AddAnswers): Errors {
  return answers.pump ? {} : { pump: 'Choose a pump, or add a new one.' };
}

export function checkNewPump(answers: AddAnswers, existingNumbers: readonly string[]): Errors {
  const number = answers.pumpNumber.trim();
  const errors: Errors = {};
  if (!number) errors.pumpNumber = 'Enter the pump number, for example 1.';
  else if (number.length > MAX_NUMBER) {
    errors.pumpNumber = `Keep the number to ${MAX_NUMBER} characters or fewer.`;
  } else if (existingNumbers.some((existing) => same(existing, number))) {
    errors.pumpNumber = `Pump ${number} already exists. Choose a different number.`;
  }
  if (answers.pumpName.trim().length > MAX_PUMP_NAME) {
    errors.pumpName = `Keep the name to ${MAX_PUMP_NAME} characters or fewer.`;
  }
  return errors;
}

/** `numbersOnPump` are the nozzle numbers already on the chosen pump (none for a new pump). */
export function checkNozzleNumber(answers: AddAnswers, numbersOnPump: readonly string[]): Errors {
  const number = answers.nozzleNumber.trim();
  if (!number) return { nozzleNumber: 'Enter the nozzle number, for example 1.' };
  if (number.length > MAX_NUMBER) {
    return { nozzleNumber: `Keep the number to ${MAX_NUMBER} characters or fewer.` };
  }
  if (numbersOnPump.some((existing) => same(existing, number))) {
    return { nozzleNumber: `Nozzle ${number} is already on this pump. Choose a different number.` };
  }
  return {};
}

export function checkMeter(answers: AddAnswers): Errors {
  const meter = answers.meter.trim();
  if (!meter) return { meter: 'Enter the serial number printed on the meter.' };
  if (meter.length > MAX_METER) {
    return { meter: `Keep the serial number to ${MAX_METER} characters or fewer.` };
  }
  return {};
}

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True for a real calendar day written `YYYY-MM-DD`. */
export function isCalendarDay(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function checkWhen(answers: AddAnswers): Errors {
  if (!answers.since) return { since: 'Choose when the meter was fitted.' };
  if (answers.since === 'today') return {};
  return isCalendarDay(answers.sinceDate)
    ? {}
    : { sinceDate: 'Choose the day the meter was fitted.' };
}

/** "Pump 3" or "Pump 3 (Island 1)". */
export function pumpLabel(pump: { number: string; name: string | null }): string {
  return pump.name ? `Pump ${pump.number} (${pump.name})` : `Pump ${pump.number}`;
}

let counter = 0;
const nextId = (): string => `pump-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

/**
 * The waiting changes that add a nozzle: a new pump first when asked for, then the nozzle on it.
 * The nozzle points at the new pump through a stand-in id, which the save swaps for the real one.
 */
export function planAddNozzle(input: {
  tenantId: string;
  stationId: string;
  productId: string;
  answers: AddAnswers;
}): StagedChange[] {
  const { answers } = input;
  const base = { tenantId: input.tenantId, stationId: input.stationId };
  const out: StagedChange[] = [];
  let pumpId = answers.pump ?? '';
  if (answers.pump === NEW_PUMP || !answers.pump) {
    const id = nextId();
    pumpId = `${STAND_IN_PREFIX}${id}`;
    out.push({
      id: `staged-${id}`,
      url: '/api/setup/commands',
      body: {
        commandType: 'CreatePump',
        ...base,
        number: answers.pumpNumber.trim(),
        name: answers.pumpName.trim() || null,
      },
      standIn: pumpId,
    });
  }
  const id = nextId();
  out.push({
    id: `staged-${id}`,
    url: '/api/setup/commands',
    body: {
      commandType: 'CreateNozzle',
      ...base,
      pumpId,
      number: answers.nozzleNumber.trim(),
      productId: input.productId,
      meterSerialNumber: answers.meter.trim(),
      ...(answers.since === 'earlier' ? { meterWorkingSinceDate: answers.sinceDate } : {}),
    },
    standIn: `${STAND_IN_PREFIX}${id}`,
  });
  return out;
}

/* --------------------------- change numbers --------------------------- */

export type RenumberStep =
  | 'pickPump'
  | 'numbers'
  | 'reviewNumbers'
  | 'removePump'
  | 'removeNozzle'
  | 'retirePump'
  | 'retireNozzle';

export type RenumberAnswers = {
  pumpId: string | null;
  pumpNumber: string;
  pumpName: string;
  /** Nozzle id to the number typed for it. */
  nozzles: Record<string, string>;
};

export const BLANK_RENUMBER: RenumberAnswers = {
  pumpId: null,
  pumpNumber: '',
  pumpName: '',
  nozzles: {},
};

export const renumberSteps = (): readonly RenumberStep[] => [
  'pickPump',
  'numbers',
  'reviewNumbers',
];

type PumpLike = { id: string; number: string; name: string | null };
type NozzleLike = { id: string; number: string };

/** Starts from what the pump and its nozzles have now. */
export function renumberFrom(pump: PumpLike, nozzles: readonly NozzleLike[]): RenumberAnswers {
  return {
    pumpId: pump.id,
    pumpNumber: pump.number,
    pumpName: pump.name ?? '',
    nozzles: Object.fromEntries(nozzles.map((n) => [n.id, n.number])),
  };
}

export function checkRenumber(
  answers: RenumberAnswers,
  otherPumpNumbers: readonly string[],
): Errors {
  const errors: Errors = {};
  const number = answers.pumpNumber.trim();
  if (!number) errors.pumpNumber = 'Enter the pump number.';
  else if (number.length > MAX_NUMBER) {
    errors.pumpNumber = `Keep the number to ${MAX_NUMBER} characters or fewer.`;
  } else if (otherPumpNumbers.some((other) => same(other, number))) {
    errors.pumpNumber = `Pump ${number} already exists. Choose a different number.`;
  }
  if (answers.pumpName.trim().length > MAX_PUMP_NAME) {
    errors.pumpName = `Keep the name to ${MAX_PUMP_NAME} characters or fewer.`;
  }
  const entries = Object.entries(answers.nozzles);
  for (const [id, raw] of entries) {
    const value = raw.trim();
    if (!value) errors[`nozzle-${id}`] = 'Enter a number.';
    else if (value.length > MAX_NUMBER) {
      errors[`nozzle-${id}`] = `Keep the number to ${MAX_NUMBER} characters or fewer.`;
    } else if (entries.some(([other, o]) => other !== id && same(o, value))) {
      errors[`nozzle-${id}`] = 'Two nozzles on a pump cannot have the same number.';
    }
  }
  return errors;
}

/**
 * The waiting changes for new numbers: the pump (when its number or name changed), then each nozzle
 * that changed, in an order the database accepts (a swap of 1 and 2 parks one nozzle first). They
 * are added exactly in this order and never merged, or a swap would be lost.
 */
export function planRenumber(input: {
  tenantId: string;
  stationId: string;
  pump: PumpLike;
  nozzles: readonly NozzleLike[];
  answers: RenumberAnswers;
}): StagedChange[] {
  const { pump, answers } = input;
  const base = { tenantId: input.tenantId, stationId: input.stationId };
  const out: StagedChange[] = [];
  const number = answers.pumpNumber.trim();
  const name = answers.pumpName.trim();
  if (number !== pump.number || name !== (pump.name ?? '')) {
    out.push({
      id: `staged-${nextId()}`,
      url: '/api/setup/commands',
      body: { commandType: 'UpdatePump', ...base, pumpId: pump.id, number, name: name || null },
    });
  }
  const wanted = input.nozzles.map((n) => ({
    id: n.id,
    number: (answers.nozzles[n.id] ?? '').trim(),
  }));
  for (const step of planNozzleRenumbering(input.nozzles, wanted)) {
    out.push({
      id: `staged-${nextId()}`,
      url: '/api/setup/commands',
      body: { commandType: 'UpdateNozzle', ...base, nozzleId: step.id, number: step.number },
    });
  }
  return out;
}

/** True when the answers change nothing, so the check screen can say so instead of saving nothing. */
export function renumberIsUnchanged(input: {
  pump: PumpLike;
  nozzles: readonly NozzleLike[];
  answers: RenumberAnswers;
}): boolean {
  return planRenumber({ tenantId: '', stationId: '', ...input }).length === 0;
}

/* --------------------------- remove (#315) --------------------------- */

/** Deletes a pump that was never used, with its nozzles. Only offered while `pump.unused`. */
export function planDeletePump(input: {
  tenantId: string;
  stationId: string;
  pumpId: string;
}): StagedChange[] {
  return [
    {
      id: `staged-${nextId()}`,
      url: '/api/setup/commands',
      body: { commandType: 'DeletePump', ...input },
    },
  ];
}

/** Deletes a nozzle that was never used, with its meter. Only offered while `nozzle.unused`. */
export function planDeleteNozzle(input: {
  tenantId: string;
  stationId: string;
  nozzleId: string;
}): StagedChange[] {
  return [
    {
      id: `staged-${nextId()}`,
      url: '/api/setup/commands',
      body: { commandType: 'DeleteNozzle', ...input },
    },
  ];
}

/* --------------------- stop using, keeping history (#316) --------------------- */

/** Stops using a pump that has history, and its nozzles. Past records keep it. */
export function planRetirePump(input: {
  tenantId: string;
  stationId: string;
  pumpId: string;
}): StagedChange[] {
  return [
    {
      id: `staged-${nextId()}`,
      url: '/api/setup/commands',
      body: { commandType: 'RetirePump', ...input },
    },
  ];
}

/** Stops using a nozzle that has history. Past records keep it. */
export function planRetireNozzle(input: {
  tenantId: string;
  stationId: string;
  nozzleId: string;
}): StagedChange[] {
  return [
    {
      id: `staged-${nextId()}`,
      url: '/api/setup/commands',
      body: { commandType: 'RetireNozzle', ...input },
    },
  ];
}

/* ------------------------ when a meter started working ------------------------ */

export type SinceStep = 'pickNozzle' | 'date' | 'reviewSince';

export type SinceAnswers = { nozzleId: string | null; date: string };

export const BLANK_SINCE: SinceAnswers = { nozzleId: null, date: '' };

export const sinceSteps = (): readonly SinceStep[] => ['pickNozzle', 'date', 'reviewSince'];

export function checkSincePick(answers: SinceAnswers): Errors {
  return answers.nozzleId ? {} : { nozzle: 'Choose the nozzle.' };
}

export function checkSinceDate(answers: SinceAnswers): Errors {
  return isCalendarDay(answers.date) ? {} : { date: 'Choose the day the meter was fitted.' };
}

export function planSince(input: {
  tenantId: string;
  stationId: string;
  answers: SinceAnswers;
}): StagedChange[] {
  return [
    {
      id: `staged-${nextId()}`,
      url: '/api/setup/commands',
      body: {
        commandType: 'SetMeterWorkingSince',
        tenantId: input.tenantId,
        stationId: input.stationId,
        nozzleId: input.answers.nozzleId,
        meterWorkingSinceDate: input.answers.date,
      },
    },
  ];
}
