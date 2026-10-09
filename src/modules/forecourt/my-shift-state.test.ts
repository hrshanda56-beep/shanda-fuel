import { describe, expect, it } from 'vitest';

import {
  checkReading,
  compareDecimalText,
  deriveMyShiftView,
  formatShiftWindow,
  pickCurrentShift,
  type MyShiftData,
  type MyShiftMeter,
} from './my-shift-state';

const NOW = '2026-10-09T09:00:00.000Z';
const START = '2026-10-09T04:00:00.000Z';
const END = '2026-10-09T16:00:00.000Z';

function meter(overrides: Partial<MyShiftMeter> = {}): MyShiftMeter {
  return {
    nozzleId: 'nozzle-1',
    meterInstallationId: 'install-1',
    pumpNumber: '1',
    nozzleNumber: '2',
    productName: 'Diesel',
    previousReading: '1000.000',
    opening: null,
    closing: null,
    ...overrides,
  };
}

function data(overrides: Partial<MyShiftData> = {}): MyShiftData {
  return {
    station: { id: 's', name: 'Bindura', timezone: 'Africa/Harare' },
    tenantId: 't',
    legalEntityId: 'le',
    now: NOW,
    responsibleAttendantId: 'm',
    canCapture: true,
    shift: {
      id: 'shift',
      businessDayId: 'day',
      label: 'Day shift',
      state: 'OPEN',
      businessDayState: 'OPEN',
      plannedStartAt: START,
      plannedEndAt: END,
      version: 3,
    },
    meters: [meter()],
    ...overrides,
  };
}

describe('pickCurrentShift', () => {
  const row = (id: string, state: string, start: string, end: string, day = 'OPEN') => ({
    id,
    state,
    businessDayState: day,
    plannedStartAt: start,
    plannedEndAt: end,
  });
  const now = Date.parse(NOW);

  it('prefers the running shift over a planned one', () => {
    const picked = pickCurrentShift(
      [
        row('planned', 'PLANNED', START, END),
        row('running', 'OPEN', '2026-10-09T02:00:00Z', '2026-10-09T10:00:00Z'),
      ],
      now,
    );
    expect(picked?.id).toBe('running');
  });

  it('falls back to the planned shift covering now, then the next upcoming one', () => {
    expect(pickCurrentShift([row('a', 'PLANNED', START, END)], now)?.id).toBe('a');
    const later = row('later', 'PLANNED', '2026-10-09T16:00:00Z', '2026-10-10T04:00:00Z');
    expect(pickCurrentShift([later], now)?.id).toBe('later');
  });

  it('shows the most recently finished shift when nothing else applies', () => {
    const picked = pickCurrentShift(
      [
        row('old', 'COMPLETED', '2026-10-08T04:00:00Z', '2026-10-08T16:00:00Z'),
        row('recent', 'METER_CLOSED', '2026-10-09T00:00:00Z', '2026-10-09T08:00:00Z'),
      ],
      now,
    );
    expect(picked?.id).toBe('recent');
  });

  it('ignores planned shifts on a business day that is not usable', () => {
    expect(pickCurrentShift([row('a', 'PLANNED', START, END, 'LOCKED')], now)).toBeNull();
    expect(pickCurrentShift([], now)).toBeNull();
  });
});

describe('deriveMyShiftView', () => {
  it('has nothing to do and no action when there is no shift', () => {
    const view = deriveMyShiftView(data({ shift: null, meters: [] }));
    expect(view.phase).toBe('no_shift');
    expect(view.next.kind).toBe('none');
  });

  it('asks for the opening reading first on a running shift', () => {
    const view = deriveMyShiftView(data());
    expect(view.phase).toBe('running');
    expect(view.meters[0]?.opening.state).toBe('due');
    expect(view.meters[0]?.closing).toMatchObject({ state: 'waiting' });
    expect(view.next).toMatchObject({
      kind: 'record',
      boundary: 'SHIFT_OPEN',
      nozzleId: 'nozzle-1',
    });
  });

  it('shows the closing reading as not yet due before the shift ends', () => {
    const view = deriveMyShiftView(
      data({
        meters: [meter({ opening: { status: 'RECORDED', value: '1000.000', recordedAt: NOW } })],
      }),
    );
    expect(view.meters[0]?.opening).toMatchObject({ state: 'done', value: '1000.000' });
    expect(view.meters[0]?.closing.state).toBe('not_due');
    expect(view.next.kind).toBe('none');
  });

  it('makes the closing reading due once the planned end has passed', () => {
    const view = deriveMyShiftView(
      data({
        now: '2026-10-09T16:05:00.000Z',
        meters: [meter({ opening: { status: 'RECORDED', value: '1000.000', recordedAt: NOW } })],
      }),
    );
    expect(view.meters[0]?.closing.state).toBe('due');
    expect(view.next).toMatchObject({ kind: 'record', boundary: 'SHIFT_CLOSE' });
  });

  it('waits for the supervisor when the shift is only planned', () => {
    const view = deriveMyShiftView(data({ shift: { ...data().shift!, state: 'PLANNED' } }));
    expect(view.phase).toBe('waiting_to_start');
    expect(view.meters[0]?.opening.state).toBe('waiting');
    expect(view.next.kind).toBe('none');
  });

  it('never offers a record action when the attendant cannot capture', () => {
    const view = deriveMyShiftView(data({ canCapture: false }));
    expect(view.next.kind).toBe('none');
  });

  it('blocks a nozzle that has no meter installed', () => {
    const view = deriveMyShiftView(data({ meters: [meter({ meterInstallationId: null })] }));
    expect(view.meters[0]?.opening.state).toBe('blocked');
    expect(view.next.kind).toBe('none');
  });

  it('routes an unavailable reading to the supervisor instead of offering a fix', () => {
    const view = deriveMyShiftView(
      data({ meters: [meter({ opening: { status: 'UNAVAILABLE', recordedAt: NOW } })] }),
    );
    expect(view.meters[0]?.opening.state).toBe('needs_supervisor');
  });

  it('reports a finished shift without any action', () => {
    const view = deriveMyShiftView(
      data({
        shift: { ...data().shift!, state: 'COMPLETED' },
        meters: [
          meter({
            opening: { status: 'RECORDED', value: '1000.000', recordedAt: NOW },
            closing: { status: 'RECORDED', value: '1100.500', recordedAt: NOW },
          }),
        ],
      }),
    );
    expect(view.phase).toBe('finished');
    expect(view.next.kind).toBe('none');
  });
});

describe('reading input', () => {
  it('compares decimals exactly', () => {
    expect(compareDecimalText('1000.5', '1000.50')).toBe(0);
    expect(compareDecimalText('999.999', '1000')).toBe(-1);
    expect(compareDecimalText('12345678901.001', '12345678901.000')).toBe(1);
  });

  it('gives plain-language messages for bad input', () => {
    expect(checkReading('', { boundary: 'SHIFT_OPEN' })).toMatchObject({ ok: false });
    expect(checkReading('abc', { boundary: 'SHIFT_OPEN' })).toMatchObject({ ok: false });
    expect(checkReading('-5', { boundary: 'SHIFT_OPEN' })).toMatchObject({
      message: 'A meter reading cannot be negative.',
    });
    expect(checkReading('1.2345', { boundary: 'SHIFT_OPEN' })).toMatchObject({ ok: false });
  });

  it('accepts thousands separators and trims spaces', () => {
    expect(checkReading(' 1,234.5 ', { boundary: 'SHIFT_OPEN' })).toEqual({
      ok: true,
      value: '1234.5',
    });
  });

  it('requires the opening reading to match the previous sealed reading', () => {
    expect(checkReading('1000', { boundary: 'SHIFT_OPEN', previousReading: '1000.000' })).toEqual({
      ok: true,
      value: '1000',
    });
    const result = checkReading('1001', { boundary: 'SHIFT_OPEN', previousReading: '1000.000' });
    expect(result.ok).toBe(false);
  });

  it('rejects a closing reading lower than the opening reading', () => {
    expect(checkReading('999', { boundary: 'SHIFT_CLOSE', openingValue: '1000.000' }).ok).toBe(
      false,
    );
    expect(checkReading('1000', { boundary: 'SHIFT_CLOSE', openingValue: '1000.000' }).ok).toBe(
      true,
    );
  });
});

describe('formatShiftWindow', () => {
  it('uses the station time zone', () => {
    expect(formatShiftWindow(START, END, 'Africa/Harare')).toBe('06:00–18:00');
  });
});
