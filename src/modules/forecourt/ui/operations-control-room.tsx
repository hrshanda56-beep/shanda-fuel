'use client';

import { useReverification } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog, type ConfirmLine } from '../../../design-system/confirm-dialog';
import { InlineError } from '../../../design-system/inline-error';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  SkeletonBlock,
  StatusBadge,
} from '../../../design-system/primitives';
import { formatBusinessDate } from '../../../design-system/formatters';
import { getDisplayStatus } from '../../../design-system/status-display';
import { useToast } from '../../../design-system/toast';
import {
  describeFailure,
  type UserMessage,
  userMessage,
} from '../../../design-system/user-messages';
import { CloseMetersSheet } from './close-meters-sheet';
import { eventLabel, isEarlierOpenDay } from './operations-labels';
import { NextStepCard } from './next-step-card';
import { ReconciliationBoard } from './reconciliation-board';
import { shiftLabel } from './shift-labels';

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
    auditTimeline: boolean;
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
  timeline: Array<{
    eventCode: string;
    occurredAt: string | null;
    actorName: string | null;
    subjectType: string | null;
    reason: string | null;
  }>;
};

/** What the person is asked to confirm before a command is sent. */
type PendingCommand = Readonly<{
  commandType: string;
  values: Record<string, unknown>;
  subjectId: string;
  title: string;
  lines: readonly ConfirmLine[];
  note?: string;
  confirmLabel: string;
  success: string;
  /** Which part of the page the failure is shown next to. */
  where: string;
}>;

function isUserMessage(value: unknown): value is UserMessage {
  return typeof value === 'object' && value !== null && 'title' in value && 'code' in value;
}

function ClerkStepUpForm({
  context,
  busy,
  onSuccess,
}: {
  context: Context;
  busy: boolean;
  onSuccess: () => Promise<void>;
}) {
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpError, setStepUpError] = useState<string>();
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

  async function establishStepUp() {
    setStepUpBusy(true);
    setStepUpError(undefined);
    try {
      await clerkAwareStepUp({ tenantId: context.tenantId, action: 'LOCK_BUSINESS_DAY' });
      await onSuccess();
    } catch (caught) {
      setStepUpError(caught instanceof Error ? caught.message : 'Step-up verification failed.');
    } finally {
      setStepUpBusy(false);
    }
  }

  return (
    <form
      className="step-up-form"
      onSubmit={(event) => {
        event.preventDefault();
        void establishStepUp();
      }}
      aria-describedby="lock-business-day-step-up-help"
    >
      <p className="semantic-note">
        Clerk will ask you to reverify your password before this privileged action.
      </p>
      <Button type="submit" variant="secondary" disabled={busy || stepUpBusy} loading={stepUpBusy}>
        Reverify with Clerk
      </Button>
      {stepUpError ? (
        <p className="state state-error" role="alert">
          {stepUpError}
        </p>
      ) : null}
    </form>
  );
}

const statusOf = (state: string | null | undefined) => getDisplayStatus(state);

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
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string>();
  const [commandError, setCommandError] = useState<{ where: string; message: UserMessage } | null>(
    null,
  );
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [metersFor, setMetersFor] = useState<Overview['shifts'][number] | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpTotpCode, setStepUpTotpCode] = useState('');
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpError, setStepUpError] = useState<string>();
  const [authProvider, setAuthProvider] = useState<'BETTER_AUTH' | 'CLERK'>();
  const [mfaEnabled, setMfaEnabled] = useState<boolean>();
  const [mfaSetupPassword, setMfaSetupPassword] = useState('');
  const [mfaSetupCode, setMfaSetupCode] = useState('');
  const [mfaSetup, setMfaSetup] = useState<{ totpURI: string; backupCodes: string[] }>();
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string>();
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
    async () => {
      setError(undefined);
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        const body = (await response.json()) as Overview & { message?: string; error?: string };
        if (!response.ok) {
          const failure = describeFailure(response.status, body.error, body.message);
          throw new Error(`${failure.title}. ${failure.body}`);
        }
        setOverview(body);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Something went wrong. Please try again. If it keeps happening, contact your administrator.',
        );
      } finally {
        setLoading(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadMfaStatus = useCallback(async () => {
    const response = await fetch('/api/auth/mfa/setup', { cache: 'no-store' });
    if (response.status === 404) {
      setAuthProvider('CLERK');
      setMfaEnabled(false);
      return;
    }
    if (!response.ok) return;
    setAuthProvider('BETTER_AUTH');
    const body = (await response.json()) as { enabled?: boolean };
    setMfaEnabled(body.enabled === true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMfaStatus(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMfaStatus]);

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

  function failureMessage(caught: unknown, commandType: string): UserMessage {
    if (isUserMessage(caught)) return caught;
    if (caught instanceof Error && 'status' in caught) {
      const failure = caught as OperationsCommandError;
      if (
        failure.status === 403 &&
        (failure.message.toLowerCase().includes('step-up') || commandType === 'LockBusinessDay')
      ) {
        return {
          code: 'NOT_PERMITTED',
          title: 'Confirm it’s you first',
          body: 'Locking a business day needs extra sign-in verification. Nothing was changed.',
        };
      }
      return describeFailure(failure.status, failure.code, failure.message);
    }
    return userMessage('UNKNOWN');
  }

  /** Asks first; the command only goes to the server once the dialog is confirmed. */
  function askCommand(request: PendingCommand) {
    setCommandError(null);
    setPending(request);
  }

  async function confirmPending() {
    if (!pending) return;
    const current = pending;
    setBusy(true);
    setCommandError(null);
    try {
      await command(current.commandType, current.values, current.subjectId);
      toast.show(current.success);
      setPending(null);
      await load();
      router.refresh();
    } catch (caught) {
      setPending(null);
      setCommandError({ where: current.where, message: failureMessage(caught, current.commandType) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function establishStepUp() {
    setStepUpBusy(true);
    setStepUpError(undefined);
    try {
      const response = await fetch('/api/auth/step-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: context.tenantId,
          password: stepUpPassword,
          totpCode: stepUpTotpCode,
        }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? 'Step-up verification failed.');
      }
      setStepUpPassword('');
      setStepUpTotpCode('');
      toast.show('Identity confirmed');
      await load();
    } catch (caught) {
      setStepUpError(caught instanceof Error ? caught.message : 'Step-up verification failed.');
    } finally {
      setStepUpBusy(false);
    }
  }

  async function startMfaEnrollment() {
    setMfaBusy(true);
    setMfaError(undefined);
    try {
      const response = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: mfaSetupPassword }),
      });
      const body = (await response.json()) as {
        message?: string;
        totpURI?: string;
        backupCodes?: string[];
      };
      if (!response.ok || !body.totpURI || !body.backupCodes) {
        throw new Error(body.message ?? 'Authenticator setup could not be started.');
      }
      setMfaSetup({ totpURI: body.totpURI, backupCodes: body.backupCodes });
      setMfaSetupPassword('');
    } catch (caught) {
      setMfaError(caught instanceof Error ? caught.message : 'Authenticator setup failed.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmMfaEnrollment() {
    setMfaBusy(true);
    setMfaError(undefined);
    try {
      const response = await fetch('/api/auth/mfa/setup/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: mfaSetupCode }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Authenticator code was rejected.');
      setMfaEnabled(true);
      setMfaSetup(undefined);
      setMfaSetupCode('');
      toast.show('Authenticator turned on');
    } catch (caught) {
      setMfaError(caught instanceof Error ? caught.message : 'Authenticator verification failed.');
    } finally {
      setMfaBusy(false);
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

  if (loading) {
    return (
      <div className="operations-control-room" role="status" aria-label={focus === 'reconciliations' ? 'Loading reconciliations' : 'Loading operations'}>
        <SkeletonBlock height="7rem" />
        <SkeletonBlock height="5rem" />
        <SkeletonBlock height="14rem" />
      </div>
    );
  }
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
  const openShiftCount = shiftsForDay.filter((shift) => shift.state === 'OPEN').length;
  const shiftSummary =
    shiftsForDay.length === 0
      ? 'None yet'
      : `${shiftsForDay.length} ${shiftsForDay.length === 1 ? 'shift' : 'shifts'} · ${openShiftCount} open`;
  const everyShiftClosed =
    shiftsForDay.length > 0 &&
    shiftsForDay.every((shift) => ['COMPLETED', 'NOT_OPERATED'].includes(shift.state));
  const everyReconciliationApproved = overview.reconciliations.every((item) =>
    ['APPROVED', 'LOCKED', 'POSTED'].includes(item.state),
  );
  const dayReadyToClose = everyShiftClosed && everyReconciliationApproved;
  const errorAt = (where: string) =>
    commandError?.where === where ? <InlineError error={commandError.message} /> : null;
  const waitingForReview = overview.reconciliations.filter(
    (item) => item.state === 'SUBMITTED' || item.state === 'PENDING_APPROVAL',
  ).length;
  const returnedCount = overview.reconciliations.filter((item) => item.state === 'RETURNED').length;
  const reviewHref = (reconciliationId: string, shiftId: string) =>
    day
      ? `/operations/reconciliations/${reconciliationId}/review?${new URLSearchParams({ tenantId: context.tenantId, stationId: context.stationId, businessDayId: day.id, shiftId }).toString()}`
      : undefined;
  const shiftLabelFor = (shiftId: string | null) => {
    const shift = shiftId ? overview.shifts.find((item) => item.id === shiftId) : undefined;
    return shift
      ? shiftLabel(shift.plannedStartAt, shift.plannedEndAt, overview.station.timezone)
      : 'Shift';
  };
  // Built only from states the server returned; nothing is inferred.
  const attention: Array<{
    key: string;
    title: string;
    detail: string;
    href?: string;
    action?: string;
  }> = [];
  if (day && isEarlierOpenDay(day, overview.currentBusinessDate)) {
    attention.push({
      key: 'open-earlier-day',
      title: `Business day ${formatBusinessDate(day.date)} is still open`,
      detail: `The station's current business date is ${formatBusinessDate(overview.currentBusinessDate)}.`,
    });
  }
  if (overview.visibility.reconciliations) {
    for (const item of overview.reconciliations) {
      if (item.state === 'RETURNED') {
        attention.push({
          key: `returned-${item.id}`,
          title: 'Reconciliation returned for changes',
          detail:
            item.returnReason ??
            `Returned ${formatTimestamp(item.returnedAt, overview.station.timezone)}`,
          href: item.shiftId && day ? dayHref(day.id, item.shiftId) : undefined,
          action: 'Open workspace',
        });
      } else if (item.state === 'SUBMITTED' || item.state === 'PENDING_APPROVAL') {
        attention.push({
          key: `review-${item.id}`,
          title: 'Reconciliation waiting for review',
          detail: `Submitted ${formatTimestamp(item.submittedAt, overview.station.timezone)}`,
          href: item.shiftId ? reviewHref(item.id, item.shiftId) : undefined,
          action: 'Review',
        });
      }
    }
  }

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
          <StatusBadge tone={statusOf(day?.state).tone}>{statusOf(day?.state).label}</StatusBadge>
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

      {focus === 'operations' ? (
        <NextStepCard
          tenantId={context.tenantId}
          stationId={context.stationId}
          onChanged={() => void load()}
        />
      ) : null}

      {error ? (
        <ErrorState
          title="Action needs attention"
          message={error}
          action={<Button onClick={() => void load()}>Refresh</Button>}
        />
      ) : null}

      {focus === 'operations' ? (
        <dl className="operations-summary" aria-label="Today at a glance">
          <div>
            <dt>Business day</dt>
            <dd>{statusOf(day?.state).label}</dd>
          </div>
          <div>
            <dt>Shifts</dt>
            <dd>{shiftSummary}</dd>
          </div>
          <div data-tone={waitingForReview > 0 ? 'warning' : undefined}>
            <dt>Waiting for review</dt>
            <dd>{overview.visibility.reconciliations ? waitingForReview : '—'}</dd>
          </div>
          <div data-tone={returnedCount > 0 ? 'critical' : undefined}>
            <dt>Returned for changes</dt>
            <dd>{overview.visibility.reconciliations ? returnedCount : '—'}</dd>
          </div>
        </dl>
      ) : null}

      {focus === 'operations' ? (
        <section
          className="ops-attention"
          data-tone={attention.length > 0 ? 'warning' : 'ok'}
          aria-labelledby="operations-attention-title"
        >
          <h2 id="operations-attention-title">Needs attention</h2>
          {attention.length === 0 ? (
            <p className="ops-attention-clear">
              Nothing needs attention for this business day, its shifts or
              {overview.visibility.reconciliations
                ? ' its reconciliations.'
                : ' the items you can see.'}
            </p>
          ) : (
            <ul className="ops-attention-list">
              {attention.map((item) => (
                <li key={item.key}>
                  <span className="ops-attention-text">
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  {item.href ? (
                    <a className="button button-secondary" href={item.href}>
                      {item.action ?? 'Open'}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
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
              tone={(state: string) => statusOf(state).tone}
              shiftLabel={shiftLabelFor}
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
                    <p className="eyebrow">
                      Shift board · {day ? formatBusinessDate(day.date) : 'No day selected'}
                    </p>
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
                              {shiftLabel(
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
                          <StatusBadge tone={statusOf(shift.state).tone}>
                            {statusOf(shift.state).label}
                          </StatusBadge>
                          <div className="inline-links">
                            {shift.state === 'PLANNED' && overview.actions.StartShift.canExecute ? (
                              <Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() =>
                                  askCommand({
                                    commandType: 'StartShift',
                                    values: {
                                      ...values,
                                      plannedStartAt: shift.plannedStartAt,
                                      plannedEndAt: shift.plannedEndAt,
                                    },
                                    subjectId: shift.id,
                                    title: 'Start shift?',
                                    lines: [
                                      {
                                        label: 'Shift',
                                        value: shiftLabel(
                                          shift.plannedStartAt,
                                          shift.plannedEndAt,
                                          overview.station.timezone,
                                        ),
                                      },
                                    ],
                                    confirmLabel: 'Start shift',
                                    success: 'Shift started',
                                    where: shift.id,
                                  })
                                }
                              >
                                Start shift
                              </Button>
                            ) : null}
                            {shift.state === 'OPEN' && overview.actions.CloseMeters.canExecute ? (
                              <Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() => setMetersFor(shift)}
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
                                  askCommand({
                                    commandType: 'CompleteShift',
                                    values,
                                    subjectId: shift.id,
                                    title: 'Close shift?',
                                    lines: [
                                      {
                                        label: 'Shift',
                                        value: shiftLabel(
                                          shift.plannedStartAt,
                                          shift.plannedEndAt,
                                          overview.station.timezone,
                                        ),
                                      },
                                    ],
                                    confirmLabel: 'Close shift',
                                    success: 'Shift closed',
                                    where: shift.id,
                                  })
                                }
                              >
                                Close shift
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
                          {errorAt(shift.id)}
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
          </div>
          <div className="operations-layout-side">
            {focus === 'operations' ? (
              <Card
                as="section"
                className="card panel cash-panel"
                aria-labelledby="current-day-title"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Business day</p>
                    <h2 id="current-day-title">
                      {day
                        ? formatBusinessDate(day.date)
                        : formatBusinessDate(overview.currentBusinessDate)}
                    </h2>
                  </div>
                  <StatusBadge tone={statusOf(day?.state).tone}>{statusOf(day?.state).label}</StatusBadge>
                </div>
                <p className="panel-detail">
                  Times are shown in the station’s time zone ({overview.station.timezone}).
                </p>
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
                        askCommand({
                          commandType: 'OpenBusinessDay',
                          values: {
                            tenantId: context.tenantId,
                            stationId: context.stationId,
                            businessDayId: openDayId,
                            expectedVersion: day?.version ?? 0,
                          },
                          subjectId: openDayId,
                          title: 'Open business day?',
                          lines: [
                            { label: 'Station', value: overview.station.name },
                            {
                              label: 'Date',
                              value: formatBusinessDate(
                                day ? day.date : overview.currentBusinessDate,
                              ),
                            },
                          ],
                          confirmLabel: 'Open day',
                          success: 'Business day opened',
                          where: 'day',
                        })
                      }
                    >
                      Open business day
                    </Button>
                  ) : null}
                  {day?.state === 'OPEN' && closeBusinessDay.canExecute ? (
                    <Button
                      variant="primary"
                      disabled={busy || !dayReadyToClose}
                      aria-describedby={dayReadyToClose ? undefined : 'close-day-reason'}
                      onClick={() =>
                        askCommand({
                          commandType: 'CloseBusinessDay',
                          values: {
                            tenantId: context.tenantId,
                            stationId: context.stationId,
                            businessDayId: day.id,
                            expectedVersion: day.version,
                          },
                          subjectId: day.id,
                          title: 'Close business day?',
                          lines: [
                            { label: 'Date', value: formatBusinessDate(day.date) },
                            { label: 'Shifts', value: String(shiftsForDay.length) },
                          ],
                          confirmLabel: 'Close day',
                          success: 'Business day closed',
                          where: 'day',
                        })
                      }
                    >
                      Close business day
                    </Button>
                  ) : null}
                  {day?.state === 'OPEN' && closeBusinessDay.canExecute && !dayReadyToClose ? (
                    <p className="action-reason" id="close-day-reason">
                      Close every shift and get every reconciliation approved first.
                    </p>
                  ) : null}
                  {day?.state === 'CLOSED' && lockBusinessDay.canExecute ? (
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        askCommand({
                          commandType: 'LockBusinessDay',
                          values: {
                            tenantId: context.tenantId,
                            stationId: context.stationId,
                            businessDayId: day.id,
                            expectedVersion: day.version,
                          },
                          subjectId: day.id,
                          title: 'Lock business day?',
                          lines: [{ label: 'Date', value: formatBusinessDate(day.date) }],
                          note: 'This can’t be undone. Corrections after this need a named correction.',
                          confirmLabel: 'Lock day',
                          success: 'Business day locked',
                          where: 'day',
                        })
                      }
                    >
                      Lock business day
                    </Button>
                  ) : null}
                  {day?.state === 'CLOSED' &&
                  lockBusinessDay.permissionGranted &&
                  lockBusinessDay.requiresStepUp ? (
                    <>
                      {authProvider === 'CLERK' ? (
                        <ClerkStepUpForm
                          context={context}
                          busy={busy}
                          onSuccess={async () => {
                            toast.show('Identity confirmed');
                            await load();
                          }}
                        />
                      ) : mfaEnabled !== true ? (
                        <form
                          className="step-up-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (mfaSetup) void confirmMfaEnrollment();
                            else void startMfaEnrollment();
                          }}
                          aria-describedby="lock-business-day-step-up-help"
                        >
                          <p className="eyebrow">Authenticator setup required</p>
                          <p className="semantic-note">
                            Supervisor high-risk actions require password re-authentication plus an
                            authenticator code. Set up TOTP once, then use the current six-digit
                            code.
                          </p>
                          {!mfaSetup ? (
                            <>
                              <label htmlFor="mfa-setup-password">Current password</label>
                              <input
                                id="mfa-setup-password"
                                name="mfaSetupPassword"
                                type="password"
                                autoComplete="current-password"
                                value={mfaSetupPassword}
                                onChange={(event) => setMfaSetupPassword(event.target.value)}
                                required
                                disabled={busy || mfaBusy}
                              />
                              <Button
                                type="submit"
                                variant="secondary"
                                disabled={busy || mfaBusy || mfaSetupPassword.length === 0}
                                loading={mfaBusy}
                              >
                                Start authenticator setup
                              </Button>
                            </>
                          ) : (
                            <>
                              <p className="semantic-note">
                                Scan or enter this authenticator URI, save the backup codes
                                securely, then confirm with the current six-digit code.
                              </p>
                              <code className="mfa-uri">{mfaSetup.totpURI}</code>
                              <p className="semantic-note">
                                Backup codes: {mfaSetup.backupCodes.join(' · ')}
                              </p>
                              <label htmlFor="mfa-setup-code">Authenticator code</label>
                              <input
                                id="mfa-setup-code"
                                name="mfaSetupCode"
                                inputMode="numeric"
                                pattern="[0-9]{6}"
                                autoComplete="one-time-code"
                                value={mfaSetupCode}
                                onChange={(event) => setMfaSetupCode(event.target.value)}
                                required
                                disabled={busy || mfaBusy}
                              />
                              <Button
                                type="submit"
                                variant="secondary"
                                disabled={busy || mfaBusy || mfaSetupCode.length !== 6}
                                loading={mfaBusy}
                              >
                                Confirm authenticator
                              </Button>
                            </>
                          )}
                          {mfaError ? (
                            <p className="state state-error" role="alert">
                              {mfaError}
                            </p>
                          ) : null}
                        </form>
                      ) : (
                        <form
                          className="step-up-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void establishStepUp();
                          }}
                          aria-describedby="lock-business-day-step-up-help"
                        >
                          <label htmlFor="lock-business-day-step-up-password">
                            Confirm your password to unlock this action
                          </label>
                          <input
                            id="lock-business-day-step-up-password"
                            name="stepUpPassword"
                            type="password"
                            autoComplete="current-password"
                            value={stepUpPassword}
                            onChange={(event) => setStepUpPassword(event.target.value)}
                            required
                            disabled={busy || stepUpBusy}
                          />
                          <label htmlFor="lock-business-day-step-up-totp">Authenticator code</label>
                          <input
                            id="lock-business-day-step-up-totp"
                            name="stepUpTotpCode"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            autoComplete="one-time-code"
                            value={stepUpTotpCode}
                            onChange={(event) => setStepUpTotpCode(event.target.value)}
                            required
                            disabled={busy || stepUpBusy}
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            disabled={
                              busy ||
                              stepUpBusy ||
                              stepUpPassword.length === 0 ||
                              stepUpTotpCode.length !== 6
                            }
                            loading={stepUpBusy}
                          >
                            Verify step-up
                          </Button>
                          {stepUpError ? (
                            <p className="state state-error" role="alert">
                              {stepUpError}
                            </p>
                          ) : null}
                        </form>
                      )}
                      <Button
                        variant="danger"
                        disabled
                        aria-describedby="lock-business-day-step-up-help"
                      >
                        Lock business day
                      </Button>
                      <p
                        className="semantic-note"
                        id="lock-business-day-step-up-help"
                        role="status"
                      >
                        Locking this business day requires current privileged reverification.
                        Secrets are verified by the provider or server and are never stored by this
                        form.
                      </p>
                    </>
                  ) : null}
                </div>
                {errorAt('day')}
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

      <div className="content-grid operations-history-grid">
        <Card as="section" className="card panel cash-panel" aria-labelledby="day-history-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">History</p>
              <h2 id="day-history-title">Business days</h2>
            </div>
          </div>
          {overview.businessDays.length === 0 ? (
            <EmptyState
              title="No business-day history"
              message="No business days have been recorded for this station yet."
            />
          ) : (
            <div className="operations-list">
              {overview.businessDays.map((item) => (
                <a className="operations-list-row" key={item.id} href={dayHref(item.id)}>
                  <span>
                    <strong>{formatBusinessDate(item.date)}</strong>
                    <small>
                      Updated {formatTimestamp(item.updatedAt, overview.station.timezone)}
                    </small>
                  </span>
                  <StatusBadge tone={statusOf(item.state).tone}>{statusOf(item.state).label}</StatusBadge>
                </a>
              ))}
            </div>
          )}
        </Card>
        {focus === 'operations' ? (
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
                      <strong>{statusOf(item.state).label}</strong>
                      <small>
                        Revision {item.revision ?? '—'} · updated{' '}
                        {formatTimestamp(item.updatedAt, overview.station.timezone)}
                      </small>
                    </span>
                    <StatusBadge tone={statusOf(item.revisionState ?? item.state).tone}>
                      {item.revisionState ? statusOf(item.revisionState).label : 'No revision'}
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
        ) : null}
        <Card as="section" className="card panel cash-panel" aria-labelledby="timeline-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">History</p>
              <h2 id="timeline-title">Activity</h2>
            </div>
          </div>
          {!overview.visibility.auditTimeline ? (
            <EmptyState
              title="Audit history restricted"
              message="You do not have permission to view audit history for this station."
            />
          ) : overview.timeline.length === 0 ? (
            <EmptyState
              title="No recorded actions"
              message="Actions on this station will appear here with who did them and when."
            />
          ) : (
            <ol className="operations-timeline">
              {overview.timeline.map((event, index) => (
                <li key={`${event.eventCode}-${event.occurredAt}-${index}`}>
                  <div>
                    <strong>{eventLabel(event.eventCode)}</strong>
                    <small>
                      {event.actorName ?? 'Unknown person'} ·{' '}
                      {formatTimestamp(event.occurredAt, overview.station.timezone)}
                    </small>
                    {event.reason ? <p>{event.reason}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ''}
        lines={pending?.lines}
        note={pending?.note}
        confirmLabel={pending?.confirmLabel ?? 'Confirm'}
        busy={busy}
        onConfirm={() => void confirmPending()}
        onClose={() => setPending(null)}
      />
      {metersFor ? (
        <CloseMetersSheet
          open
          tenantId={context.tenantId}
          stationId={context.stationId}
          businessDayId={day?.id ?? ''}
          shiftId={metersFor.id}
          shiftVersion={metersFor.version}
          plannedStartAt={metersFor.plannedStartAt}
          plannedEndAt={metersFor.plannedEndAt}
          timezone={overview.station.timezone}
          onClose={() => setMetersFor(null)}
          onClosed={() => {
            setMetersFor(null);
            toast.show('Shift closed');
            void load();
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
