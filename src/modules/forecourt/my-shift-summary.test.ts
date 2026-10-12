import { describe, expect, it } from 'vitest';

import { summariseAttention, summariseFigures } from './my-shift-summary';
import { deriveMyShiftView, type MyShiftData, type MyShiftMeter } from './my-shift-state';

const NOW = Date.parse('2026-10-10T10:00:00Z');
const hour = 3_600_000;

function meter(n: number, over: Partial<MyShiftMeter> = {}): MyShiftMeter {
  return {
    nozzleId: `n${n}`,
    meterInstallationId: `i${n}`,
    pumpNumber: '1',
    nozzleNumber: String(n),
    productName: 'Diesel',
    previousReading: '10.000',
    opening: null,
    closing: null,
    ...over,
  };
}
const rec = (value: string) => ({
  status: 'RECORDED' as const,
  value,
  recordedAt: '2026-10-10T07:00:00Z',
});

function data(meters: MyShiftMeter[], endOffset = 4 * hour, state = 'OPEN'): MyShiftData {
  return {
    station: { id: 's', name: 'Harare', timezone: 'Africa/Harare' },
    tenantId: 't',
    legalEntityId: 'e',
    now: new Date(NOW).toISOString(),
    responsibleAttendantId: 'a',
    canCapture: true,
    shift: {
      id: 'sh',
      businessDayId: 'd',
      label: 'Day',
      state,
      businessDayState: 'OPEN',
      plannedStartAt: new Date(NOW - 4 * hour).toISOString(),
      plannedEndAt: new Date(NOW + endOffset).toISOString(),
      version: 1,
    },
    meters,
  };
}

describe('summariseFigures', () => {
  it('counts completed, pending and due readings across nozzles', () => {
    const d = data([meter(1, { opening: rec('10.000') }), meter(2)]);
    expect(summariseFigures(deriveMyShiftView(d))).toEqual({
      completed: 1,
      pending: 3,
      due: 1,
      total: 4,
    });
  });

  it('is all zero with no meters', () => {
    expect(summariseFigures(deriveMyShiftView(data([])))).toEqual({
      completed: 0,
      pending: 0,
      due: 0,
      total: 0,
    });
  });
});

describe('summariseAttention', () => {
  it('has nothing for a healthy running shift', () => {
    const d = data([meter(1, { opening: rec('10.000') }), meter(2)]);
    expect(summariseAttention(d, deriveMyShiftView(d))).toEqual([]);
  });

  it('surfaces unreadable and missing meters for the supervisor', () => {
    const d = data([
      meter(1, { opening: { status: 'UNAVAILABLE', recordedAt: 'x' } }),
      meter(2, { meterInstallationId: null }),
    ]);
    const items = summariseAttention(d, deriveMyShiftView(d));
    expect(items.map((i) => i.id)).toEqual(['n1:opening', 'n2:opening']);
    expect(items.map((i) => i.title)).toEqual([
      'Pump 1 · Nozzle 1: opening reading unreadable',
      'Pump 1 · Nozzle 2: no meter is set up',
    ]);
    expect(items.every((i) => i.nozzleId === undefined)).toBe(true);
  });

  it('flags overdue closing readings as actionable once the shift has ended', () => {
    const d = data([meter(1, { opening: rec('10.000') })], -hour);
    const items = summariseAttention(d, deriveMyShiftView(d));
    expect(items).toEqual([expect.objectContaining({ id: 'n1:overdue', nozzleId: 'n1' })]);
  });

  it('flags a missing opening reading after the shift ended', () => {
    const d = data([meter(1)], -hour);
    expect(summariseAttention(d, deriveMyShiftView(d)).map((i) => i.id)).toEqual(['n1:late-open']);
  });

  it('is quiet for a finished shift with everything recorded', () => {
    const d = data(
      [meter(1, { opening: rec('10.000'), closing: rec('20.000') })],
      -hour,
      'COMPLETED',
    );
    expect(summariseAttention(d, deriveMyShiftView(d))).toEqual([]);
  });
});
