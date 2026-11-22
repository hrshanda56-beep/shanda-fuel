import type { ConfigurationSetupOverview } from './contracts';
import {
  minutesBetween,
  parsePositiveDecimal,
  planPriceAdvance,
  suggestCode,
  validateFuelChoice,
  type FuelUnitChoice,
} from './guided-setup';
import { STAND_IN_PREFIX, type StagedChange } from './staged-changes';

/**
 * The pure part of the "set up this station, one question at a time" guide. The screen collects
 * answers into these drafts; `planSetupChanges` turns them into the very same waiting changes the
 * forms on the setup screen create, so saving, the identity check and the review list are unchanged.
 */

/** A pump chosen for a nozzle: one already there, or one this guide is about to add. */
export const NEW_PUMP = '__new__';

export type TankDraft = {
  name: string;
  capacity: string;
  /** Yellow limit: how far a dip may differ before it must be explained. */
  difference: string;
  /** Red limit: a difference above this is urgent. */
  red: string;
  reorder: string;
};

export type NozzleDraft = {
  /** A saved pump's id, `new:<number>` for a pump an earlier fuel adds, or NEW_PUMP. */
  pump: string;
  newPumpNumber: string;
  newPumpName: string;
  number: string;
  meter: string;
  /** The day the meter was fitted, when it was before today. */
  since: string;
};

export type FuelDraft = {
  key: number;
  kind: string;
  blendPercent: string;
  name: string;
  nameEdited: boolean;
  unit: FuelUnitChoice;
  /** Empty means "set the price later". */
  price: string;
  tank: TankDraft | null;
  nozzle: NozzleDraft | null;
};

export type ShiftDraft = { name: string; start: string; end: string };

export type Errors = Record<string, string>;

let draftKey = 1;
export const blankFuel = (): FuelDraft => ({
  key: draftKey++,
  kind: '',
  blendPercent: '',
  name: '',
  nameEdited: false,
  unit: 'LITRES',
  price: '',
  tank: null,
  nozzle: null,
});

export const blankTank = (name: string): TankDraft => ({
  name,
  capacity: '',
  difference: '',
  red: '',
  reorder: '',
});

export const blankNozzle = (): NozzleDraft => ({
  pump: '',
  newPumpNumber: '',
  newPumpName: '',
  number: '',
  meter: '',
  since: '',
});

const word = (unit: FuelUnitChoice) => (unit === 'KILOGRAMS' ? 'kilograms' : 'litres');

/** Checks the first two questions about one fuel (its type, then its name). */
export function checkFuelName(
  fuel: Pick<FuelDraft, 'kind' | 'blendPercent' | 'name'>,
  takenNames: readonly string[],
): Errors {
  const checked = validateFuelChoice(fuel);
  if (!checked.ok) return checked.errors as Errors;
  const lower = checked.value.name.toLowerCase();
  if (takenNames.some((name) => name.trim().toLowerCase() === lower)) {
    return { name: `You already have a fuel called ${checked.value.name}. Use a different name.` };
  }
  return {};
}

/** An empty price is allowed (it can be set later); anything typed must be a real price. */
export function checkPrice(price: string, unit: FuelUnitChoice): Errors {
  if (!price.trim()) return {};
  return parsePositiveDecimal(price, 6)
    ? {}
    : {
        price: `Enter the price per ${unit === 'KILOGRAMS' ? 'kilogram' : 'litre'}, for example 1.65, or leave it empty.`,
      };
}

export function checkTank(tank: TankDraft, unit: FuelUnitChoice): Errors {
  const errors: Errors = {};
  const w = word(unit);
  if (!tank.name.trim()) errors.name = 'Give the tank a name, for example Tank 1.';
  const capacity = parsePositiveDecimal(tank.capacity, 3);
  if (!capacity) errors.capacity = `Enter how many ${w} the tank holds.`;
  const optional = (key: 'difference' | 'red' | 'reorder') => {
    const text = tank[key].trim();
    return text ? parsePositiveDecimal(text, 3) : null;
  };
  const difference = optional('difference');
  const red = optional('red');
  const reorder = optional('reorder');
  if (tank.difference.trim() && !difference) {
    errors.difference = `Enter a number of ${w}, or leave this empty.`;
  }
  if (tank.red.trim() && !red) errors.red = `Enter a number of ${w}, or leave this empty.`;
  else if (red && !difference) errors.red = 'Set the amount to explain first.';
  else if (red && difference && Number(red) < Number(difference)) {
    errors.red = 'The urgent amount cannot be lower than the amount to explain.';
  }
  if (tank.reorder.trim() && !reorder) {
    errors.reorder = `Enter a number of ${w}, or leave this empty.`;
  } else if (reorder && capacity && Number(reorder) > Number(capacity)) {
    errors.reorder = 'This cannot be more than the tank holds.';
  }
  return errors;
}

export function checkNozzle(nozzle: NozzleDraft, existingPumpNumbers: readonly string[]): Errors {
  const errors: Errors = {};
  if (!nozzle.pump) errors.pump = 'Choose the pump.';
  if (nozzle.pump === NEW_PUMP) {
    const number = nozzle.newPumpNumber.trim();
    if (!number) errors.newPumpNumber = 'Enter the pump number, for example 1.';
    else if (existingPumpNumbers.includes(number)) {
      errors.newPumpNumber = `Pump ${number} is already on the list. Choose it above instead.`;
    }
  }
  if (!nozzle.number.trim()) errors.number = 'Enter the nozzle number, for example 1.';
  if (!nozzle.meter.trim()) errors.meter = 'Enter the serial number printed on the meter.';
  return errors;
}

export function checkShift(shift: ShiftDraft): Errors {
  const errors: Errors = {};
  if (!shift.name.trim()) errors.name = 'Give the shift a name, for example Day shift.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.start)) errors.start = 'Choose the start time.';
  if (!minutesBetween(shift.start, shift.end)) {
    errors.end = 'Choose an end time that is different from the start time.';
  }
  return errors;
}

let counter = 0;
const nextId = (): string => `wiz-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

/**
 * Everything the guide collected, as waiting changes in the order the server needs them: a fuel
 * before its price, tank and nozzle; a pump before the nozzle on it. Each thing that is created
 * gets a stand-in id that later changes point at, exactly as the setup forms do.
 */
export function planSetupChanges(input: {
  tenantId: string;
  stationId: string;
  fuels: readonly FuelDraft[];
  shift: ShiftDraft | null;
  data: ConfigurationSetupOverview;
}): StagedChange[] {
  const { tenantId, stationId, data } = input;
  const base = { tenantId, stationId };
  const out: StagedChange[] = [];
  const takenProducts = (data.products ?? []).map((p) => p.code);
  const takenTanks = (data.tanks ?? []).map((t) => t.code);
  const takenShifts = (data.shiftTemplates ?? []).map((s) => s.code);
  const newPumps = new Map<string, string>(); // pump number -> stand-in id

  const create = (url: string, body: Record<string, unknown>, creates = false): string => {
    const id = nextId();
    const standIn = creates ? `${STAND_IN_PREFIX}${id}` : undefined;
    out.push({ id: `staged-${id}`, url, body, ...(standIn ? { standIn } : {}) });
    return standIn ?? '';
  };

  for (const fuel of input.fuels) {
    const checked = validateFuelChoice(fuel);
    if (!checked.ok) continue;
    const { value } = checked;
    const code = suggestCode(value.name, takenProducts);
    takenProducts.push(code);
    const productId = create(
      '/api/setup/commands',
      {
        commandType: 'CreateProduct',
        ...base,
        code,
        name: value.name,
        kind: value.kind,
        blendPercent: value.blendPercent,
        unit: fuel.unit,
      },
      true,
    );

    const price = parsePositiveDecimal(fuel.price, 6);
    if (price && data.capabilities.priceRequest) {
      const priceId = create(
        '/api/setup/commands',
        {
          commandType: 'DraftPriceChange',
          ...base,
          productId,
          unitPrice: price,
          currency: 'USD',
          effectiveFrom: new Date().toISOString(),
        },
        true,
      );
      const { commands } = planPriceAdvance('DRAFT', data.capabilities);
      if (commands.length > 0) {
        create('/api/forecourt/commands', {
          commandType: 'AdvancePrice',
          ...base,
          priceId,
          steps: commands,
          expectedVersion: 0,
        });
      }
    }

    if (fuel.tank && data.capabilities.tanks) {
      const capacity = parsePositiveDecimal(fuel.tank.capacity, 3);
      if (capacity) {
        const optional = (text: string) => (text.trim() ? parsePositiveDecimal(text, 3) : null);
        const tankCode = suggestCode(fuel.tank.name, takenTanks);
        takenTanks.push(tankCode);
        create(
          '/api/inventory/commands',
          {
            commandType: 'CreateTank',
            ...base,
            code: tankCode,
            productId,
            capacityLitres: capacity,
            reorderLevelLitres: optional(fuel.tank.reorder),
            acceptableVarianceLitres: optional(fuel.tank.difference),
            varianceRedLitres: optional(fuel.tank.red),
          },
          true,
        );
      }
    }

    const nozzle = fuel.nozzle;
    if (nozzle && data.capabilities.forecourt) {
      let pumpId = nozzle.pump;
      if (nozzle.pump === NEW_PUMP || nozzle.pump.startsWith('new:')) {
        const number =
          nozzle.pump === NEW_PUMP ? nozzle.newPumpNumber.trim() : nozzle.pump.slice(4);
        const known = newPumps.get(number);
        if (known) pumpId = known;
        else {
          pumpId = create(
            '/api/setup/commands',
            {
              commandType: 'CreatePump',
              ...base,
              number,
              name: nozzle.newPumpName.trim() || null,
            },
            true,
          );
          newPumps.set(number, pumpId);
        }
      }
      create(
        '/api/setup/commands',
        {
          commandType: 'CreateNozzle',
          ...base,
          pumpId,
          number: nozzle.number.trim(),
          productId,
          meterSerialNumber: nozzle.meter.trim(),
          ...(nozzle.since ? { meterWorkingSinceDate: nozzle.since } : {}),
        },
        true,
      );
    }
  }

  const shift = input.shift;
  const minutes = shift ? minutesBetween(shift.start, shift.end) : null;
  if (shift && minutes && data.capabilities.shiftTemplates) {
    const shiftCode = suggestCode(shift.name.trim(), takenShifts);
    create('/api/forecourt/commands', {
      commandType: 'DefineShiftTemplate',
      ...base,
      shiftTemplateId: crypto.randomUUID(),
      expectedVersion: 0,
      code: shiftCode,
      name: shift.name.trim(),
      startTime: shift.start,
      durationMinutes: minutes,
      active: true,
    });
  }
  return out;
}
