import { describe, expect, it } from 'vitest';
import {
  allocateOldestFirst,
  bucketForAge,
  computeAccountAgeing,
  daysBetween,
  type AgeingLedgerLine,
  type AllocationStrategy,
} from './ageing';

const charge = (id: string, businessDate: string, amount: string): AgeingLedgerLine => ({
  id,
  businessDate,
  direction: 'INCREASE',
  amount,
});
const payment = (id: string, businessDate: string, amount: string): AgeingLedgerLine => ({
  id,
  businessDate,
  direction: 'DECREASE',
  amount,
});

describe('bucketForAge', () => {
  it('puts day counts in the client buckets', () => {
    expect(bucketForAge(-3)).toBe('current');
    expect(bucketForAge(0)).toBe('current');
    expect(bucketForAge(1)).toBe('days1to30');
    expect(bucketForAge(30)).toBe('days1to30');
    expect(bucketForAge(31)).toBe('days31to60');
    expect(bucketForAge(60)).toBe('days31to60');
    expect(bucketForAge(61)).toBe('days61to90');
    expect(bucketForAge(90)).toBe('days61to90');
    expect(bucketForAge(91)).toBe('over90');
    expect(bucketForAge(4000)).toBe('over90');
  });
});

describe('daysBetween', () => {
  it('counts calendar days across month and leap-year ends', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-12-31', '2028-01-01')).toBe(1);
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(0);
  });
  it('rejects text that is not a business date', () => {
    expect(() => daysBetween('yesterday', '2026-10-01')).toThrow();
  });
});

describe('allocateOldestFirst (owner rule awaiting confirmation)', () => {
  const charges = [
    { id: 'b', businessDate: '2026-09-10', amount: '50.0000' },
    { id: 'a', businessDate: '2026-08-01', amount: '100.0000' },
    { id: 'c', businessDate: '2026-10-01', amount: '25.5000' },
  ];

  it('clears the oldest charge first, then part of the next', () => {
    const result = allocateOldestFirst(charges, '120.0000');
    expect(result.open).toEqual([
      { id: 'b', businessDate: '2026-09-10', amount: '30' },
      { id: 'c', businessDate: '2026-10-01', amount: '25.5' },
    ]);
    expect(result.unallocatedCredit).toBe('0');
  });

  it('keeps everything open when nothing was paid', () => {
    expect(allocateOldestFirst(charges, '0').open).toHaveLength(3);
  });

  it('reports overpayment as credit instead of ageing it', () => {
    const result = allocateOldestFirst(charges, '200.0000');
    expect(result.open).toEqual([]);
    expect(result.unallocatedCredit).toBe('24.5');
  });

  it('breaks same-day ties by ledger order', () => {
    const result = allocateOldestFirst(
      [
        { id: 'x', businessDate: '2026-10-01', amount: '10' },
        { id: 'y', businessDate: '2026-10-01', amount: '10' },
      ],
      '10',
    );
    expect(result.open.map((c) => c.id)).toEqual(['y']);
  });
});

describe('computeAccountAgeing', () => {
  const lines = [
    charge('c1', '2026-06-01', '100.0000'),
    charge('c2', '2026-08-20', '40.0000'),
    charge('c3', '2026-09-25', '10.2500'),
    charge('c4', '2026-10-23', '5.0000'),
    payment('p1', '2026-09-01', '110.0000'),
  ];

  it('ages what is left after the oldest charges are paid', () => {
    const ageing = computeAccountAgeing(lines, { asAt: '2026-10-23' });
    // p1 clears c1 (100) and 10 of c2, leaving 30 of c2.
    expect(ageing.buckets).toEqual({
      current: '5.0000',
      days1to30: '10.2500',
      days31to60: '0.0000',
      days61to90: '30.0000',
      over90: '0.0000',
    });
    expect(ageing.totalOwed).toBe('45.2500');
    expect(ageing.oldestOpenChargeDate).toBe('2026-08-20');
    expect(ageing.unallocatedCredit).toBe('0.0000');
  });

  it('keeps exact four-decimal precision with no float drift', () => {
    const ageing = computeAccountAgeing(
      [
        charge('a', '2026-10-22', '0.1000'),
        charge('b', '2026-10-22', '0.2000'),
        payment('p', '2026-10-23', '0.0001'),
      ],
      { asAt: '2026-10-23' },
    );
    expect(ageing.totalOwed).toBe('0.2999');
  });

  it('shows no age for a customer who owes nothing', () => {
    const ageing = computeAccountAgeing(
      [charge('a', '2026-01-01', '10'), payment('p', '2026-01-02', '10')],
      { asAt: '2026-10-23' },
    );
    expect(ageing.totalOwed).toBe('0.0000');
    expect(ageing.oldestOpenChargeDate).toBeNull();
  });

  it('honours payment terms when supplied', () => {
    const ageing = computeAccountAgeing([charge('a', '2026-10-01', '10')], {
      asAt: '2026-10-23',
      termsDays: 30,
    });
    expect(ageing.buckets.current).toBe('10.0000');
  });

  it('lets the allocation rule be swapped', () => {
    const ignorePayments: AllocationStrategy = (charges) => ({
      open: charges,
      unallocatedCredit: '0',
    });
    const ageing = computeAccountAgeing(
      [
        charge('old', '2026-01-01', '10'),
        charge('new', '2026-10-23', '10'),
        payment('p', '2026-10-23', '10'),
      ],
      { asAt: '2026-10-23', strategy: ignorePayments },
    );
    expect(ageing.totalOwed).toBe('20.0000');
    expect(ageing.buckets.over90).toBe('10.0000');
  });
});
