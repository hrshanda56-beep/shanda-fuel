import { describe, expect, it } from 'vitest';

import {
  describePriceState,
  displayPrice,
  friendlyPriceError,
  planPriceAdvance,
} from './guided-setup';

const all = { priceRequest: true, priceApprove: true, priceActivate: true };

describe('planPriceAdvance', () => {
  it('runs every step for a person who can do all of them', () => {
    expect(planPriceAdvance('DRAFT', all)).toEqual({
      commands: [
        'RequestPriceChange',
        'ApprovePriceChange',
        'PreparePriceActivation',
        'ActivatePriceChange',
      ],
      label: 'Approve and use this price',
    });
  });

  it('stops where the person runs out of rights', () => {
    expect(planPriceAdvance('DRAFT', { ...all, priceApprove: false })).toEqual({
      commands: ['RequestPriceChange'],
      label: 'Send for approval',
    });
    expect(planPriceAdvance('PENDING_APPROVAL', { ...all, priceActivate: false })).toEqual({
      commands: ['ApprovePriceChange'],
      label: 'Approve this price',
    });
  });

  it('offers nothing for a price already in use or without rights', () => {
    expect(planPriceAdvance('ACTIVE', all).label).toBeNull();
    expect(
      planPriceAdvance('PENDING_APPROVAL', {
        priceRequest: true,
        priceApprove: false,
        priceActivate: false,
      }).commands,
    ).toEqual([]);
  });

  it('resumes an approved price', () => {
    expect(planPriceAdvance('APPROVED', all)).toEqual({
      commands: ['PreparePriceActivation', 'ActivatePriceChange'],
      label: 'Start using this price',
    });
    expect(planPriceAdvance('BOUNDARIES_IN_PROGRESS', all).commands).toEqual([
      'ActivatePriceChange',
    ]);
  });
});

describe('price wording', () => {
  it('does not call a draft "waiting for approval"', () => {
    expect(describePriceState('DRAFT')).toBe('saved, not sent for approval yet');
    expect(describePriceState('PENDING_APPROVAL')).toBe('waiting for approval');
    expect(describePriceState('ACTIVE')).toBe('in use');
  });

  it('shows two decimals without rounding exact values', () => {
    expect(displayPrice('1.950000')).toBe('1.95');
    expect(displayPrice('2')).toBe('2.00');
    expect(displayPrice('1.5')).toBe('1.50');
    expect(displayPrice('1.2345')).toBe('1.2345');
  });

  it('explains the requester rule instead of asking for a new sign-in', () => {
    expect(friendlyPriceError(403, 'A price change cannot be approved by its requester')).toMatch(
      /Another person/,
    );
    expect(friendlyPriceError(403)).toMatch(/sign-in/);
  });
});
