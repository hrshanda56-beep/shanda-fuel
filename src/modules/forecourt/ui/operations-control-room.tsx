'use client';

import { useReverification } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '../../../design-system/primitives';
import { formatBusinessDate, formatStatusLabel } from '../../../design-system/formatters';
import { ReconciliationBoard } from './reconciliation-board';

type Context = Readonly<{ tenantId: string; stationId: string; businessDayId?: string }>;
type ActionAvailability = {
  canExecute: boolean;
  permissionGranted: boolean;
  requiresStepUp: boolean;
};

type OperationsCommandError = Error & {
  status: number;
  code?: string;
};

type Overview = {
  station: { code: string; name: string; timezone: string };
  organisation: { name: string };
  currentBusinessDate: string;
  currentBusinessDayId: string | null;
  visibility: {
    reconciliations: boolean;
  };
  actions: {
    OpenBusinessDay: ActionAvailability;
    CloseBusinessDay: ActionAvailability;
    LockBusinessDay: ActionAvailability;
    StartShift: ActionAvailability;
    CloseMeters: ActionAvailability;
    CompleteShift: ActionAvailability;
  };
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
};

function useLockVerification() {
  const clerkAwareStepUp = useReverification(
    async (input: { tenantId: string; action: 'LOCK_BUSINESS_DAY' }) => {
      const response = await fetch('/api/auth/step-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = (await response.json()) as {
        message?: string;
        clerk_error?: unknown;
        status?: string;
        stepUpLevel?: number;
        expiresAt?: string;
      };
      if (!response.ok) {
        if (body.clerk_error) return body;
        throw new Error(body.message ?? 'Step-up verification failed.');
      }
      return body;
    },
  );

  return async (tenantId: string) => {
    const result = await clerkAwareStepUp({ tenantId, action: 'LOCK_BUSINESS_DAY' });
    if (result?.status !== 'active') {
      throw new Error('Identity verification was not completed. No change was posted.');
    }
  };
}

function tone(state: string): 'locked' | 'warning' | 'pending' | 'informational' {
  if (state === 'LOCKED' || state === 'APPROVED' || state === 'COMPLETED') return 'locked';
  if (state === 'RETURNED' || state === 'CLOSED') return 'warning';
  if (state === 'SUBMITTED' || state === 'PENDING_APPROVAL' || state === 'OPEN') return 'pending';
  return 'informational';
}

function timeRange(start: string, end: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

function formatTimestamp(value: string | null, timeZone: string) {
  return value
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }).format(new Date(value))
    : '—';
}

export function OperationsControlRoom({
  context,
  focus = 'operations',
}: {
  context: Context;
  /** `reconciliations` leads with the station's reconciliations, exceptions first. */
  focus?: 'operations' | 'reconciliations';
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const verifyLockIdentity = useLockVerification();
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [statementOpen, setStatementOpen] = useState(false);
  const idempotencyKeys = useRef(new Map<string, string>());

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({
      tenantId: context.tenantId,
      stationId: context.stationId,
    });
    if (context.businessDayId) params.set('businessDayId', context.businessDayId);
    return `/api/forecourt/operations/overview?${params.toString()}`;
  }, [context.businessDayId, context.stationId, context.tenantId]);

  const load = useCallback(
    async (preserveConflict = false, signal?: AbortSignal) => {
      setLoading(true);
      setError(undefined);
      if (!preserveConflict) setConflict(undefined);
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal });
        const body = (await response.json()) as Overview & { message?: string; error?: string };
        if (!response.ok) {
          if (response.status === 403)
            throw new Error('You do not have permission to view operations for this station.');
          throw new Error(body.message ?? 'The operations control room could not be loaded.');
        }
        if (!signal?.aborted) setOverview(body);
      } catch (caught) {
        if (signal?.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'The operations control room could not be loaded.',
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(false, controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  function stableIdempotencyKey(
    commandType: string,
    values: Record<string, unknown>,
    subjectId: string,
  ) {
    const fingerprint = `${commandType}:${subjectId}:${JSON.stringify(values)}`;
    const existing = idempotencyKeys.current.get(fingerprint);
    if (existing) return existing;
    const key = `ux-ops-${commandType}-${subjectId}-${crypto.randomUUID()}`;
    idempotencyKeys.current.set(fingerprint, key);
    return key;
  }

  async function command(commandType: string, values: Record<string, unknown>, subjectId: string) {
    const response = await fetch('/api/forecourt/commands', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': stableIdempotencyKey(commandType, values, subjectId),
      },
      body: JSON.stringify({ commandType, ...values }),
    });
    const body = (await response.json()) as { message?: string; error?: string };
    if (!response.ok) {
      const failure = new Error(
        body.message ?? 'The server could not complete that action.',
      ) as OperationsCommandError;
      failure.status = response.status;
      failure.code = body.error;
      throw failure;
    }
  }

  function isConflictError(caught: unknown): caught is OperationsCommandError {
    return (
      caught instanceof Error &&
      'status' in caught &&
      ((caught as OperationsCommandError).status === 409 ||
        (caught as OperationsCommandError).code === 'CONFLICT' ||
        (caught as OperationsCommandError).code === 'IDEMPOTENCY_CONFLICT')
    );
  }

  function commandErrorMessage(caught: unknown, commandType: string) {
    if (
      caught instanceof Error &&
      'status' in caught &&
      (caught as OperationsCommandError).status === 403 &&
      (caught.message.toLowerCase().includes('step-up') || commandType === 'LockBusinessDay')
    ) {
      return 'Locking a business day requires the existing step-up authentication flow. No change was posted.';
    }
    return caught instanceof Error ? caught.message : 'The server could not complete that action.';
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
    setConflict(undefined);
    setNotice(undefined);
    try {
      if (commandType === 'LockBusinessDay') {
        await verifyLockIdentity(context.tenantId);
      }
      await command(commandType, values, subjectId);
      setNotice(success);
      await load();
    } catch (caught) {
      if (isConflictError(caught)) {
        await load(true);
        setConflict(
          'This operation changed elsewhere or is stale. The authoritative state has been refreshed; review it before trying again. The command was not retried.',
        );
      } else {
        setError(commandErrorMessage(caught, commandType));
      }
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
  const openBusinessDay = overview.actions.OpenBusinessDay;
  const closeBusinessDay = overview.actions.CloseBusinessDay;
  const lockBusinessDay = overview.actions.LockBusinessDay;
  const shiftsForDay = day ? overview.shifts : [];
  const reviewHref = (reconciliationId: string, shiftId: string) =>
    day
      ? `/operations/reconciliations/${reconciliationId}/review?${new URLSearchParams({ tenantId: context.tenantId, stationId: context.stationId, businessDayId: day.id, shiftId }).toString()}`
      : undefined;
  const shiftLabel = (shiftId: string | null) => {
    const shift = shiftId ? overview.shifts.find((item) => item.id === shiftId) : undefined;
    return shift
      ? timeRange(shift.plannedStartAt, shift.plannedEndAt, overview.station.timezone)
      : 'Shift';
  };

  return (
    <div className="operations-control-room" aria-label="Operations control room">
      <header className="ops-hero">
        <div>
          <p className="eyebrow">
            {overview.organisation.name} · {overview.station.name}
          </p>
          <h2>{formatBusinessDate(day ? day.date : overview.currentBusinessDate)}</h2>
          <p>
            {focus === 'operations'
              ? 'Run the shifts, review what comes back and close the records before the day ends.'
              : 'Every shift reconciliation for this station, exceptions first.'}
          </p>
        </div>
        <div className="ops-hero-side">
          <StatusBadge tone={tone(day?.state ?? 'NOT_STARTED')}>
            {formatStatusLabel(day?.state ?? 'NOT_STARTED')}
          </StatusBadge>
          {focus === 'reconciliations' && overview.visibility.reconciliations ? (
            <button
              type="button"
              className={`button ${statementOpen ? 'button-secondary' : 'button-primary'}`}
              aria-pressed={statementOpen}
              onClick={() => setStatementOpen((current) => !current)}
            >
              {statementOpen ? 'Back to overview' : 'View statement'}
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <ErrorState
          title="Action needs attention"
          message={error}
          action={<Button onClick={() => void load()}>Refresh</Button>}
        />
      ) : null}
      {conflict ? (
        <ErrorState
          title="State changed"
          message={conflict}
          action={<Button onClick={() => void load()}>Refresh</Button>}
        />
      ) : null}
      {notice ? (
        <p className="state state-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {focus === 'reconciliations' ? (
        overview.visibility.reconciliations ? (
          <>
            <ReconciliationBoard
              tenantId={context.tenantId}
              stationId={context.stationId}
              organisation={overview.organisation.name}
              station={overview.station.name}
              businessDate={formatBusinessDate(day ? day.date : overview.currentBusinessDate)}
              fileStem={`reconciliation-statement-${overview.station.code}-${day ? day.date : overview.currentBusinessDate}`
                .toLowerCase()
                .replace(/[^a-z0-9-]+/g, '-')}
              items={overview.reconciliations}
              timezone={overview.station.timezone}
              statementOpen={statementOpen}
              tone={tone}
              shiftLabel={shiftLabel}
              formatTimestamp={formatTimestamp}
              actionFor={(item) => {
                if (!item.shiftId || !day) return undefined;
                if (item.state === 'DRAFT' || item.state === 'RETURNED')
                  return {
                    href: dayHref(day.id, item.shiftId),
                    label: 'Open workspace',
                    primary: item.state === 'RETURNED',
                  };
                const waiting = item.state === 'SUBMITTED' || item.state === 'PENDING_APPROVAL';
                return {
                  href: reviewHref(item.id, item.shiftId)!,
                  label: waiting ? 'Review' : 'View',
                  primary: waiting,
                };
              }}
            />
          </>
        ) : (
          <section className="card panel cash-panel">
            <EmptyState
              title="Reconciliation details restricted"
              message="You do not have permission to view reconciliation details for this station."
            />
          </section>
        )
      ) : null}

      {focus === 'operations' ? (
        <div className="operations-layout">
          <div className="operations-layout-main">
            {focus === 'operations' ? (
              <Card as="section" className="card panel cash-panel" aria-labelledby="shifts-title">
                <div className="panel-heading">
                  <div>
                    <h2 id="shifts-title">Shifts</h2>
                  </div>
                </div>
                {!day || overview.shifts.length === 0 ? (
                  <EmptyState
                    title="No shifts recorded"
                    message="Shifts appear here once they are planned for this business day."
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
                        <article
                          className="operations-list-row operations-shift-row"
                          key={shift.id}
                          data-shift-id={shift.id}
                        >
                          <div>
                            <strong>
                              {timeRange(
                                shift.plannedStartAt,
                                shift.plannedEndAt,
                                overview.station.timezone,
                              )}
                            </strong>
                            <small>
                              {shift.attendantCount} attendant
                              {shift.attendantCount === 1 ? '' : 's'}
                            </small>
                          </div>
                          <StatusBadge tone={tone(shift.state)}>
                            {formatStatusLabel(shift.state)}
                          </StatusBadge>
                          <div className="inline-links">
                            {shift.state === 'PLANNED' && overview.actions.StartShift.canExecute ? (
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
                            {shift.state === 'OPEN' && overview.actions.CloseMeters.canExecute ? (
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
                            {shift.state === 'METER_CLOSED' &&
                            overview.actions.CompleteShift.canExecute ? (
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
                    This shift was closed as an exception. A manager should review it.
                  </p>
                ) : null}
              </Card>
            ) : null}
            <Card
              as="section"
              className="card panel cash-panel"
              aria-labelledby="approval-queue-title"
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Review</p>
                  <h2 id="approval-queue-title">Reconciliations</h2>
                </div>
              </div>
              {!overview.visibility.reconciliations ? (
                <EmptyState
                  title="Reconciliation details restricted"
                  message="You do not have permission to view reconciliation details for this station."
                />
              ) : overview.reconciliations.length === 0 ? (
                <EmptyState
                  title="No reconciliations yet"
                  message="A reconciliation appears here once one is started for a shift."
                />
              ) : (
                <div className="operations-list">
                  {overview.reconciliations.map((item) => (
                    <div className="operations-list-row" key={item.id}>
                      <span>
                        <strong>{formatStatusLabel(item.state)}</strong>
                        <small>
                          Revision {item.revision ?? '—'} · updated{' '}
                          {formatTimestamp(item.updatedAt, overview.station.timezone)}
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
            </Card>
          </div>
          <div className="operations-layout-side">
            {focus === 'operations' ? (
              <Card
                as="section"
                className="card panel cash-panel"
                aria-labelledby="current-day-title"
              >
                <div className="panel-heading">
                  <h2 id="current-day-title">Day controls</h2>
                </div>
                {day ? (
                  <dl className="operational-summary">
                    <div>
                      <dt>Opened</dt>
                      <dd>
                        {day.openedAt
                          ? formatTimestamp(day.openedAt, overview.station.timezone)
                          : 'Not opened'}
                      </dd>
                    </div>
                    <div>
                      <dt>Closed</dt>
                      <dd>
                        {day.closedAt
                          ? formatTimestamp(day.closedAt, overview.station.timezone)
                          : 'Not closed'}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <EmptyState
                    title="No business day yet"
                    message="Open the station’s current business day to begin."
                  />
                )}
                <div className="form-actions">
                  {(!day || day.state === 'NOT_STARTED') && openBusinessDay.canExecute ? (
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
                          'Open this business day?',
                          'Business day opened.',
                        )
                      }
                    >
                      Open business day
                    </Button>
                  ) : null}
                  {day?.state === 'OPEN' && closeBusinessDay.canExecute ? (
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
                          'Close this business day? Every operated shift must have complete meter readings.',
                          'Business day closed.',
                        )
                      }
                    >
                      Close business day
                    </Button>
                  ) : null}
                  {day?.state === 'CLOSED' && lockBusinessDay.permissionGranted ? (
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
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
