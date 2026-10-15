import type { MeterView, MyShiftData, MyShiftView, StepState } from './my-shift-state';

/**
 * Presentation-only roll-up of what My shift already knows: counts for the key
 * figures and the exceptions worth surfacing. It reads the derived view and
 * never decides what is due; that stays in `deriveMyShiftView`.
 */
export type MyShiftFigures = {
  /** Readings recorded so far (opening + closing across every nozzle). */
  completed: number;
  /** Readings still to record, whether or not they are due yet. */
  pending: number;
  /** Readings that are due right now. */
  due: number;
  total: number;
};

export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  /** Present when the attendant can act on it from this page. */
  nozzleId?: string;
};

const BOUNDARIES = ['opening', 'closing'] as const;

export function summariseFigures(view: MyShiftView): MyShiftFigures {
  let completed = 0;
  let due = 0;
  for (const meter of view.meters) {
    for (const key of BOUNDARIES) {
      const state: StepState = meter[key].state;
      if (state === 'done') completed += 1;
      if (state === 'due') due += 1;
    }
  }
  const total = view.meters.length * BOUNDARIES.length;
  return { completed, pending: total - completed, due, total };
}

/** Longest list shown before the rest are summarised. */
export const ATTENTION_LIMIT = 5;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function meterAttention(meter: MeterView, canCapture: boolean, overdue: boolean): AttentionItem[] {
  const items: AttentionItem[] = [];
  const seen = new Set<string>();
  for (const key of BOUNDARIES) {
    const step = meter[key];
    if (step.state !== 'needs_supervisor' && step.state !== 'blocked') continue;
    const reason =
      step.state === 'needs_supervisor'
        ? `${key} reading unreadable`
        : lowerFirst(step.text.replace(/\.?\s*Tell your supervisor\.?$/, ''));
    // The same problem on both boundaries (e.g. no meter installed) is listed once.
    if (seen.has(reason)) continue;
    seen.add(reason);
    items.push({
      id: `${meter.meter.nozzleId}:${key}`,
      title: `${meter.label}: ${reason}`,
      detail: 'Tell your supervisor.',
    });
  }
  if (overdue && meter.closing.state === 'due') {
    items.push({
      id: `${meter.meter.nozzleId}:overdue`,
      title: `${meter.label}: closing reading is overdue`,
      detail: 'The shift has ended.',
      ...(canCapture ? { nozzleId: meter.meter.nozzleId } : {}),
    });
  } else if (overdue && meter.opening.state === 'due') {
    items.push({
      id: `${meter.meter.nozzleId}:late-open`,
      title: `${meter.label}: opening reading is missing`,
      detail: 'Closing needs it first.',
      ...(canCapture ? { nozzleId: meter.meter.nozzleId } : {}),
    });
  }
  return items;
}

export function summariseAttention(data: MyShiftData, view: MyShiftView): AttentionItem[] {
  const shift = data.shift;
  const overdue =
    view.phase === 'running' && !!shift && Date.parse(data.now) >= Date.parse(shift.plannedEndAt);
  return view.meters.flatMap((meter) => meterAttention(meter, data.canCapture, overdue));
}
