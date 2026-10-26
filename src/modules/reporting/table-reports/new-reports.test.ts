import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TABLE_REPORTS } from './definitions';
import { buildStationDailyRows } from './station-daily-report';
import { stockVarianceRow, tankWithoutDipRow } from './stock-variance';

describe('stock variances report', () => {
  // 21/10 shift sheet: petrol dip 7394 L to 5794 L with 1579.68 L sold; diesel 8722 L to 6219 L
  // with 2541.57 L sold.
  it('shows the petrol sample as short and the diesel sample as over, both yellow at 20 L', () => {
    const petrol = stockVarianceRow({
      date: '2026-10-21',
      station: 'Bindura',
      tank: 'P1',
      product: 'Petrol',
      physical: '5794.000',
      expected: '5814.320',
      variance: '-20.320',
      tolerance: '20.000',
      dayApproved: true,
    });
    const diesel = stockVarianceRow({
      date: '2026-10-21',
      station: 'Bindura',
      tank: 'D1',
      product: 'Diesel',
      physical: '6219.000',
      expected: '6180.430',
      variance: '38.570',
      tolerance: '20.000',
      dayApproved: false,
    });
    expect(petrol.signal).toMatch(/^Yellow/);
    expect(diesel.signal).toMatch(/^Yellow/);
    expect(petrol.varianceLitres).toBe('-20.320');
    expect(diesel.dayApproved).toBe('No');
  });

  it('is green inside the allowance, red beyond twice it, and never green without an allowance', () => {
    const base = {
      date: '2026-10-21',
      station: 'S',
      tank: 'T',
      product: 'Diesel',
      physical: '1000.000',
      expected: '1000.000',
      dayApproved: true,
    };
    expect(stockVarianceRow({ ...base, variance: '5.000', tolerance: '20.000' }).signal).toMatch(
      /^Green/,
    );
    expect(stockVarianceRow({ ...base, variance: '-41.000', tolerance: '20.000' }).signal).toMatch(
      /^Red/,
    );
    expect(stockVarianceRow({ ...base, variance: '0.000', tolerance: null }).signal).toMatch(
      /^Not checked/,
    );
  });
});

describe('tanks without a dip', () => {
  it('still get a line, blank where there is nothing to compare', () => {
    const row = tankWithoutDipRow({
      station: 'Bindura',
      tank: 'D2',
      product: 'Diesel',
      tolerance: null,
    });
    expect(row.signal).toBe('No dip recorded in these dates');
    expect(row.physicalLitres).toBeNull();
    expect(row.varianceLitres).toBeNull();
  });
});

describe('station daily report rows', () => {
  const diesel = { productId: 'd', productCode: 'DSL', productName: 'Diesel' };
  const petrol = { productId: 'p', productCode: 'PET', productName: 'Petrol' };
  const stationNames = new Map([['s1', 'Arcturus']]);

  it('puts diesel and petrol side by side and works out operating profit exactly', () => {
    const rows = buildStationDailyRows({
      stationNames,
      sales: [
        {
          stationId: 's1',
          businessDate: '2026-10-21',
          ...diesel,
          recognizedRevenue: '195.0000',
          quantityLitres: '100.000',
        },
        {
          stationId: 's1',
          businessDate: '2026-10-21',
          ...petrol,
          recognizedRevenue: '98.0000',
          quantityLitres: '50.000',
        },
      ],
      costs: [
        {
          stationId: 's1',
          businessDate: '2026-10-21',
          productId: 'd',
          restatedCogs: '176.0000',
          valuationStatus: 'VALUED',
        },
        {
          stationId: 's1',
          businessDate: '2026-10-21',
          productId: 'p',
          restatedCogs: '89.0000',
          valuationStatus: 'VALUED',
        },
      ],
      expenses: [
        {
          stationId: 's1',
          stationName: 'Arcturus',
          businessDate: '2026-10-21',
          classification: 'OPERATING',
          amount: '10',
          description: 'ecocash',
        },
        {
          stationId: 's1',
          stationName: 'Arcturus',
          businessDate: '2026-10-21',
          classification: 'FIXED_COST',
          amount: '116.12',
          description: 'Rent',
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-10-21',
      station: 'Arcturus',
      dieselLitres: '100.000',
      dieselSales: '195.0000',
      dieselCost: '176.0000',
      dieselGross: '19.0000',
      petrolLitres: '50.000',
      petrolGross: '9.0000',
      totalSales: '293.0000',
      totalGross: '28.0000',
      expenses: '10.0000',
      fixedCosts: '116.1200',
      totalExpenses: '126.1200',
      operatingProfit: '-98.1200',
      notes: 'ecocash 10.0000',
    });
  });

  it('leaves cost and profit blank, not zero, when a sale has no cost yet', () => {
    const [row] = buildStationDailyRows({
      stationNames,
      sales: [
        {
          stationId: 's1',
          businessDate: '2026-10-21',
          ...diesel,
          recognizedRevenue: '195.0000',
          quantityLitres: '100.000',
        },
      ],
      costs: [
        {
          stationId: 's1',
          businessDate: '2026-10-21',
          productId: 'd',
          restatedCogs: null,
          valuationStatus: 'UNVALUED',
        },
      ],
      expenses: [],
    });
    expect(row!.dieselCost).toBeNull();
    expect(row!.dieselGross).toBeNull();
    expect(row!.operatingProfit).toBeNull();
    expect(row!.petrolLitres).toBeNull();
    expect(row!.dieselSales).toBe('195.0000');
  });

  it('lists the newest day first and keeps stations apart', () => {
    const sale = (stationId: string, businessDate: string) => ({
      stationId,
      businessDate,
      ...diesel,
      recognizedRevenue: '10.0000',
      quantityLitres: '5.000',
    });
    const rows = buildStationDailyRows({
      stationNames: new Map([
        ['s1', 'Arcturus'],
        ['s2', 'Maruta'],
      ]),
      sales: [sale('s1', '2026-10-20'), sale('s2', '2026-10-21'), sale('s1', '2026-10-21')],
      costs: [],
      expenses: [],
    });
    expect(rows.map((row) => `${row.date} ${row.station}`)).toEqual([
      '2026-10-21 Arcturus',
      '2026-10-21 Maruta',
      '2026-10-20 Arcturus',
    ]);
  });
});

describe('table report pages', () => {
  it('has its own route for every table report, or the catalogue link opens the wrong view', () => {
    const missing = TABLE_REPORTS.filter(
      (report) => !existsSync(join(process.cwd(), 'src/app/reports', report.slug, 'page.tsx')),
    ).map((report) => report.slug);
    expect(missing).toEqual([]);
  });
});
