import type { ConfigurationSetupOverview } from './contracts';

/**
 * Pure rules behind the "Set up your station" guide. The guide speaks in plain
 * language and never shows identifiers; everything here is derived from what has
 * been entered, so it never invents a default.
 */

export type GuidedStepId = 'fuel' | 'prices' | 'tanks' | 'pumps' | 'shifts' | 'supervisor';
export type GuidedStepStatus = 'done' | 'todo' | 'blocked';

export type GuidedStep = Readonly<{
  id: GuidedStepId;
  title: string;
  /** One plain sentence saying what this step is for. */
  purpose: string;
  status: GuidedStepStatus;
  /** What has been entered so far, or what is still needed. */
  summary: string;
  /** Present when status is `blocked`: what to do first. */
  blockedReason?: string;
  /** Whether the signed-in person may add things in this step. */
  canEdit: boolean;
}>;

type Data = Omit<ConfigurationSetupOverview, 'blockers'>;

const needs = (n: number) => (n === 1 ? 'needs' : 'need');

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildGuidedSteps(data: Data): readonly GuidedStep[] {
  const products = (data.products ?? []).filter((p) => p.status === 'ACTIVE');
  const tanks = (data.tanks ?? []).filter((t) => t.status === 'ACTIVE');
  const pumps = (data.pumps ?? []).filter((p) => p.status === 'ACTIVE');
  const nozzles = (data.nozzles ?? []).filter((n) => n.status === 'ACTIVE');
  const shifts = (data.shiftTemplates ?? []).filter((s) => s.active);
  const prices = data.prices ?? [];
  const caps = data.capabilities;
  const needFuel = 'Add at least one fuel type first.';

  const fuel: GuidedStep = {
    id: 'fuel',
    title: 'Fuel types',
    purpose: 'The fuels you sell, for example Petrol or Diesel.',
    status: products.length > 0 ? 'done' : 'todo',
    summary:
      products.length > 0 ? products.map((p) => p.name).join(', ') : 'No fuel types added yet.',
    canEdit: caps.products,
  };

  const activePriced = new Set(prices.filter((p) => p.state === 'ACTIVE').map((p) => p.productId));
  const waiting = prices.filter((p) => p.state !== 'ACTIVE' && p.state !== 'SUPERSEDED');
  const unpriced = products.filter((p) => !activePriced.has(p.id));
  const priceStep: GuidedStep =
    products.length === 0
      ? {
          id: 'prices',
          title: 'Selling prices',
          purpose: 'What you charge per litre.',
          status: 'blocked',
          summary: 'Prices come after fuel types.',
          blockedReason: needFuel,
          canEdit: false,
        }
      : {
          id: 'prices',
          title: 'Selling prices',
          purpose: 'What you charge per litre.',
          status: unpriced.length === 0 ? 'done' : 'todo',
          summary:
            unpriced.length === 0
              ? 'Every fuel has a price in use.'
              : waiting.length > 0
                ? `${count(waiting.length, 'price')} waiting for approval. Still needs a price: ${unpriced
                    .map((p) => p.name)
                    .join(', ')}.`
                : `Still needs a price: ${unpriced.map((p) => p.name).join(', ')}.`,
          canEdit: caps.priceRequest,
        };

  const missingTolerance = tanks.filter((t) => t.acceptableVarianceLitres === null).length;
  const tankStep: GuidedStep =
    products.length === 0
      ? {
          id: 'tanks',
          title: 'Fuel tanks',
          purpose: 'The tanks that hold your fuel and how much each one holds.',
          status: 'blocked',
          summary: 'Tanks come after fuel types.',
          blockedReason: needFuel,
          canEdit: false,
        }
      : {
          id: 'tanks',
          title: 'Fuel tanks',
          purpose: 'The tanks that hold your fuel and how much each one holds.',
          status: tanks.length > 0 && missingTolerance === 0 ? 'done' : 'todo',
          summary:
            tanks.length === 0
              ? 'No tanks added yet.'
              : missingTolerance > 0
                ? `${count(tanks.length, 'tank')} added. ${count(
                    missingTolerance,
                    'tank',
                  )} still ${needs(missingTolerance)} an acceptable difference.`
                : `${count(tanks.length, 'tank')} added.`,
          canEdit: caps.tanks,
        };

  const pumpsWithoutNozzle = pumps.filter((p) => !nozzles.some((n) => n.pumpId === p.id));
  const pumpStep: GuidedStep =
    products.length === 0
      ? {
          id: 'pumps',
          title: 'Pumps and nozzles',
          purpose: 'The pumps on the forecourt, and the nozzle and meter on each.',
          status: 'blocked',
          summary: 'Pumps come after fuel types.',
          blockedReason: needFuel,
          canEdit: false,
        }
      : {
          id: 'pumps',
          title: 'Pumps and nozzles',
          purpose: 'The pumps on the forecourt, and the nozzle and meter on each.',
          status: nozzles.length > 0 && pumpsWithoutNozzle.length === 0 ? 'done' : 'todo',
          summary:
            pumps.length === 0
              ? 'No pumps added yet.'
              : pumpsWithoutNozzle.length > 0
                ? `${count(pumps.length, 'pump')} added. ${count(
                    pumpsWithoutNozzle.length,
                    'pump',
                  )} still ${needs(pumpsWithoutNozzle.length)} a nozzle.`
                : `${count(pumps.length, 'pump')} and ${count(nozzles.length, 'nozzle')} added.`,
          canEdit: caps.forecourt,
        };

  const shiftStep: GuidedStep = {
    id: 'shifts',
    title: 'Shifts',
    purpose: 'When each shift starts and how long it runs.',
    status: shifts.length > 0 ? 'done' : 'todo',
    summary: shifts.length > 0 ? shifts.map((s) => s.name).join(', ') : 'No shifts added yet.',
    canEdit: caps.shiftTemplates,
  };

  const supervisors = data.supervisors ?? [];
  const chosen = supervisors.find((s) => s.membershipId === data.responsibleSupervisorMembershipId);
  const supervisorStep: GuidedStep =
    supervisors.length === 0
      ? {
          id: 'supervisor',
          title: 'Supervisor in charge',
          purpose:
            'The person responsible for this station, who signs off the day and receives cash from attendants.',
          status: 'blocked',
          summary: 'No supervisor works at this station yet.',
          blockedReason: 'Invite a supervisor to this station under Staff first.',
          canEdit: false,
        }
      : {
          id: 'supervisor',
          title: 'Supervisor in charge',
          purpose:
            'The person responsible for this station, who signs off the day and receives cash from attendants.',
          status: chosen ? 'done' : 'todo',
          summary: chosen ? chosen.name : 'No supervisor in charge chosen yet.',
          canEdit: caps.forecourt,
        };

  return [fuel, priceStep, tankStep, pumpStep, shiftStep, supervisorStep];
}

/** The step to open next: the first one that still needs doing and can be done. */
export function firstOpenStep(steps: readonly GuidedStep[]): GuidedStepId | null {
  return steps.find((s) => s.status === 'todo')?.id ?? null;
}

export function progress(steps: readonly GuidedStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.status === 'done').length, total: steps.length };
}

/**
 * Suggest a short unique code from a name so the person never has to invent one:
 * "Unleaded 95" becomes UNLEADED95; a repeat becomes UNLEADED95-2.
 */
export function suggestCode(name: string, taken: readonly string[], maxLength = 32): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, maxLength - 3) || 'ITEM';
  const used = new Set(taken.map((code) => code.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${taken.length + 1}`;
}

/** A positive amount with at most `places` decimals, as the exact text the server expects. */
export function parsePositiveDecimal(text: string, places: number): string | null {
  const value = text.trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  if (fraction.length > places) return null;
  if (/^0*$/.test(whole) && /^0*$/.test(fraction)) return null;
  return fraction
    ? `${whole.replace(/^0+(?=\d)/, '')}.${fraction}`
    : whole.replace(/^0+(?=\d)/, '');
}

/** Whole or half hours typed by a person ("8", "8.5") to the minutes the server stores. */
export function hoursToMinutes(text: string): number | null {
  const value = text.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const minutes = Math.round(Number(value) * 60);
  return minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}

export function describeDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [] as string[];
  if (hours > 0) parts.push(count(hours, 'hour'));
  if (rest > 0) parts.push(count(rest, 'minute'));
  return parts.join(' ') || '0 minutes';
}

/** Plain-language rewording of server errors the person can act on. */
export function friendlySetupError(status: number, message?: string): string {
  if (status === 403) {
    return 'You do not have permission to do this, or you need to confirm your sign-in again.';
  }
  if (status === 409) return message || 'That already exists. Check the list above.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on our side. Nothing was saved. Try again.';
  return message || 'That could not be saved. Check the details and try again.';
}

export type PriceStepCommand =
  'RequestPriceChange' | 'ApprovePriceChange' | 'PreparePriceActivation' | 'ActivatePriceChange';

type PriceCapabilities = Readonly<{
  priceRequest: boolean;
  priceApprove: boolean;
  priceActivate: boolean;
}>;

const PRICE_PATH: ReadonlyArray<{
  from: readonly string[];
  command: PriceStepCommand;
  allowed: (caps: PriceCapabilities) => boolean;
}> = [
  { from: ['DRAFT'], command: 'RequestPriceChange', allowed: (c) => c.priceRequest },
  { from: ['PENDING_APPROVAL'], command: 'ApprovePriceChange', allowed: (c) => c.priceApprove },
  { from: ['APPROVED'], command: 'PreparePriceActivation', allowed: (c) => c.priceActivate },
  {
    from: ['PENDING_STATION_ACTIVATION', 'BOUNDARIES_IN_PROGRESS'],
    command: 'ActivatePriceChange',
    allowed: (c) => c.priceActivate,
  },
];

/**
 * The commands that take a price from its current state toward "in use", as far as this person is
 * allowed to go. Each step but the last moves the version on by one, so the screen can run them in
 * a row without reloading.
 */
export function planPriceAdvance(
  state: string,
  caps: PriceCapabilities,
): { commands: PriceStepCommand[]; label: string | null } {
  const commands: PriceStepCommand[] = [];
  let index = PRICE_PATH.findIndex((step) => step.from.includes(state));
  while (index >= 0 && index < PRICE_PATH.length && PRICE_PATH[index]!.allowed(caps)) {
    commands.push(PRICE_PATH[index]!.command);
    index += 1;
  }
  const last = commands[commands.length - 1];
  if (!last) return { commands, label: null };
  const fromDraftOrPending = state === 'DRAFT' || state === 'PENDING_APPROVAL';
  const label =
    last === 'ActivatePriceChange'
      ? fromDraftOrPending
        ? 'Approve and use this price'
        : 'Start using this price'
      : last === 'ApprovePriceChange'
        ? 'Approve this price'
        : last === 'PreparePriceActivation'
          ? 'Get this price ready'
          : 'Send for approval';
  return { commands, label };
}

export function describePriceState(state: string): string {
  switch (state) {
    case 'ACTIVE':
      return 'in use';
    case 'DRAFT':
      return 'saved, not sent for approval yet';
    case 'PENDING_APPROVAL':
      return 'waiting for approval';
    case 'APPROVED':
    case 'PENDING_STATION_ACTIVATION':
    case 'BOUNDARIES_IN_PROGRESS':
      return 'approved, not in use yet';
    default:
      return 'not in use';
  }
}

/** Shows a price with at least two decimals and no trailing zeros beyond them, without floats. */
export function displayPrice(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${whole}.${trimmed.padEnd(2, '0')}`;
}

/** Wording for a failed price step; the requester rule and the meter rule are not sign-in problems. */
export function friendlyPriceError(status: number, message?: string): string {
  if (status === 403 && message && /requester/i.test(message)) {
    return 'Another person with approval rights must approve this price. You asked for it, so you cannot.';
  }
  if (status === 409 && message && /meter boundaries/i.test(message)) {
    return 'Approved. It starts once the pump meters are read for the price change.';
  }
  return friendlySetupError(status, message);
}
