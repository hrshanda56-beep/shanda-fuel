import { parsePositiveDecimal, suggestCode } from './guided-setup';

/**
 * The rules of the tank wizard (add a tank, or change one), one question per screen. Pure, so the
 * screen only draws what these decide. Wording follows the owner's feedback (#256): a tank has a
 * name, a size, an optional "order more fuel" reminder and an acceptable stock difference, in plain
 * words (no "yellow" or "red").
 */

/** The standard check from DECISIONS.md: a warning past 0.5 % and an alert past 1 % of litres sold. */
export const STANDARD_WARNING_PERCENT = '0.5';
export const STANDARD_ALERT_PERCENT = '1';

export const MAX_TANK_NAME = 32;

export type TankStep = 'name' | 'size' | 'reminder' | 'check' | 'review';
/** Screens outside the numbered steps: choosing the fuel (#315) and confirming a delete. */
export type TankExtraScreen = 'fuel' | 'delete';
export type ReorderChoice = 'p25' | 'p20' | 'p10' | 'own';
export type LimitMode = 'usual' | 'own';

export type TankAnswers = {
  name: string;
  /** Whole litres (or kilograms) as typed. */
  capacity: string;
  /** Wants a reminder to order more fuel. `null` until answered. */
  remind: boolean | null;
  reorderChoice: ReorderChoice | null;
  reorderOwn: string;
  limitMode: LimitMode | null;
  /** Differences bigger than this must be explained. */
  explain: string;
  /** Differences bigger than this are urgent. */
  urgent: string;
};

export const BLANK_TANK: TankAnswers = {
  name: '',
  capacity: '',
  remind: null,
  reorderChoice: null,
  reorderOwn: '',
  limitMode: null,
  explain: '',
  urgent: '',
};

/** The steps that apply to these answers, for "Step 2 of 5". The wizard always asks the same five. */
export function tankSteps(): readonly TankStep[] {
  return ['name', 'size', 'reminder', 'check', 'review'];
}

const SHARES: ReadonlyArray<{ value: Exclude<ReorderChoice, 'own'>; percent: number }> = [
  { value: 'p25', percent: 25 },
  { value: 'p20', percent: 20 },
  { value: 'p10', percent: 10 },
];

/** `3200.000` becomes `3200`; `0.500` becomes `0.5`. Whole numbers are shown without decimals. */
export function plainNumber(value: string | null | undefined): string {
  if (!value) return '';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

/** `40000` becomes `40,000`. */
export function withSeparators(value: string): string {
  const [whole = '', fraction] = plainNumber(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** The size as an exact amount, or null when it is not a positive number (at most 3 decimals). */
export function readAmount(text: string): string | null {
  return parsePositiveDecimal(text, 3);
}

/** The reminder levels offered once the size is known: a share of the tank, in whole units. */
export function reorderSuggestions(
  capacity: string,
): ReadonlyArray<{ value: Exclude<ReorderChoice, 'own'>; percent: number; amount: string }> {
  const size = readAmount(capacity);
  if (!size) return [];
  return SHARES.map(({ value, percent }) => ({
    value,
    percent,
    amount: String(Math.max(1, Math.round((Number(size) * percent) / 100))),
  }));
}

/** The reminder level the answers stand for, or null for "no reminder". */
export function reorderLevel(answers: TankAnswers): string | null {
  if (answers.remind !== true) return null;
  if (answers.reorderChoice === 'own') return readAmount(answers.reorderOwn);
  const chosen = reorderSuggestions(answers.capacity).find(
    (option) => option.value === answers.reorderChoice,
  );
  return chosen ? chosen.amount : null;
}

/** The own limits, or nulls for the standard check. */
export function limitValues(answers: TankAnswers): {
  difference: string | null;
  red: string | null;
} {
  if (answers.limitMode !== 'own') return { difference: null, red: null };
  return { difference: readAmount(answers.explain), red: readAmount(answers.urgent) };
}

type Errors = Record<string, string>;

/** `others` are the names of the other tanks at this station, so two tanks never share a name. */
export function checkName(name: string, others: readonly string[]): Errors {
  const value = name.trim();
  if (!value) return { name: 'Give the tank a name, for example Tank 1.' };
  if (value.length > MAX_TANK_NAME) {
    return { name: `Keep the name to ${MAX_TANK_NAME} letters or fewer.` };
  }
  const clash = others.some((other) => other.trim().toLowerCase() === value.toLowerCase());
  return clash ? { name: 'Another tank already has this name. Choose a different one.' } : {};
}

export function checkSize(capacity: string, word: string): Errors {
  return readAmount(capacity) ? {} : { capacity: `Enter how many ${word} the tank holds.` };
}

export function checkReminder(answers: TankAnswers, word: string): Errors {
  if (answers.remind === null) return { remind: 'Choose yes or no.' };
  if (answers.remind === false) return {};
  if (!answers.reorderChoice) return { reorderChoice: 'Choose when to be reminded.' };
  if (answers.reorderChoice !== 'own') return {};
  const level = readAmount(answers.reorderOwn);
  if (!level) return { reorderOwn: `Enter a number of ${word}, for example 5000.` };
  const size = readAmount(answers.capacity);
  if (size && Number(level) > Number(size)) {
    return { reorderOwn: 'This cannot be more than the tank holds.' };
  }
  return {};
}

export function checkLimits(answers: TankAnswers, word: string): Errors {
  if (answers.limitMode === null) return { limitMode: 'Choose how to check differences.' };
  if (answers.limitMode === 'usual') return {};
  const explain = readAmount(answers.explain);
  const urgent = readAmount(answers.urgent);
  const errors: Errors = {};
  if (!explain) errors.explain = `Enter a number of ${word}, for example 100.`;
  if (!urgent) errors.urgent = `Enter a number of ${word}, for example 300.`;
  if (explain && urgent && Number(urgent) < Number(explain)) {
    errors.urgent = 'This cannot be lower than the amount that must be explained.';
  }
  return errors;
}

/** Fills the answers from a tank that already exists, so changing one starts from what it has. */
export function answersFromTank(tank: {
  code: string;
  capacityLitres: string;
  reorderLevelLitres: string | null;
  acceptableVarianceLitres: string | null;
  varianceRedLitres: string | null;
}): TankAnswers {
  const hasReminder = tank.reorderLevelLitres !== null;
  const own = tank.acceptableVarianceLitres !== null || tank.varianceRedLitres !== null;
  return {
    name: tank.code,
    capacity: plainNumber(tank.capacityLitres),
    remind: hasReminder,
    reorderChoice: hasReminder ? 'own' : null,
    reorderOwn: plainNumber(tank.reorderLevelLitres),
    limitMode: own ? 'own' : 'usual',
    explain: plainNumber(tank.acceptableVarianceLitres),
    // A tank with an explanation amount but no urgent amount is judged at twice the first, so show
    // that number: the person sees what already applies instead of an empty box they must fill.
    urgent: tank.varianceRedLitres
      ? plainNumber(tank.varianceRedLitres)
      : tank.acceptableVarianceLitres && readAmount(tank.acceptableVarianceLitres)
        ? plainNumber(String(Number(tank.acceptableVarianceLitres) * 2))
        : '',
  };
}

/**
 * Words that name a fuel in a tank name, beyond the fuels' own names: what people write on tanks.
 * Each maps to the word a fuel's name or type would contain.
 */
const FUEL_WORDS: Readonly<Record<string, string>> = {
  petrol: 'petrol',
  unleaded: 'petrol',
  ulp: 'petrol',
  blend: 'petrol',
  gasoline: 'petrol',
  mogas: 'petrol',
  diesel: 'diesel',
  dsl: 'diesel',
  gasoil: 'diesel',
  ago: 'diesel',
  paraffin: 'paraffin',
  kerosene: 'paraffin',
  lpg: 'lpg',
  gas: 'lpg',
};

/** The words in a name, lower case, with digits split off ("PETROL1" gives "petrol"). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** Words too general to tell fuels apart. */
const GENERAL = new Set([
  'tank',
  'fuel',
  'the',
  'and',
  'for',
  'new',
  'old',
  'main',
  'big',
  'small',
]);

/** Drops general words and very short ones ("a", "no"), which say nothing about the fuel. */
function significant(found: Set<string>): Set<string> {
  return new Set([...found].filter((word) => word.length >= 3 && !GENERAL.has(word)));
}

/** The fuel words a name or a fuel's description contains, as their common form. */
function fuelWordsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of words(text)) out.add(FUEL_WORDS[word] ?? word);
  return out;
}

/**
 * Catches a tank added under the wrong fuel (#315): when the tank's name mentions another fuel at
 * the station (by its name, or a common word for it such as "ULP" or "unleaded") and not the fuel
 * it is being put under, the other fuel is returned so the check screen can warn. Null otherwise.
 */
export function tankFuelMismatch(
  tankName: string,
  chosen: { id: string; name: string; kind?: string | null },
  fuels: readonly { id: string; name: string; kind?: string | null }[],
): { id: string | null; name: string } | null {
  const named = significant(fuelWordsIn(tankName));
  if (named.size === 0) return null;
  const mentions = (fuel: { name: string; kind?: string | null }) =>
    [...significant(fuelWordsIn(`${fuel.name} ${fuel.kind ?? ''}`))].some((word) =>
      named.has(word),
    );
  if (mentions(chosen)) return null;
  const other = fuels.find((fuel) => fuel.id !== chosen.id && mentions(fuel));
  if (other) return { id: other.id, name: other.name };
  // A common fuel word for a fuel the station has not added yet ("PETROL1" while setting up
  // Diesel, before Petrol exists).
  const common = [...named].find((word) => COMMON_FUELS.has(word));
  return common ? { id: null, name: common.charAt(0).toUpperCase() + common.slice(1) } : null;
}

/** The fuels a common word can name even before the station has added them. */
const COMMON_FUELS = new Set(Object.values(FUEL_WORDS));

/** The command that deletes an unused tank (#315). */
export function deleteTankCommand(input: {
  tenantId: string;
  stationId: string;
  tankId: string;
}): Record<string, unknown> {
  return { commandType: 'DeleteTank', ...input };
}

/** The command that saves these answers: a new tank, or a change to one that exists. */
export function tankCommand(input: {
  answers: TankAnswers;
  tenantId: string;
  stationId: string;
  /** Set when changing a tank. */
  tankId?: string;
  /** The fuel the tank holds. For an existing tank, sent only when it changes (unused tanks only). */
  productId: string;
  /** The fuel an existing tank holds now, so a change of fuel can be told apart. */
  currentProductId?: string;
  existingCodes: readonly string[];
}): Record<string, unknown> {
  const { answers } = input;
  const limits = limitValues(answers);
  const shared = {
    tenantId: input.tenantId,
    stationId: input.stationId,
    capacityLitres: readAmount(answers.capacity),
    reorderLevelLitres: reorderLevel(answers),
    acceptableVarianceLitres: limits.difference,
    varianceRedLitres: limits.red,
  };
  if (input.tankId) {
    return {
      commandType: 'UpdateTank',
      ...shared,
      tankId: input.tankId,
      code: answers.name.trim(),
      ...(input.currentProductId && input.productId !== input.currentProductId
        ? { productId: input.productId }
        : {}),
    };
  }
  return {
    commandType: 'CreateTank',
    ...shared,
    productId: input.productId,
    code: suggestCode(answers.name, input.existingCodes),
  };
}

/** The sentence shown on the check screen for the reminder. */
export function reminderSentence(answers: TankAnswers, word: string): string {
  const level = reorderLevel(answers);
  return level ? `Remind me when it falls to ${withSeparators(level)} ${word}` : 'No reminder';
}

/** The sentence shown on the check screen for the difference check. */
export function checkSentence(answers: TankAnswers, word: string): string {
  if (answers.limitMode !== 'own') {
    return `Standard check: a warning past ${STANDARD_WARNING_PERCENT}% and an alert past ${STANDARD_ALERT_PERCENT}% of what was sold`;
  }
  const { difference, red } = limitValues(answers);
  return `Explain differences over ${withSeparators(difference ?? '')} ${word}; urgent over ${withSeparators(red ?? '')} ${word}`;
}
