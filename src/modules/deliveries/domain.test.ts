import { describe, expect, it } from 'vitest';
import {
  assertWaterTestOnRecord,
  checkCompartments,
  checkDriverConfirmation,
  checkWaterTest,
  classifyCompartmentVariance,
  classifyDeliveryReceipt,
  type CompartmentInput,
} from './domain';

const product = '00000000-0000-4000-8000-0000000000aa';

function compartment(overrides: Partial<CompartmentInput> = {}): CompartmentInput {
  return {
    compartmentNumber: 1,
    productId: product,
    noteLitres: '5000.000',
    receivedLitres: '5000.000',
    seals: [{ sealNumber: 'S-100', intact: true }],
    ...overrides,
  };
}

describe('classifyDeliveryReceipt', () => {
  it('flags partial, full and excess receipts exactly', () => {
    expect(classifyDeliveryReceipt('10000.000', '9999.999')).toBe('PARTIAL');
    expect(classifyDeliveryReceipt('10000', '10000.000')).toBe('FULL');
    expect(classifyDeliveryReceipt('10000.000', '10000.001')).toBe('EXCESS');
  });
  it('rejects negative litres', () => {
    expect(() => classifyDeliveryReceipt('-1', '1')).toThrow(/negative/);
  });
  it('classifies a compartment as short, over or ok', () => {
    expect(classifyCompartmentVariance('5000', '4990')).toBe('SHORT');
    expect(classifyCompartmentVariance('5000', '5000')).toBe('OK');
    expect(classifyCompartmentVariance('5000', '5001')).toBe('OVER');
  });
});

describe('checkCompartments', () => {
  const base = {
    deliveryProductId: product,
    deliveryNoteLitres: '10000.000',
    deliveryReceivedLitres: '9990.000',
  };

  it('adds up exactly and reports shortages per compartment', () => {
    const result = checkCompartments({
      ...base,
      compartments: [
        compartment({ compartmentNumber: 2, noteLitres: '5000', receivedLitres: '4990' }),
        compartment({ compartmentNumber: 1 }),
      ],
    });
    expect(result.compartments.map((c) => c.compartmentNumber)).toEqual([1, 2]);
    expect(result.totalNoteLitres).toBe('10000');
    expect(result.totalReceivedLitres).toBe('9990');
    expect(result.shortCompartments).toBe(1);
    expect(result.compartments[1]?.varianceLitres).toBe('-10');
  });

  it('does not lose precision on thousandths', () => {
    const result = checkCompartments({
      deliveryProductId: product,
      deliveryNoteLitres: '0.3',
      deliveryReceivedLitres: '0.3',
      compartments: [
        compartment({ compartmentNumber: 1, noteLitres: '0.1', receivedLitres: '0.1' }),
        compartment({ compartmentNumber: 2, noteLitres: '0.2', receivedLitres: '0.2' }),
      ],
    });
    expect(result.totalNoteLitres).toBe('0.3');
  });

  it('rejects totals that disagree with the delivery', () => {
    expect(() =>
      checkCompartments({
        ...base,
        compartments: [
          compartment({ receivedLitres: '4000' }),
          compartment({ compartmentNumber: 2 }),
        ],
      }),
    ).toThrow(/litres received/);
    expect(() =>
      checkCompartments({ ...base, compartments: [compartment({ noteLitres: '4000' })] }),
    ).toThrow(/litres on the note/);
  });

  it('rejects empty, duplicated or out-of-range compartments', () => {
    expect(() => checkCompartments({ ...base, compartments: [] })).toThrow(/at least one/);
    expect(() =>
      checkCompartments({ ...base, compartments: [compartment(), compartment()] }),
    ).toThrow(/more than once/);
    expect(() =>
      checkCompartments({ ...base, compartments: [compartment({ compartmentNumber: 0 })] }),
    ).toThrow(/whole numbers/);
  });

  it('rejects a compartment carrying a different fuel', () => {
    expect(() =>
      checkCompartments({
        ...base,
        compartments: [compartment({ productId: '00000000-0000-4000-8000-0000000000bb' })],
      }),
    ).toThrow(/same fuel/);
  });

  it('requires a seal number whenever a seal is listed', () => {
    expect(() =>
      checkCompartments({
        deliveryProductId: product,
        deliveryNoteLitres: '5000',
        deliveryReceivedLitres: '5000',
        compartments: [compartment({ seals: [{ sealNumber: '   ', intact: true }] })],
      }),
    ).toThrow(/seal number/);
  });

  it('rejects a repeated seal number and counts broken seals', () => {
    const single = {
      deliveryProductId: product,
      deliveryNoteLitres: '5000',
      deliveryReceivedLitres: '5000',
    };
    expect(() =>
      checkCompartments({
        ...single,
        compartments: [
          compartment({
            seals: [
              { sealNumber: 'A1', intact: true },
              { sealNumber: ' a1 ', intact: true },
            ],
          }),
        ],
      }),
    ).toThrow(/twice/);
    const result = checkCompartments({
      ...single,
      compartments: [
        compartment({
          seals: [
            { sealNumber: 'A1', intact: true },
            { sealNumber: 'A2', intact: false },
          ],
        }),
      ],
    });
    expect(result.brokenSeals).toBe(1);
    expect(result.compartments[0]?.allSealsIntact).toBe(false);
  });

  it('allows a compartment with no seals at all', () => {
    const result = checkCompartments({
      deliveryProductId: product,
      deliveryNoteLitres: '5000',
      deliveryReceivedLitres: '5000',
      compartments: [compartment({ seals: [] })],
    });
    expect(result.compartments[0]?.seals).toEqual([]);
    expect(result.brokenSeals).toBe(0);
  });
});

describe('water test', () => {
  it('records pass or fail with an optional reading', () => {
    expect(checkWaterTest({ result: 'PASS' })).toEqual({ result: 'PASS', waterReadingMm: null });
    expect(checkWaterTest({ result: 'FAIL', waterReadingMm: '2.5' }).waterReadingMm).toBe('2.5');
    expect(() => checkWaterTest({ result: 'PASS', waterReadingMm: '-1' })).toThrow(/millimetres/);
  });
  it('only blocks when the owner switch is on', () => {
    expect(() => assertWaterTestOnRecord({ required: false, hasWaterTest: false })).not.toThrow();
    expect(() => assertWaterTestOnRecord({ required: true, hasWaterTest: true })).not.toThrow();
    expect(() => assertWaterTestOnRecord({ required: true, hasWaterTest: false })).toThrow(
      /water test/,
    );
  });
});

describe('driver confirmation', () => {
  const now = new Date('2026-10-23T08:00:00Z');
  it('needs a name and defaults the time to now when confirmed', () => {
    expect(() => checkDriverConfirmation({ driverName: ' ', confirmed: true, now })).toThrow(
      /driver/,
    );
    const confirmed = checkDriverConfirmation({ driverName: ' T. Moyo ', confirmed: true, now });
    expect(confirmed).toEqual({ driverName: 'T. Moyo', confirmed: true, confirmedAt: now });
  });
  it('keeps no time when the driver has not confirmed', () => {
    expect(
      checkDriverConfirmation({
        driverName: 'T. Moyo',
        confirmed: false,
        confirmedAt: '2026-10-23T07:00:00Z',
        now,
      }).confirmedAt,
    ).toBeNull();
  });
  it('rejects a time in the future', () => {
    expect(() =>
      checkDriverConfirmation({
        driverName: 'T. Moyo',
        confirmed: true,
        confirmedAt: '2026-10-24T07:00:00Z',
        now,
      }),
    ).toThrow(/future/);
  });
});
