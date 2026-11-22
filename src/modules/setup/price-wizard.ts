import { formatUnitPriceText } from '@/design-system/formatters';
import { checkNewPrice } from '@/modules/forecourt/price-change-state';

import type { ConfigurationSetupOverview, SetupPrice } from './contracts';
import { planPriceAdvance } from './guided-setup';
import { STAND_IN_PREFIX, type StagedChange } from './staged-changes';

/**
 * The rules of the price wizard (#249): the new price of one fuel in one question, then a check
 * screen that says in plain words what will happen. Pure, so the screen only draws what these
 * decide. The change is not saved here; it joins the list of waiting changes like every other.
 */
export type PriceStep = 'price' | 'review';

export function priceSteps(): readonly PriceStep[] {
  return ['price', 'review'];
}

export type UnitWord = 'litre' | 'kilogram';

/** `L` or `kg`, for a price written as `US$1.50/L`. */
export const unitSymbol = (word: UnitWord): 'L' | 'kg' => (word === 'kilogram' ? 'kg' : 'L');

/** The price in use for this fuel, if it has one. */
export function currentPrice(data: ConfigurationSetupOverview, productId: string) {
  return (data.prices ?? []).find((p) => p.productId === productId && p.state === 'ACTIVE') ?? null;
}

/** A price already on its way (saved, waiting for approval, approved but not started). */
export function waitingPrices(
  data: ConfigurationSetupOverview,
  productId: string,
): readonly SetupPrice[] {
  return (data.prices ?? []).filter(
    (p) => p.productId === productId && p.state !== 'ACTIVE' && p.state !== 'SUPERSEDED',
  );
}

/** Checks the typed price; returns the exact value to save, or the sentence to show. */
export function checkPrice(
  raw: string,
  current: string | null,
  word: UnitWord,
): { ok: true; value: string } | { ok: false; message: string } {
  return checkNewPrice(raw, current, word === 'kilogram' ? 'KILOGRAMS' : 'LITRES');
}

/** "US$1.50/L", or the plain words for a fuel with no price yet. */
export function priceText(value: string | null | undefined, word: UnitWord): string {
  return value ? formatUnitPriceText(value, unitSymbol(word)) : 'No price yet';
}

type Capabilities = ConfigurationSetupOverview['capabilities'];

/** What happens to the new price once the changes are saved, from what this person may do. */
export function outcomeSentence(caps: Capabilities, state: string = 'DRAFT'): string {
  const { commands } = planPriceAdvance(state, caps);
  const last = commands[commands.length - 1];
  if (last === 'ActivatePriceChange') return 'It is used for sales as soon as you save.';
  if (last === 'PreparePriceActivation') {
    return 'It is approved and ready. Someone with the right to start prices starts it.';
  }
  if (last === 'ApprovePriceChange') {
    return 'It is sent for approval and approved. It is not used for sales until it is started.';
  }
  if (last === 'RequestPriceChange') {
    return 'It is sent for approval. A manager approves it before it is used for sales.';
  }
  return 'It is saved, but not sent for approval yet.';
}

let counter = 0;
const nextId = (): string => `price-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

/**
 * The waiting changes for a new price: the price itself, then as many approval steps as this
 * person may take. The second change points at the first through a stand-in id, which the save
 * swaps for the real one.
 */
export function planPriceChange(input: {
  tenantId: string;
  stationId: string;
  productId: string;
  /** The exact value from `checkPrice`. */
  price: string;
  capabilities: Capabilities;
  now?: Date;
}): StagedChange[] {
  const base = { tenantId: input.tenantId, stationId: input.stationId };
  const draftId = nextId();
  const standIn = `${STAND_IN_PREFIX}${draftId}`;
  const out: StagedChange[] = [
    {
      id: `staged-${draftId}`,
      url: '/api/setup/commands',
      body: {
        commandType: 'DraftPriceChange',
        ...base,
        productId: input.productId,
        unitPrice: input.price,
        currency: 'USD',
        effectiveFrom: (input.now ?? new Date()).toISOString(),
      },
      standIn,
    },
  ];
  const { commands } = planPriceAdvance('DRAFT', input.capabilities);
  if (commands.length > 0) {
    out.push({
      id: `staged-${nextId()}`,
      url: '/api/forecourt/commands',
      body: {
        commandType: 'AdvancePrice',
        ...base,
        priceId: standIn,
        steps: commands,
        expectedVersion: 0,
      },
    });
  }
  return out;
}

/** The body that takes a price that is already waiting one step further, or null if it cannot. */
export function advanceBody(input: {
  tenantId: string;
  stationId: string;
  price: Pick<SetupPrice, 'id' | 'state' | 'version'>;
  capabilities: Capabilities;
}): { body: Record<string, unknown>; label: string } | null {
  const { commands, label } = planPriceAdvance(input.price.state, input.capabilities);
  if (commands.length === 0 || !label) return null;
  return {
    label,
    body: {
      commandType: 'AdvancePrice',
      tenantId: input.tenantId,
      stationId: input.stationId,
      priceId: input.price.id,
      steps: commands,
      expectedVersion: input.price.version,
    },
  };
}
