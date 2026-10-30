'use client';

import { useReverification } from '@clerk/nextjs';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../../../design-system/feedback-provider';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '../../../design-system/primitives';
import { formatBusinessDate, formatStatusLabel } from '../../../design-system/formatters';
import { Select } from '../../../design-system/forms';
import { stationLocalToInstant } from '@/platform/domain/business-time';
import { SHIFT_EARLY_START_MINUTES } from '../shift-schedule';
import { eventLabel, isEarlierOpenDay } from './operations-labels';
import { dailyOperationsLinkFix, dailyOperationsProblem } from './daily-operations-state';
import { NextStepCard } from './next-step-card';
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
  /** Plain-words reason the selected closed day cannot be locked yet; null when it can. */
  lockBlockedReason?: string | null;
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
  shiftTemplates?: Array<{
    id: string;
    name: string;
    startTime: string | null;
    durationMinutes: number;
  }>;
  shifts: Array<{
    id: string;
    state: string;
    businessDate: string;
    plannedStartAt: string | null;
    plannedEndAt: string | null;
    version: number;
    openedAt: string | null;
    meterClosedAt: string | null;
    completedAt: string | null;
    notOperatedReason: string | null;
    shiftTemplateId?: string | null;
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

function timeRange(start: string | null, end: string | null, timeZone: string) {
  if (!start || !end) return 'Shift time unavailable';
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

function templateLength(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}

/**
 * Says why a shift cannot be opened yet and where to go, instead of leaving a dead page.
 * The shift list shows its own empty state; this adds the reason and the way forward.
 */
export function ShiftPrerequisite({
  dayOpen,
  canOpenDay,
  canStartShift,
}: {
  dayOpen: boolean;
  canOpenDay: boolean;
  canStartShift: boolean;
}) {
  if (!dayOpen) {
    return (
      <p className="semantic-note" role="note">
        {canOpenDay
          ? 'Choose the first shift here. Opening it also opens the business day.'
          : 'The business day has not been opened. Ask the station supervisor or an owner to open it.'}{' '}
        If the station is still being set up, finish it in{' '}
        <Link href="/settings?tab=readiness">Settings, under Readiness</Link>.
      </p>
    );
  }
  if (!canStartShift) {
    return (
      <p className="semantic-note" role="note">
        You can see the shifts but not open one. Ask the station supervisor or an owner to open the
        shift.
      </p>
    );
  }
  return null;
}

/** Opens the day's first shift from one of the station's shift templates. */
function OpenFirstShift({
  templates,
  busy,
  onOpen,
}: {
  templates: NonNullable<Overview['shiftTemplates']>;
  busy: boolean;
  onOpen: (templateId: string) => void;
}) {
  const [chosen, setChosen] = useState('');
  const templateId = chosen || templates[0]?.id || '';
  if (templates.length === 0) {
    return (
      <p>
        No shift has been set up for this station yet. Add a Day or Night shift in{' '}
        <Link href="/settings">Settings, under Station setup</Link>, then come back here.
      </p>
    );
  }
  return (
    <div className="inline-links">
      <Select
        aria-label="Shift to open"
        value={templateId}
        onChange={(event) => setChosen(event.target.value)}
        options={templates.map((template) => ({
          value: template.id,
          label: `${template.name} (${templateLength(template.durationMinutes)})`,
        }))}
      />
      <Button disabled={busy || !templateId} onClick={() => onOpen(templateId)}>
        Open shift
      </Button>
    </div>
  );
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
  initialData,
}: {
  context: Context;
  initialData?: Overview;
  /** `reconciliations` leads with the station's reconciliations, exceptions first. */
  focus?: 'operations' | 'reconciliations';
}) {
  const confirm = useConfirm();
  const [overview, setOverview] = useState<Overview | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [busy, setBusy] = useState(false);
  const verifyLockIdentity = useLockVerification();
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [statementOpen, setStatementOpen] = useState(false);
  const idempotencyKeys = useRef(new Map<string, string>());
  // One id per visit, so retrying the first shift's opening cannot create two shifts.
  const [firstShiftId] = useState(() => crypto.randomUUID());
  // Likewise for the next shift of a day that already has one.
  const [nextShiftId] = useState(() => crypto.randomUUID());

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
    if (initialData) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(false, controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, initialData]);

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

  function fixLinkFor(message: string) {
    const fix = dailyOperationsLinkFix(message);
    return fix ? (
      <Link className="button button-primary" href={fix.href}>
        {fix.label}
      </Link>
    ) : undefined;
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
    /** Runs first, inside the same confirmed action (for example opening the day before a shift). */
    before?: () => Promise<unknown>,
  ): Promise<boolean> {
    if (
      !(await confirm({
        title: 'Please confirm',
        consequence,
        confirmLabel: 'Continue',
        tone: 'warning',
      }))
    ) {
      return false;
    }
    setBusy(true);
    setError(undefined);
    setConflict(undefined);
    setNotice(undefined);
    try {
      if (commandType === 'LockBusinessDay') {
        await verifyLockIdentity(context.tenantId);
      }
      await before?.();
      await command(commandType, values, subjectId);
      if (commandType === 'CloseMeters') {
        // Closing the meters finishes the shift: one step for the person, two states on record.
        await command(
          'CompleteShift',
          { ...values, expectedVersion: Number(values.expectedVersion) + 1 },
          subjectId,
        );
      }
      setNotice(success);
      await load();
      return true;
    } catch (caught) {
      const specific =
        caught instanceof Error && isConflictError(caught) && caught.code !== 'IDEMPOTENCY_CONFLICT'
          ? dailyOperationsProblem(caught.status ?? 409, caught.code, caught.message)
          : undefined;
      if (specific && !specific.message.includes('changed elsewhere')) {
        setError(specific.message);
      } else if (isConflictError(caught)) {
        await load(true);
        setConflict(
          'This operation changed elsewhere or is stale. The authoritative state has been refreshed; review it before trying again. The command was not retried.',
        );
      } else {
        setError(commandErrorMessage(caught, commandType));
      }
      return false;
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
        action={fixLinkFor(error) ?? <Button onClick={() => void load()}>Retry</Button>}
        secondaryAction={
          fixLinkFor(error) ? <Button onClick={() => void load()}>Retry</Button> : undefined
        }
      />
    );
  if (!overview) return null;

  /** Opens a shift from one of the station's scheduled shifts, then goes to its figures. */
  function openFromTemplate(
    openDay: NonNullable<Overview['selectedBusinessDay']>,
    templateId: string,
    shiftId: string,
  ) {
    if (!overview) return;
    const template = (overview.shiftTemplates ?? []).find(
      (candidate) => candidate.id === templateId,
    );
    const plannedStartAt =
      template?.startTime && openDay.date
        ? stationLocalToInstant(
            `${openDay.date}T${template.startTime.slice(0, 5)}`,
            overview.station.timezone,
          )?.toISOString()
        : undefined;
    if (!plannedStartAt) {
      setError(
        'The selected shift has no valid scheduled start time. Update the shift setup before opening it.',
      );
      return;
    }
    const values = {
      tenantId: context.tenantId,
      stationId: context.stationId,
      businessDayId: openDay.id,
      shiftId,
      expectedVersion: 0,
      plannedStartAt,
      shiftTemplateId: templateId,
    };
    // Opening the first shift opens the day with it: nobody has to press a separate button first.
    const dayNeedsOpening = openDay.state !== 'OPEN';
    void runCommand(
      'StartShift',
      values,
      shiftId,
      dayNeedsOpening
        ? 'Open this business day and its first shift now?'
        : 'Open a shift now for this business day?',
      'Shift opened.',
      dayNeedsOpening
        ? () =>
            command(
              'OpenBusinessDay',
              {
                tenantId: context.tenantId,
                stationId: context.stationId,
                businessDayId: openDay.id,
                expectedVersion: openDay.version,
              },
              openDay.id,
            )
        : undefined,
    ).then((opened) => {
      // Next: the opening meter readings for each nozzle and who is on duty.
      if (opened) window.location.assign(dayHref(openDay.id, shiftId));
    });
  }

  const day = overview.selectedBusinessDay;
  const usedTemplates = new Set(overview.shifts.map((shift) => shift.shiftTemplateId));
  const unusedTemplates = (overview.shiftTemplates ?? []).filter(
    (template) => !usedTemplates.has(template.id),
  );
  const selectedShift = overview.shifts[0];
  const openDayId = day?.id ?? crypto.randomUUID();
  const openBusinessDay = overview.actions.OpenBusinessDay;
  const lockBusinessDay = overview.actions.LockBusinessDay;
  // The first shift can be opened when the day is open, or when it is not started and the person
  // may open the day: the first shift then opens the day with it.
  const canOpenFirstShift =
    day?.state === 'OPEN' || ((!day || day.state === 'NOT_STARTED') && openBusinessDay.canExecute);
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
      {focus === 'operations' ? (
        <div className="ops-top">
          <header className="ops-hero">
            <h2>{formatBusinessDate(day ? day.date : overview.currentBusinessDate)}</h2>
            <div className="ops-hero-side">
              <StatusBadge tone={tone(day?.state ?? 'NOT_STARTED')}>
                {formatStatusLabel(day?.state ?? 'NOT_STARTED')}
              </StatusBadge>
            </div>
            {focus === 'operations' ? (
              <div className="ops-hero-details">
                {day ? (
                  <dl className="ops-hero-times">
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
                  <p className="panel-detail">
                    No business day yet. Open the station’s current business day to begin.
                  </p>
                )}
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
                {day?.state === 'CLOSED' && lockBusinessDay.permissionGranted ? (
                  <Button
                    variant="danger"
                    disabled={busy || Boolean(overview.lockBlockedReason)}
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
                {day?.state === 'CLOSED' && overview.lockBlockedReason ? (
                  <p className="semantic-note" role="status" data-testid="lock-blocked-reason">
                    <strong>Not ready to lock.</strong> {overview.lockBlockedReason}
                  </p>
                ) : null}
                {day?.state === 'CLOSED' ? (
                  <p className="semantic-note">
                    <strong>Locking is permanent.</strong> After it, a change needs a recorded
                    correction.
                  </p>
                ) : null}
              </div>
            ) : null}
          </header>

          <NextStepCard
            tenantId={context.tenantId}
            stationId={context.stationId}
            onChanged={() => void load()}
          />
        </div>
      ) : null}

      {error ? (
        <ErrorState
          title="Action needs attention"
          message={error}
          action={fixLinkFor(error) ?? <Button onClick={() => void load()}>Refresh</Button>}
          secondaryAction={
            fixLinkFor(error) ? <Button onClick={() => void load()}>Refresh</Button> : undefined
          }
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
              onToggleStatement={() => setStatementOpen((current) => !current)}
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
                  <>
                    <EmptyState
                      title="No shifts recorded"
                      message={
                        day?.state === 'OPEN'
                          ? 'No shift has been opened for this business day yet.'
                          : 'No shift has been opened yet. Opening the first shift also opens the business day.'
                      }
                    />
                    <ShiftPrerequisite
                      dayOpen={canOpenFirstShift}
                      canOpenDay={openBusinessDay.canExecute}
                      canStartShift={overview.actions.StartShift.canExecute}
                    />
                    {canOpenFirstShift && overview.actions.StartShift.canExecute ? (
                      <OpenFirstShift
                        templates={overview.shiftTemplates ?? []}
                        busy={busy}
                        onOpen={(templateId) =>
                          openFromTemplate(
                            day ?? {
                              id: openDayId,
                              date: overview.currentBusinessDate,
                              state: 'NOT_STARTED',
                              version: 0,
                              openedAt: null,
                              closedAt: null,
                            },
                            templateId,
                            firstShiftId,
                          )
                        }
                      />
                    ) : null}
                  </>
                ) : (
                  <div className="operations-list">
                    {overview.shifts.map((shift) => {
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
                                    'Close this shift? The pump readings entered for it become the official meter records, and the shift is finished. This cannot be undone from here.',
                                    'Shift closed.',
                                  )
                                }
                              >
                                Close Shift
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
                                    'Close this shift? The meters are already closed; this finishes the shift.',
                                    'Shift closed.',
                                  )
                                }
                              >
                                Close Shift
                              </Button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
                {day?.state === 'OPEN' &&
                overview.shifts.length > 0 &&
                !overview.shifts.some(
                  (item) => item.state === 'OPEN' || item.state === 'METER_CLOSED',
                ) &&
                overview.actions.StartShift.canExecute &&
                unusedTemplates.length > 0 ? (
                  <div className="semantic-note">
                    <p>
                      Open the next shift when it is due. A shift can be opened up to{' '}
                      {SHIFT_EARLY_START_MINUTES} minutes before it is scheduled to start, so a
                      handover can overlap.
                    </p>
                    <OpenFirstShift
                      templates={unusedTemplates}
                      busy={busy}
                      onOpen={(templateId) => openFromTemplate(day, templateId, nextShiftId)}
                    />
                  </div>
                ) : null}
                {selectedShift?.state === 'EXCEPTIONALLY_CLOSED' ? (
                  <p className="semantic-note">
                    This shift was closed as an exception. A manager should review it.
                  </p>
                ) : null}
              </Card>
            ) : null}
          </div>
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
      ) : null}
    </div>
  );
}
