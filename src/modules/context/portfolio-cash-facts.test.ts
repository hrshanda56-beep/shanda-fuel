import { describe, expect, it } from 'vitest';
import { cashFacts } from './portfolio-cash-facts';

describe('cash facts on the all-stations overview', () => {
  const totals = {
    availableAtStation: '6260.0500',
    heldByManagement: '0',
    collectedButUnbanked: '6260.0500',
    pendingBankConfirmation: '3789.9700',
  };

  it('uses plain words, not field names', () => {
    expect(cashFacts(totals, 'USD').map((fact) => fact.label)).toEqual([
      'Cash at the station',
      'Held by management',
      'Collected, not yet deposited',
      'Deposited, bank has not confirmed',
    ]);
  });

  it('shows money with a thousands separator and cents', () => {
    expect(cashFacts(totals, 'USD').map((fact) => fact.value)).toEqual([
      '$6,260.05',
      '$0',
      '$6,260.05',
      '$3,789.97',
    ]);
  });

  it('keeps an unknown figure readable instead of dropping it', () => {
    expect(cashFacts({ somethingNew: '5' }, 'USD')).toEqual([
      { label: 'Something new', value: '$5' },
    ]);
  });

  it('names a currency other than USD', () => {
    expect(cashFacts({ availableAtStation: '10.5' }, 'ZWG')[0]?.value).toBe('ZWG 10.5');
  });
});
