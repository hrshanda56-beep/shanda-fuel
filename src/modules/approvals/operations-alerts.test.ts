import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_SETTINGS,
  buildOperationsAlerts,
  classifyStockVariance,
  daysBetween,
  type OperationsFacts,
  type TankAlertFacts,
} from './operations-alerts';

const station = { id: 'st-1' };
const quiet: OperationsFacts = {
  today: '2026-10-21',
  unsubmittedDates: [],
  cashShortages: [],
  tanks: [],
  unsettledPaymentDates: [],
};
const tank = (over: Partial<TankAlertFacts> = {}): TankAlertFacts => ({
  tankId: 't1',
  tankCode: 'Tank 1',
  productName: 'Diesel',
  expectedLitres: '5000.000',
  physicalLitres: '5000.000',
  varianceAtDipLitres: '0.000',
  toleranceLitres: '50.000',
  reorderLevelLitres: null,
  ...over,
});
const alerts = (facts: Partial<OperationsFacts>, settings = DEFAULT_ALERT_SETTINGS) =>
  buildOperationsAlerts({ ...quiet, ...facts }, settings, station);

describe('classifyStockVariance', () => {
  it.each([
    ['0', '50', 'ok'],
    ['50', '50', 'ok'],
    ['-50.000', '50', 'ok'],
    ['50.001', '50', 'watch'],
    ['-100', '50', 'watch'],
    ['100.001', '50', 'alert'],
    ['-400', '50', 'alert'],
  ])('variance %s with tolerance %s is %s', (variance, tolerance, expected) => {
    expect(classifyStockVariance(variance, tolerance)).toBe(expected);
  });

  it('never calls a tank green when it cannot be judged', () => {
    expect(classifyStockVariance(null, '50')).toBe('unjudged');
    expect(classifyStockVariance('10', null)).toBe('unjudged');
    expect(classifyStockVariance('10', '-1')).toBe('unjudged');
  });
});

describe('buildOperationsAlerts', () => {
  it('says nothing when everything is in order', () => {
    expect(alerts({ tanks: [tank()] })).toEqual([]);
  });

  it('flags a late report only after the grace period', () => {
    expect(alerts({ unsubmittedDates: ['2026-10-21'] })).toEqual([]);
    const [late] = alerts({ unsubmittedDates: ['2026-10-20'] });
    expect(late).toMatchObject({
      id: 'reports-late',
      title: 'The report for 2026-10-20 has not been submitted',
      tone: 'attention',
      href: '/stations/st-1/reconciliations',
    });
    expect(alerts({ unsubmittedDates: ['2026-10-18', '2026-10-19'] })[0]!.title).toBe(
      '2 daily reports have not been submitted',
    );
  });

  it('reports cash shortages above the minimum, three at most, then a roll-up', () => {
    const items = alerts({
      cashShortages: [
        { businessDate: '2026-10-20', amount: '12.5000' },
        { businessDate: '2026-10-19', amount: '0.0050' },
        { businessDate: '2026-10-18', amount: '3.0000' },
        { businessDate: '2026-10-17', amount: '4.0000' },
        { businessDate: '2026-10-16', amount: '5.0000' },
      ],
    });
    expect(items.map((item) => item.id)).toEqual([
      'cash-short-2026-10-20',
      'cash-short-2026-10-18',
      'cash-short-2026-10-17',
      'cash-short-more',
    ]);
    expect(items[0]!.title).toBe('Cash was $12.5000 short on 2026-10-20');
  });

  it('warns about stock outside tolerance with the right urgency and direction', () => {
    const watch = alerts({ tanks: [tank({ varianceAtDipLitres: '-80.000' })] })[0]!;
    expect(watch).toMatchObject({ id: 'stock-variance-t1', tone: 'info' });
    expect(watch.title).toContain('under book stock');
    const red = alerts({ tanks: [tank({ varianceAtDipLitres: '300.000' })] })[0]!;
    expect(red).toMatchObject({ tone: 'attention' });
    expect(red.title).toContain('over book stock');
  });

  it('flags a tank at or below its reorder level', () => {
    const items = alerts({
      tanks: [tank({ expectedLitres: '1000.000', reorderLevelLitres: '1000.000' })],
    });
    expect(items.map((item) => item.id)).toEqual(['stock-low-t1']);
    expect(alerts({ tanks: [tank({ reorderLevelLitres: '1000.000' })] })).toEqual([]);
  });

  it('flags card and mobile payments only once they pass the settlement lag', () => {
    expect(alerts({ unsettledPaymentDates: ['2026-10-18'] })).toEqual([]);
    const [item] = alerts({ unsettledPaymentDates: ['2026-10-17', '2026-10-10', '2026-10-20'] });
    expect(item).toMatchObject({ id: 'settlements-overdue', tone: 'attention' });
    expect(item!.title).toBe('2 card or mobile payments are overdue for settlement');
  });

  it('respects overridden thresholds', () => {
    const settings = { ...DEFAULT_ALERT_SETTINGS, reportGraceDays: 3, posSettlementLagDays: 0 };
    expect(alerts({ unsubmittedDates: ['2026-10-20'] }, settings)).toEqual([]);
    expect(alerts({ unsettledPaymentDates: ['2026-10-20'] }, settings)).toHaveLength(1);
  });
});

describe('daysBetween', () => {
  it('counts calendar days across month ends', () => {
    expect(daysBetween('2026-09-29', '2026-10-02')).toBe(3);
  });
});
