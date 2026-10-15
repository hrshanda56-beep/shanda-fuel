'use client';

import Decimal from 'decimal.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { InlineError } from '../../../design-system/inline-error';
import { Modal } from '../../../design-system/modal';
import { Button, LoadingState, NumericInput } from '../../../design-system/primitives';
import { formatLitres } from '../../../design-system/formatters';
import {
  describeFailure,
  type UserMessage,
  userMessage,
} from '../../../design-system/user-messages';
import { shiftLabel } from './shift-labels';

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
  return new Decimal(trimmed);
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
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
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
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo(
    () =>
      [...(context?.availableReadings ?? [])].sort((a, b) =>
        `${a.pumpNumber}.${a.nozzleNumber}`.localeCompare(`${b.pumpNumber}.${b.nozzleNumber}`, undefined, {
          numeric: true,
        }),
      ),
    [context],
  );

  const computed = rows.map((row) => {
    const openingValue = row.previousReading ?? opening[row.nozzleId] ?? '';
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
      throw describeFailure(response.status, failure.error, failure.message);
    }
  }

  async function submit() {
    setTouched(true);
    if (!complete || !context) return;
    const attendant = context.attendants[0];
    if (!attendant) {
      setError(userMessage('STATION_NOT_SET_UP'));
      return;
    }
    setBusy(true);
    setError(null);
    const base = { tenantId, stationId, businessDayId, shiftId };
    // A segment can only be sealed once its interval has ended, so it ends now (or at the planned end).
    const segmentEnd = new Date(
      Math.min(Date.now() - 5_000, new Date(plannedEndAt).getTime()),
    ).toISOString();
    try {
      for (const item of computed) {
        const { row } = item;
        if (!row.meterInstallationId) throw userMessage('STATION_NOT_SET_UP');
        const id = idsFor(row.nozzleId);
        const nozzle = {
          nozzleId: row.nozzleId,
          meterInstallationId: row.meterInstallationId,
          responsibleAttendantId: attendant.id,
          readingStatus: 'AVAILABLE',
          // Boundary and segment commands are versioned against the shift they belong to.
          expectedVersion: shiftVersion,
        };
        await post(
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
        await post(
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
        await post(
          {
            commandType: 'SealSegment',
            ...base,
            segmentId: id.segment,
            nozzleId: row.nozzleId,
            meterInstallationId: row.meterInstallationId,
            productId: row.productId,
            responsibleAttendantId: attendant.id,
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
      await post(
        { commandType: 'CloseMeters', ...base, expectedVersion: shiftVersion },
        `close-meters-shift-${shiftId}-${shiftVersion}`,
      );
      await post(
        { commandType: 'CompleteShift', ...base, expectedVersion: shiftVersion + 1 },
        `close-shift-${shiftId}-${shiftVersion + 1}`,
      );
      try {
        // The figures wizard shows these on its Pumps step.
        sessionStorage.setItem(
          closedMetersKey(shiftId),
          JSON.stringify(
            computed.map((item) => ({
              nozzleId: item.row.nozzleId,
              opening: item.open!.toFixed(),
              closing: item.close!.toFixed(),
            })),
          ),
        );
      } catch {
        /* private mode: the Pumps step simply asks again */
      }
      onClosed();
    } catch (caught) {
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
      dismissible={!busy}
      initialFocusRef={firstInput}
      className="close-meters-sheet"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={busy}
            disabled={!complete && touched}
            aria-describedby="close-meters-reason"
          >
            Close meters
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
                <div className="close-meters-fields">
                  {row.previousReading === null ? (
                    <NumericInput
                      id={`open-${row.nozzleId}`}
                      label="Opening reading"
                      value={opening[row.nozzleId] ?? ''}
                      onChange={(event) =>
                        setOpening((current) => ({ ...current, [row.nozzleId]: event.target.value }))
                      }
                      unit="L"
                      disabled={busy}
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
                    disabled={busy}
                    error={touched && problem ? problem : undefined}
                  />
                  <div className="close-meters-readonly">
                    <span className="metric-label">Litres sold</span>
                    <strong className="numeric">{litres ? formatLitres(litres.toFixed(3)) : '—'}</strong>
                  </div>
                </div>
              </li>
            ))}
          </ul>
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
