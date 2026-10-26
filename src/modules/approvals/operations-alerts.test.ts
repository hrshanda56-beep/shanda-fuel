import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_SETTINGS,
  buildOperationsAlerts,
  classifyStockVariance,
  effectiveTankTolerance,
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

describe('effectiveTankTolerance', () => {
  it("keeps a tank's own limit", () => {
    expect(effectiveTankTolerance('50.000', '10000')).toBe('50.000');
  });

  it('starts at 0.5% of the litres sold since the previous dip, so 1% is the alert line', () => {
    const tolerance = effectiveTankTolerance(null, '10000');
    expect(tolerance).toBe('50');
    expect(classifyStockVariance('50', tolerance)).toBe('ok');
    expect(classifyStockVariance('51', tolerance)).toBe('watch');
    expect(classifyStockVariance('101', tolerance)).toBe('alert');
  });

  it('does not judge a tank with no limit and nothing sold', () => {
    expect(effectiveTankTolerance(null, null)).toBeNull();
    expect(effectiveTankTolerance(null, '0')).toBeNull();
  });
});

describe('buildOperationsAlerts', () => {
  it('says nothing when everything is in order', () => {
    expect(alerts({ tanks: [tank()] })).toEqual([]);
  });

  it('starts with no grace: an unsubmitted report is late from the next day', () => {
    expect(DEFAULT_ALERT_SETTINGS.reportGraceDays).toBe(0);
    expect(alerts({ unsubmittedDates: ['2026-10-21'] })).toHaveLength(1);
  });

  it('flags a late report only after the grace period', () => {
    const oneDay = { ...DEFAULT_ALERT_SETTINGS, reportGraceDays: 1 };
    expect(alerts({ unsubmittedDates: ['2026-10-21'] }, oneDay)).toEqual([]);
    const [late] = alerts({ unsubmittedDates: ['2026-10-20'] }, oneDay);
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

  it('judges a tank with two limits: yellow to explain, red to act on', () => {
    // Yellow above 20 L, red above 50 L (not the old fixed twice-the-yellow 40 L).
    const judge = (variance: string) => classifyStockVariance(variance, '20', '50');
    expect(judge('-20')).toBe('ok');
    expect(judge('-45')).toBe('watch');
    expect(judge('50')).toBe('watch');
    expect(judge('-51')).toBe('alert');
    // With no red limit it is still twice the yellow limit.
    expect(classifyStockVariance('-45', '20')).toBe('alert');
    expect(classifyStockVariance('-45', '20', null)).toBe('alert');
    // No yellow limit, or no dip: not judged, never green.
    expect(classifyStockVariance('-45', null, '50')).toBe('unjudged');
    expect(classifyStockVariance(null, '20', '50')).toBe('unjudged');
  });

  it('does not call an empty tank low before its opening stock has been entered', () => {
    const empty = { expectedLitres: '0.000', reorderLevelLitres: '1000.000' };
    expect(alerts({ tanks: [tank({ ...empty, openingStockRecorded: false })] })).toEqual([]);
    // Once the opening stock is in, an empty tank is genuinely low.
    expect(
      alerts({ tanks: [tank({ ...empty, openingStockRecorded: true })] }).map((item) => item.id),
    ).toEqual(['stock-low-t1']);
    // A tank that already holds fuel (a delivery before the opening was entered) is judged normally.
    expect(
      alerts({
        tanks: [
          tank({
            expectedLitres: '500.000',
            reorderLevelLitres: '1000.000',
            openingStockRecorded: false,
          }),
        ],
      }).map((item) => item.id),
    ).toEqual(['stock-low-t1']);
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

describe('closed without a reconciliation', () => {
  it('flags a closed day that still has no reconciliation', () => {
    const [alert] = alerts({ closedUnreconciledDates: ['2026-10-20'] });
    expect(alert?.id).toBe('closed-without-reconciliation');
    expect(alert?.title).toContain('2026-10-20');
    expect(alert?.href).toBe('/stations/st-1/reconciliations');
  });

  it('says nothing when every closed day has its reconciliation', () => {
    expect(alerts({ closedUnreconciledDates: [] })).toEqual([]);
  });
});
