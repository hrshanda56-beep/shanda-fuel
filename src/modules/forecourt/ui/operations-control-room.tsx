'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '../../../design-system/primitives';
import { formatBusinessDate, formatStatusLabel } from '../../../design-system/formatters';

type Context = Readonly<{ tenantId: string; stationId: string; businessDayId?: string }>;
type Overview = {
  station: { code: string; name: string; timezone: string };
  organisation: { name: string };
  currentBusinessDate: string;
  currentBusinessDayId: string | null;
  businessDays: Array<{
    id: string;
    date: string;
    state: string;
    version: number;
    openedAt: string | null;
    closedAt: string | null;
    updatedAt: string | null;
  }>;
  selectedBusinessDay?: {
    id: string;
    date: string;
    state: string;
    version: number;
    openedAt: string | null;
    closedAt: string | null;
  };
  shifts: Array<{
    id: string;
    state: string;
    businessDate: string;
    plannedStartAt: string;
    plannedEndAt: string;
    version: number;
    openedAt: string | null;
    meterClosedAt: string | null;
    completedAt: string | null;
    notOperatedReason: string | null;
    attendantCount: number;
  }>;
  reconciliations: Array<{
    id: string;
    shiftId: string | null;
    state: string;
    version: number;
    revision: number | null;
    revisionState: string | null;
    updatedAt: string | null;
    submittedAt: string | null;
    returnedAt: string | null;
    approvedAt: string | null;
    returnReason: string | null;
  }>;
  timeline: Array<{
    eventCode: string;
    occurredAt: string | null;
    actorName: string | null;
    subjectType: string | null;
    reason: string | null;
  }>;
};

function tone(state: string): 'locked' | 'warning' | 'pending' | 'informational' {
  if (state === 'LOCKED' || state === 'APPROVED' || state === 'COMPLETED') return 'locked';
  if (state === 'RETURNED' || state === 'CLOSED') return 'warning';
  if (state === 'SUBMITTED' || state === 'PENDING_APPROVAL' || state === 'OPEN') return 'pending';
  return 'informational';
}

function commandKey(commandType: string, subjectId: string) {
  return `ux-ops-${commandType}-${subjectId}-${crypto.randomUUID()}`;
}

function timeRange(start: string, end: string) {
  return `${new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function formatTimestamp(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
}

export function OperationsControlRoom({ context }: { context: Context }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({
      tenantId: context.tenantId,
      stationId: context.stationId,
    });
    if (context.businessDayId) params.set('businessDayId', context.businessDayId);
    return `/api/forecourt/operations/overview?${params.toString()}`;
  }, [context.businessDayId, context.stationId, context.tenantId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const body = (await response.json()) as Overview & { message?: string; error?: string };
      if (!response.ok) {
        if (response.status === 403)
          throw new Error('You do not have permission to view operations for this station.');
        throw new Error(body.message ?? 'The operations control room could not be loaded.');
      }
      setOverview(body);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The operations control room could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function command(commandType: string, values: Record<string, unknown>, subjectId: string) {
    const response = await fetch('/api/forecourt/commands', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': commandKey(commandType, subjectId),
      },
      body: JSON.stringify({ commandType, ...values }),
    });
    const body = (await response.json()) as { message?: string };
    if (!response.ok) throw new Error(body.message ?? 'The server could not complete that action.');
  }

  async function runCommand(
    commandType: string,
    values: Record<string, unknown>,
    subjectId: string,
    consequence: string,
    success: string,
  ) {
    if (!window.confirm(consequence)) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await command(commandType, values, subjectId);
      setNotice(success);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The server could not complete that action.',
      );
    } finally {
      setBusy(false);
    }
  }

  function dayHref(dayId: string, shiftId?: string) {
    const params = new URLSearchParams({
      tenantId: context.tenantId,
      stationId: context.stationId,
      businessDayId: dayId,
    });
    if (shiftId) params.set('shiftId', shiftId);
    return `/operations/daily?${params.toString()}`;
  }

  if (loading) return <LoadingState label="Loading operations control room" />;
  if (error && !overview)
    return (
      <ErrorState
        title="Operations unavailable"
        message={error}
        action={<Button onClick={() => void load()}>Retry</Button>}
      />
    );
  if (!overview) return null;

  const day = overview.selectedBusinessDay;
  const selectedShift = overview.shifts[0];
  const isCurrentDay = day?.id === overview.currentBusinessDayId;
  const openDayId = day?.id ?? crypto.randomUUID();

  return (
    <div className="operations-control-room" aria-label="Operations control room">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operations control room · {overview.station.code}</p>
          <h1>Business day, shifts and reconciliation</h1>
          <p className="lede">
            {overview.organisation.name} · {overview.station.name} · {overview.station.timezone}
          </p>
        </div>
        <StatusBadge tone="informational">Server-backed</StatusBadge>
      </div>

      {error ? (
        <ErrorState
          title="Action needs attention"
          message={error}
          action={<Button onClick={() => void load()}>Refresh</Button>}
        />
      ) : null}
      {notice ? (
        <p className="state state-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <div className="content-grid operations-control-grid">
        <Card as="section" className="panel" aria-labelledby="current-day-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Business day</p>
              <h2 id="current-day-title">
                {day
                  ? formatBusinessDate(day.date)
                  : formatBusinessDate(overview.currentBusinessDate)}
              </h2>
            </div>
            <StatusBadge tone={tone(day?.state ?? 'NOT_STARTED')}>
              {formatStatusLabel(day?.state ?? 'NOT_STARTED')}
            </StatusBadge>
          </div>
          <p className="panel-detail">
            Business date is derived by the server in {overview.station.timezone}. No browser date
            is authoritative.
          </p>
          {day ? (
            <dl className="operational-summary">
              <div>
                <dt>Version</dt>
                <dd>v{day.version}</dd>
              </div>
              <div>
                <dt>Opened</dt>
                <dd>{day.openedAt ? formatTimestamp(day.openedAt) : 'Not opened'}</dd>
              </div>
              <div>
                <dt>Closed</dt>
                <dd>{day.closedAt ? formatTimestamp(day.closedAt) : 'Not closed'}</dd>
              </div>
            </dl>
          ) : (
            <EmptyState
              title="No business day yet"
              message="Open the server-derived current business date to begin operations."
            />
          )}
          <div className="form-actions">
            {!day || day.state === 'NOT_STARTED' ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void runCommand(
                    'OpenBusinessDay',
                    {
                      tenantId: context.tenantId,
                      stationId: context.stationId,
                      businessDayId: openDayId,
                      expectedVersion: day?.version ?? 0,
                    },
                    openDayId,
                    'Open this server-derived business day?',
                    'Business day opened.',
                  )
                }
              >
                Open business day
              </Button>
            ) : null}
            {day?.state === 'OPEN' ? (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void runCommand(
                    'CloseBusinessDay',
                    {
                      tenantId: context.tenantId,
                      stationId: context.stationId,
                      businessDayId: day.id,
                      expectedVersion: day.version,
                    },
                    day.id,
                    'Close this business day? The server will require all operated shifts and meter evidence to be complete.',
                    'Business day closed after server validation.',
                  )
                }
              >
                Close business day
              </Button>
            ) : null}
            {day?.state === 'CLOSED' ? (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void runCommand(
                    'LockBusinessDay',
                    {
                      tenantId: context.tenantId,
                      stationId: context.stationId,
                      businessDayId: day.id,
                      expectedVersion: day.version,
                    },
                    day.id,
                    'Lock this business day? This is irreversible and prevents ordinary changes.',
                    'Business day locked.',
                  )
                }
              >
                Lock business day
              </Button>
            ) : null}
          </div>
          {day?.state === 'CLOSED' ? (
            <p className="semantic-note">
              <strong>Lock is irreversible.</strong> Corrections require named compensating
              workflows.
            </p>
          ) : null}
          {isCurrentDay ? (
            <p className="panel-detail">This is the station’s current business date.</p>
          ) : null}
        </Card>

        <Card as="section" className="panel" aria-labelledby="day-history-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">History</p>
              <h2 id="day-history-title">Business days</h2>
            </div>
          </div>
          {overview.businessDays.length === 0 ? (
            <EmptyState
              title="No business-day history"
              message="The server has not recorded a business day for this station."
            />
          ) : (
            <div className="operations-list">
              {overview.businessDays.map((item) => (
                <a className="operations-list-row" key={item.id} href={dayHref(item.id)}>
                  <span>
                    <strong>{formatBusinessDate(item.date)}</strong>
                    <small>Updated {formatTimestamp(item.updatedAt)}</small>
                  </span>
                  <StatusBadge tone={tone(item.state)}>{formatStatusLabel(item.state)}</StatusBadge>
                </a>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card as="section" className="panel" aria-labelledby="shifts-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              Shift board · {day ? formatBusinessDate(day.date) : 'No day selected'}
            </p>
            <h2 id="shifts-title">Shift boundaries and team context</h2>
          </div>
        </div>
        {!day || overview.shifts.length === 0 ? (
          <EmptyState
            title="No shifts recorded"
            message="Open a business day and start a server-defined shift when the station is ready."
          />
        ) : (
          <div className="operations-list">
            {overview.shifts.map((shift) => {
              const reconciliation = overview.reconciliations.find(
                (item) => item.shiftId === shift.id,
              );
              const values = {
                tenantId: context.tenantId,
                stationId: context.stationId,
                businessDayId: day.id,
                shiftId: shift.id,
                expectedVersion: shift.version,
              };
              return (
                <article className="operations-list-row operations-shift-row" key={shift.id}>
                  <div>
                    <strong>{timeRange(shift.plannedStartAt, shift.plannedEndAt)}</strong>
                    <small>
                      {shift.attendantCount} attendant{shift.attendantCount === 1 ? '' : 's'} ·{' '}
                      {shift.id}
                    </small>
                  </div>
                  <StatusBadge tone={tone(shift.state)}>
                    {formatStatusLabel(shift.state)}
                  </StatusBadge>
                  <div className="inline-links">
                    {shift.state === 'PLANNED' ? (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void runCommand(
                            'StartShift',
                            {
                              ...values,
                              plannedStartAt: shift.plannedStartAt,
                              plannedEndAt: shift.plannedEndAt,
                            },
                            shift.id,
                            'Start this shift and record its opening boundary?',
                            'Shift started.',
                          )
                        }
                      >
                        Start shift
                      </Button>
                    ) : null}
                    {shift.state === 'OPEN' ? (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void runCommand(
                            'CloseMeters',
                            values,
                            shift.id,
                            'Close meters for this shift? Meter evidence must already be complete.',
                            'Shift meters closed.',
                          )
                        }
                      >
                        Close meters
                      </Button>
                    ) : null}
                    {shift.state === 'METER_CLOSED' ? (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void runCommand(
                            'CompleteShift',
                            values,
                            shift.id,
                            'Complete this shift? This records the close boundary as complete.',
                            'Shift completed.',
                          )
                        }
                      >
                        Complete shift
                      </Button>
                    ) : null}
                    <a className="text-link" href={dayHref(day.id, shift.id)}>
                      Open workspace
                    </a>
                    {reconciliation ? (
                      <a
                        className="text-link"
                        href={`/operations/reconciliations/${reconciliation.id}?${new URLSearchParams({ tenantId: context.tenantId, stationId: context.stationId, businessDayId: day.id, shiftId: shift.id }).toString()}`}
                      >
                        Reconciliation
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {selectedShift?.state === 'EXCEPTIONALLY_CLOSED' ? (
          <p className="semantic-note">
            Exceptional close is not exposed by the production command route, so this board reports
            the server state without inventing an action.
          </p>
        ) : null}
      </Card>

      <div className="content-grid operations-control-grid">
        <Card as="section" className="panel" aria-labelledby="approval-queue-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Approval queue</p>
              <h2 id="approval-queue-title">Reconciliations</h2>
            </div>
          </div>
          {overview.reconciliations.length === 0 ? (
            <EmptyState
              title="No reconciliations yet"
              message="A production reconciliation appears here after a server-backed draft is created for a shift."
            />
          ) : (
            <div className="operations-list">
              {overview.reconciliations.map((item) => (
                <div className="operations-list-row" key={item.id}>
                  <span>
                    <strong>{formatStatusLabel(item.state)}</strong>
                    <small>
                      Revision {item.revision ?? '—'} · updated {formatTimestamp(item.updatedAt)}
                    </small>
                  </span>
                  <StatusBadge tone={tone(item.state)}>
                    {item.revisionState ? formatStatusLabel(item.revisionState) : 'No revision'}
                  </StatusBadge>
                  {item.shiftId && day ? (
                    <a
                      className="text-link"
                      href={`/operations/reconciliations/${item.id}/review?${new URLSearchParams({ tenantId: context.tenantId, stationId: context.stationId, businessDayId: day.id, shiftId: item.shiftId }).toString()}`}
                    >
                      Review
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <p className="semantic-note">
            <strong>Production lifecycle:</strong> approval is the A5 command that posts canonical
            sale evidence and ends at APPROVED. A3 Post/Lock revision commands are not used here.
          </p>
        </Card>

        <Card as="section" className="panel" aria-labelledby="timeline-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Audit trail</p>
              <h2 id="timeline-title">Actor and timestamp history</h2>
            </div>
          </div>
          {overview.timeline.length === 0 ? (
            <EmptyState
              title="No recorded actions"
              message="Authoritative commands will appear here with their actor and server timestamp."
            />
          ) : (
            <ol className="operations-timeline">
              {overview.timeline.map((event, index) => (
                <li key={`${event.eventCode}-${event.occurredAt}-${index}`}>
                  <div>
                    <strong>{formatStatusLabel(event.eventCode.replace('FORECOURT.', ''))}</strong>
                    <small>
                      {event.actorName ?? 'Unknown actor'} · {formatTimestamp(event.occurredAt)}
                    </small>
                    {event.reason ? <p>{event.reason}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
