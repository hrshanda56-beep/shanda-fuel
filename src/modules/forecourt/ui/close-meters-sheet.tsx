'use client';

import Decimal from 'decimal.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { InlineError } from '../../../design-system/inline-error';
import { Select } from '../../../design-system/forms';
import { Modal } from '../../../design-system/modal';
import { Button, Field, LoadingState, NumericInput } from '../../../design-system/primitives';
import { formatLitres } from '../../../design-system/formatters';
import {
  describeFailure,
  type UserMessage,
  userMessage,
} from '../../../design-system/user-messages';
import { shiftLabel } from './shift-labels';
import { replayCloseMeters, type CloseMetersJournal } from './close-meters-retry';

type Nozzle = {
  nozzleId: string;
  pumpNumber: string;
  nozzleNumber: string;
  productId: string;
  productName: string;
  meterInstallationId: string | null;
  previousReading: string | null;
};

type DailyContext = {
  attendants: Array<{ id: string; name: string }>;
  availableReadings: Nozzle[];
};

type Ids = { open: string; close: string; segment: string };

export const closedMetersKey = (shiftId: string) => `sf-closed-meters:${shiftId}`;

function toDecimal(value: string): Decimal | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const reading = new Decimal(trimmed);
  return reading.decimalPlaces() <= 3 && reading.lte('999999999999999.999') ? reading : null;
}

/**
 * Close meters: one row per nozzle on the shift with the opening reading (read-only), a required closing
 * reading and the litres worked out live. Sending it records every closing boundary, seals the segments
 * and closes the shift. The sheet is the confirmation, so there is no second dialog.
 */
export function CloseMetersSheet({
  open,
  tenantId,
  stationId,
  businessDayId,
  shiftId,
  shiftVersion,
  plannedStartAt,
  plannedEndAt,
  timezone,
  onClose,
  onClosed,
}: Readonly<{
  open: boolean;
  tenantId: string;
  stationId: string;
  businessDayId: string;
  shiftId: string;
  shiftVersion: number;
  plannedStartAt: string;
  plannedEndAt: string;
  timezone: string;
  onClose: () => void;
  onClosed: () => void;
}>) {
  const [context, setContext] = useState<DailyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UserMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const journal = useRef<CloseMetersJournal | null>(null);
  const journalKey = `sf-close-attempt:v1:${tenantId}:${stationId}:${shiftId}`;
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  // Responsible attendant per nozzle; nozzles not listed default to the first attendant.
  const [attendantByNozzle, setAttendantByNozzle] = useState<Record<string, string>>({});
  // Stable ids so a retry after a partial failure replays the same commands instead of duplicating them.
  const ids = useRef(new Map<string, Ids>());
  const firstInput = useRef<HTMLDivElement>(null);

  const idsFor = useCallback((nozzleId: string): Ids => {
    let value = ids.current.get(nozzleId);
    if (!value) {
      value = {
        open: crypto.randomUUID(),
        close: crypto.randomUUID(),
        segment: crypto.randomUUID(),
      };
      ids.current.set(nozzleId, value);
    }
    return value;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tenantId, stationId, businessDayId, shiftId });
      const response = await fetch(`/api/forecourt/operations/daily?${params}`, {
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => ({}))) as DailyContext & {
        error?: string;
        message?: string;
      };
      if (!response.ok) throw describeFailure(response.status, body.error, body.message);
      setContext(body);
    } catch (caught) {
      setError(isUserMessage(caught) ? caught : userMessage('UNKNOWN'));
    } finally {
      setLoading(false);
    }
  }, [businessDayId, shiftId, stationId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = sessionStorage.getItem(journalKey);
        if (saved) {
          journal.current = { ...(JSON.parse(saved) as CloseMetersJournal), uncertain: true };
          setClosing(
            Object.fromEntries(journal.current.readings.map((row) => [row.nozzleId, row.closing])),
          );
          setOpening(
            Object.fromEntries(journal.current.readings.map((row) => [row.nozzleId, row.opening])),
          );
          setPending(true);
        }
      } catch {
        /* The current mounted attempt still supports retries. */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [journalKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo(
    () =>
      [...(context?.availableReadings ?? [])].sort((a, b) =>
        `${a.pumpNumber}.${a.nozzleNumber}`.localeCompare(
          `${b.pumpNumber}.${b.nozzleNumber}`,
          undefined,
          {
            numeric: true,
          },
        ),
      ),
    [context],
  );

  const computed = rows.map((row) => {
    const openingValue =
      (pending ? opening[row.nozzleId] : row.previousReading) ?? opening[row.nozzleId] ?? '';
    const open = toDecimal(openingValue);
    const close = toDecimal(closing[row.nozzleId] ?? '');
    const below = open !== null && close !== null && close.lt(open);
    return {
      row,
      openingValue,
      open,
      close,
      litres: open !== null && close !== null && !below ? close.minus(open) : null,
      problem:
        close === null
          ? 'Enter the closing reading.'
          : open === null
            ? 'Enter the opening reading.'
            : below
              ? 'The closing reading can’t be lower than the opening reading.'
              : null,
    };
  });
  const attendants = context?.attendants ?? [];
  const complete = computed.length > 0 && computed.every((item) => item.problem === null);
  const reason =
    computed.length === 0
      ? 'This station has no pumps set up yet.'
      : 'Enter a closing reading for every pump to continue.';

  async function post(body: Record<string, unknown>, key: string) {
    const response = await fetch('/api/forecourt/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      throw {
        ...describeFailure(response.status, failure.error, failure.message),
        definitiveRejection: [400, 401, 403, 404, 409, 422].includes(response.status),
      };
    }
  }

  async function submit() {
    setTouched(true);
    if (busy) return;
    if (journal.current) {
      await finishAttempt(journal.current);
      return;
    }
    if (!complete || !context) return;
    const defaultAttendant = context.attendants[0];
    if (!defaultAttendant) {
      setError(userMessage('STATION_NOT_SET_UP'));
      return;
    }
    const attendantFor = (nozzleId: string) => {
      const chosen = attendantByNozzle[nozzleId];
      return context.attendants.some((entry) => entry.id === chosen)
        ? chosen!
        : defaultAttendant.id;
    };
    const commands: CloseMetersJournal['commands'] = [];
    const enqueue = async (body: Record<string, unknown>, key: string) => {
      commands.push({ body, key });
    };
    const base = { tenantId, stationId, businessDayId, shiftId };
    // A segment can only be sealed once its interval has ended, so it ends now (or at the planned end).
    const segmentEnd = closingIntervalEnd(plannedEndAt);
    try {
      for (const item of computed) {
        const { row } = item;
        if (!row.meterInstallationId) throw userMessage('STATION_NOT_SET_UP');
        const id = idsFor(row.nozzleId);
        const attendantId = attendantFor(row.nozzleId);
        const nozzle = {
          nozzleId: row.nozzleId,
          meterInstallationId: row.meterInstallationId,
          responsibleAttendantId: attendantId,
          readingStatus: 'AVAILABLE',
          // Boundary and segment commands are versioned against the shift they belong to.
          expectedVersion: shiftVersion,
        };
        await enqueue(
          {
            commandType: 'ConfirmBoundary',
            ...base,
            ...nozzle,
            boundaryId: id.open,
            reason: 'SHIFT_OPEN',
            readingValue: item.open!.toFixed(),
            // With no earlier reading on record the opening figure is a controlled first entry.
            ...(row.previousReading === null
              ? { exceptionReason: 'First meter reading on record for this pump' }
              : {}),
          },
          `close-meters-open-${id.open}`,
        );
        await enqueue(
          {
            commandType: 'ConfirmBoundary',
            ...base,
            ...nozzle,
            boundaryId: id.close,
            reason: 'SHIFT_CLOSE',
            readingValue: item.close!.toFixed(),
          },
          `close-meters-close-${id.close}`,
        );
        await enqueue(
          {
            commandType: 'SealSegment',
            ...base,
            segmentId: id.segment,
            nozzleId: row.nozzleId,
            meterInstallationId: row.meterInstallationId,
            productId: row.productId,
            responsibleAttendantId: attendantId,
            openingBoundaryId: id.open,
            closingBoundaryId: id.close,
            startAt: plannedStartAt,
            endAt: segmentEnd,
            // A new segment starts at version 0 (only boundaries are versioned against the shift).
            expectedVersion: 0,
          },
          `close-meters-seal-${id.segment}`,
        );
      }
      await enqueue(
        { commandType: 'CloseMeters', ...base, expectedVersion: shiftVersion },
        `close-meters-shift-${shiftId}-${shiftVersion}`,
      );
      await enqueue(
        { commandType: 'CompleteShift', ...base, expectedVersion: shiftVersion + 1 },
        `close-shift-${shiftId}-${shiftVersion + 1}`,
      );
      const attempt: CloseMetersJournal = {
        commands,
        readings: computed.map((item) => ({
          nozzleId: item.row.nozzleId,
          opening: item.open!.toFixed(),
          closing: item.close!.toFixed(),
        })),
      };
      // Persist before the first request; an ambiguous response must replay identical bodies and keys.
      try {
        sessionStorage.setItem(journalKey, JSON.stringify(attempt));
      } catch {
        /* Keep in memory. */
      }
      journal.current = attempt;
      setPending(true);
      await finishAttempt(attempt);
    } catch (caught) {
      setError(isUserMessage(caught) ? caught : userMessage('UNKNOWN'));
    }
  }

  async function finishAttempt(attempt: CloseMetersJournal) {
    setBusy(true);
    setError(null);
    try {
      await replayCloseMeters(attempt, post);
      try {
        // The figures wizard shows these on its Pumps step.
        sessionStorage.setItem(closedMetersKey(shiftId), JSON.stringify(attempt.readings));
      } catch {
        /* private mode: the Pumps step simply asks again */
      }
      try {
        sessionStorage.removeItem(journalKey);
      } catch {
        /* In-memory state is cleared below. */
      }
      journal.current = null;
      setPending(false);
      onClosed();
    } catch (caught) {
      if (!(attempt.confirmedCount ?? 0) && !attempt.uncertain) {
        // A definitive rejection of the first command made no writes; allow correction.
        journal.current = null;
        setPending(false);
        try {
          sessionStorage.removeItem(journalKey);
        } catch {
          /* No persisted attempt. */
        }
      } else {
        try {
          sessionStorage.setItem(journalKey, JSON.stringify(attempt));
        } catch {
          /* Keep in memory. */
        }
      }
      setError(isUserMessage(caught) ? caught : userMessage('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Close meters"
      description={shiftLabel(plannedStartAt, plannedEndAt, timezone)}
      presentation="side"
      dismissible={!busy && !pending}
      initialFocusRef={firstInput}
      className="close-meters-sheet"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy || pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={busy}
            disabled={!pending && !complete && touched}
            aria-describedby="close-meters-reason"
          >
            {pending ? 'Retry close meters' : 'Close meters'}
          </Button>
        </>
      }
    >
      <div ref={firstInput} tabIndex={-1} className="close-meters-body">
        {loading ? <LoadingState label="Loading pumps" /> : null}
        {!loading && rows.length === 0 && !error ? (
          <p className="action-reason">This station has no pumps set up yet.</p>
        ) : null}
        {rows.length > 0 ? (
          <ul className="close-meters-list">
            {computed.map(({ row, openingValue, litres, problem }) => (
              <li className="close-meters-row" key={row.nozzleId}>
                <div className="close-meters-heading">
                  <strong>
                    Pump {row.pumpNumber} · Nozzle {row.nozzleNumber}
                  </strong>
                  <span>{row.productName}</span>
                </div>
                {attendants.length > 1 ? (
                  <Field id={`attendant-${row.nozzleId}`} label="Responsible attendant">
                    <Select
                      id={`attendant-${row.nozzleId}`}
                      value={attendantByNozzle[row.nozzleId] ?? attendants[0]!.id}
                      onChange={(event) =>
                        setAttendantByNozzle((current) => ({
                          ...current,
                          [row.nozzleId]: event.target.value,
                        }))
                      }
                      options={attendants.map((entry) => ({ value: entry.id, label: entry.name }))}
                      disabled={busy || pending}
                    />
                  </Field>
                ) : attendants.length === 1 ? (
                  <p className="close-meters-attendant">Attendant: {attendants[0]!.name}</p>
                ) : null}
                <div className="close-meters-fields">
                  {row.previousReading === null ? (
                    <NumericInput
                      id={`open-${row.nozzleId}`}
                      label="Opening reading"
                      value={opening[row.nozzleId] ?? ''}
                      onChange={(event) =>
                        setOpening((current) => ({
                          ...current,
                          [row.nozzleId]: event.target.value,
                        }))
                      }
                      unit="L"
                      disabled={busy || pending}
                    />
                  ) : (
                    <div className="close-meters-readonly">
                      <span className="metric-label">Opening reading</span>
                      <strong className="numeric">{formatLitres(openingValue)}</strong>
                    </div>
                  )}
                  <NumericInput
                    id={`close-${row.nozzleId}`}
                    label="Closing reading"
                    value={closing[row.nozzleId] ?? ''}
                    onChange={(event) =>
                      setClosing((current) => ({ ...current, [row.nozzleId]: event.target.value }))
                    }
                    unit="L"
                    disabled={busy || pending}
                    error={touched && problem ? problem : undefined}
                  />
                  <div className="close-meters-readonly">
                    <span className="metric-label">Litres sold</span>
                    <strong className="numeric">
                      {litres ? formatLitres(litres.toFixed(3)) : '—'}
                    </strong>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {pending ? (
          <p role="status">
            A meter close is in progress. Retry to finish the same readings safely.
          </p>
        ) : null}
        <InlineError error={error} onRetry={() => void submit()} />
        {!complete && !loading ? (
          <p className="action-reason" id="close-meters-reason">
            {reason}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function isUserMessage(value: unknown): value is UserMessage {
  return typeof value === 'object' && value !== null && 'title' in value && 'code' in value;
}

function closingIntervalEnd(plannedEndAt: string) {
  return new Date(Math.min(Date.now() - 5_000, new Date(plannedEndAt).getTime())).toISOString();
}
