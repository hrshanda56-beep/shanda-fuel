import { describe, expect, it } from 'vitest';

import type { ConfigurationSetupOverview } from './contracts';
import {
  advanceBody,
  checkPrice,
  currentPrice,
  outcomeSentence,
  planPriceChange,
  priceText,
  waitingPrices,
} from './price-wizard';
import { applyStaged, describeStaged, isStandIn } from './staged-changes';

const price = (id: string, productId: string, state: string, unitPrice = '1.500000') => ({
  id,
  productId,
  unitPrice,
  currency: 'USD',
  state,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  version: 3,
});

const caps = (patch: Record<string, boolean>) =>
  ({ priceRequest: true, priceApprove: false, priceActivate: false, ...patch }) as never;

const data = (prices: ReturnType<typeof price>[]) =>
  ({
    capabilities: caps({}),
    products: [{ id: 'p1', code: 'ULP', name: 'Unleaded', status: 'ACTIVE', unit: 'LITRES' }],
    prices,
  }) as unknown as ConfigurationSetupOverview;

describe('finding prices', () => {
  const overview = data([
    price('a', 'p1', 'ACTIVE'),
    price('b', 'p1', 'PENDING_APPROVAL', '1.650000'),
    price('c', 'p1', 'SUPERSEDED', '1.400000'),
    price('d', 'p2', 'ACTIVE', '1.200000'),
  ]);

  it('finds the price in use for one fuel only', () => {
    expect(currentPrice(overview, 'p1')?.id).toBe('a');
    expect(currentPrice(overview, 'p3')).toBeNull();
  });

  it('finds the prices already on their way, never old or active ones', () => {
    expect(waitingPrices(overview, 'p1').map((p) => p.id)).toEqual(['b']);
    expect(waitingPrices(overview, 'p2')).toEqual([]);
  });
});

describe('checking the typed price', () => {
  it('needs a number above zero', () => {
    expect(checkPrice('', null, 'litre')).toMatchObject({ ok: false });
    expect(checkPrice('0', null, 'litre')).toMatchObject({ ok: false });
    expect(checkPrice('abc', null, 'litre')).toMatchObject({ ok: false });
    expect(checkPrice('1.65', null, 'litre')).toEqual({ ok: true, value: '1.65' });
  });

  it('refuses the price already in use, however it is written', () => {
    expect(checkPrice('1.5', '1.500000', 'litre')).toMatchObject({ ok: false });
    expect(checkPrice('1.50', '1.500000', 'litre')).toMatchObject({ ok: false });
    expect(checkPrice('1.51', '1.500000', 'litre')).toMatchObject({ ok: true });
  });

  it('asks per kilogram for a fuel sold by weight', () => {
    const result = checkPrice('', null, 'kilogram');
    expect(result.ok === false && result.message).toContain('kilogram');
  });
});

describe('showing a price', () => {
  it('writes $with the unit, and never the stored six decimals', () => {
    expect(priceText('1.500000', 'litre')).toBe('$1.50/L');
    expect(priceText('1.575000', 'litre')).toBe('$1.575/L');
    expect(priceText('2.100000', 'kilogram')).toBe('$2.10/kg');
    expect(priceText(null, 'litre')).toBe('No price yet');
  });
});

describe('what happens after saving', () => {
  it('says so in plain words for each level of rights', () => {
    expect(outcomeSentence(caps({}))).toMatch(/sent for approval/i);
    expect(outcomeSentence(caps({ priceApprove: true }))).toMatch(/not used for sales until/i);
    expect(outcomeSentence(caps({ priceApprove: true, priceActivate: true }))).toMatch(
      /as soon as you save/i,
    );
    expect(outcomeSentence(caps({ priceRequest: false }))).toMatch(/not sent for approval yet/i);
  });
});

describe('the changes that save a new price', () => {
  const input = {
    tenantId: 't',
    stationId: 's',
    productId: 'p1',
    price: '1.65',
    now: new Date('2026-11-20T08:00:00.000Z'),
  };

  it('drafts the price and sends it for approval, pointing at the draft', () => {
    const changes = planPriceChange({ ...input, capabilities: caps({}) });
    expect(changes).toHaveLength(2);
    expect(changes[0]!.body).toMatchObject({
      commandType: 'DraftPriceChange',
      unitPrice: '1.65',
      currency: 'USD',
      productId: 'p1',
      effectiveFrom: '2026-11-20T08:00:00.000Z',
    });
    expect(isStandIn(changes[0]!.standIn)).toBe(true);
    expect(changes[1]!.url).toBe('/api/forecourt/commands');
    expect(changes[1]!.body).toMatchObject({
      commandType: 'AdvancePrice',
      priceId: changes[0]!.standIn,
      steps: ['RequestPriceChange'],
      expectedVersion: 0,
    });
  });

  it('goes as far as this person is allowed to go', () => {
    const all = planPriceChange({
      ...input,
      capabilities: caps({ priceApprove: true, priceActivate: true }),
    });
    expect(all[1]!.body.steps).toEqual([
      'RequestPriceChange',
      'ApprovePriceChange',
      'PreparePriceActivation',
      'ActivatePriceChange',
    ]);
  });

  it('only drafts when the person may not send it for approval', () => {
    const draft = planPriceChange({ ...input, capabilities: caps({ priceRequest: false }) });
    expect(draft).toHaveLength(1);
  });

  it('shows on the station as though saved, and reads well in the review list', () => {
    const base = data([price('a', 'p1', 'ACTIVE')]);
    const staged = planPriceChange({ ...input, capabilities: caps({}) });
    // The page appends these as they are, so the advance step keeps pointing at the draft.
    const shown = applyStaged(base, staged);
    const added = (shown.prices ?? []).find((p) => p.unitPrice === '1.65');
    expect(added?.id).toBe(staged[0]!.standIn);
    expect(added?.state).toBe('PENDING_APPROVAL');
    expect(describeStaged(staged[0]!, shown).title).toBe('New price for Unleaded: $1.65/L');
  });
});

describe('moving a waiting price along', () => {
  it('takes it one approval further with its version', () => {
    const result = advanceBody({
      tenantId: 't',
      stationId: 's',
      price: { id: 'b', state: 'PENDING_APPROVAL', version: 4 },
      capabilities: caps({ priceApprove: true }),
    });
    expect(result?.body).toMatchObject({
      commandType: 'AdvancePrice',
      priceId: 'b',
      steps: ['ApprovePriceChange'],
      expectedVersion: 4,
    });
    expect(result?.label).toBeTruthy();
  });

  it('offers nothing this person cannot do', () => {
    expect(
      advanceBody({
        tenantId: 't',
        stationId: 's',
        price: { id: 'b', state: 'PENDING_APPROVAL', version: 4 },
        capabilities: caps({}),
      }),
    ).toBeNull();
  });
});
