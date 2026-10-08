'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, ErrorState, StatusBadge } from '../../../design-system/primitives';
import { Section } from '../../../design-system/layout';
import { HeroStatusCard, RefreshButton, SkeletonCard } from '../../../design-system/page-kit';
import { formatBusinessDate, formatStatusSentence } from '../../../design-system/formatters';

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

export type Overview = {
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

export function tone(state: string): 'locked' | 'warning' | 'pending' | 'informational' {
  if (state === 'LOCKED' || state === 'APPROVED' || state === 'COMPLETED') return 'locked';
  if (state === 'RETURNED' || state === 'CLOSED') return 'warning';
  if (state === 'SUBMITTED' || state === 'PENDING_APPROVAL' || state === 'OPEN') return 'pending';
  return 'informational';
}

export function timeRange(start: string, end: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

export function formatTimestamp(value: string | null, timeZone: string) {
  return value
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }).format(new Date(value))
    : '—';
}

export function OperationsControlRoom({ context }: { context: Context }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpTotpCode, setStepUpTotpCode] = useState('');
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpError, setStepUpError] = useState<string>();
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
    async (preserveConflict = false) => {
      setLoading(true);
      setError(undefined);
      if (!preserveConflict) setConflict(undefined);
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        const body = (await response.json()) as Overview & { message?: string; error?: string };
        if (!response.ok) {
          if (response.status === 403)
            throw new Error('You don’t have access to daily operations for this station.');
          throw new Error(body.message ?? 'Daily operations could not be loaded.');
        }
        setOverview(body);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Daily operations could not be loaded.',
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
    if (!response.ok) return;
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
        body.message ?? 'That action could not be completed.',
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
      return 'Locking the day needs your password and an authenticator code. Nothing was changed.';
    }
    return caught instanceof Error ? caught.message : 'That action could not be completed.';
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
      await command(commandType, values, subjectId);
      setNotice(success);
      await load();
    } catch (caught) {
      if (isConflictError(caught)) {
        await load(true);
        setConflict(
          'This changed somewhere else. The latest details are shown below. Check them and try again; nothing was repeated.',
        );
      } else {
        setError(commandErrorMessage(caught, commandType));
      }
    } finally {
      setBusy(false);
    }
  }

  async function establishStepUp() {
    setStepUpBusy(true);
    setStepUpError(undefined);
    setNotice(undefined);
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
        throw new Error(body.message ?? 'Verification failed.');
      }
      setStepUpPassword('');
      setStepUpTotpCode('');
      setNotice('Verified. You can lock the day now.');
      await load();
    } catch (caught) {
      setStepUpError(caught instanceof Error ? caught.message : 'Verification failed.');
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
      setNotice('Authenticator is set up. Enter a current code to continue.');
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

  if (loading && !overview) {
    return (
      <div className="operations-control-room" aria-busy="true">
        <SkeletonCard label="Loading daily operations" lines={4} />
        <SkeletonCard label="Loading shifts" lines={3} />
      </div>
    );
  }
  if (error && !overview)
    return (
      <ErrorState
        title="Daily operations unavailable"
        message={error}
        action={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  if (!overview) return null;

  const day = overview.selectedBusinessDay;
  const isCurrentDay = !day || day.id === overview.currentBusinessDayId;
  const openDayId = day?.id ?? crypto.randomUUID();
  const openBusinessDay = overview.actions.OpenBusinessDay;
  const closeBusinessDay = overview.actions.CloseBusinessDay;
  const lockBusinessDay = overview.actions.LockBusinessDay;
  const dayState = day?.state ?? 'NOT_STARTED';
  const displayDate = formatBusinessDate(day ? day.date : overview.currentBusinessDate);
  const canOpen = (!day || day.state === 'NOT_STARTED') && openBusinessDay.canExecute;
  const heroDetail = day
    ? `${isCurrentDay ? 'Today · ' : ''}${displayDate}`
    : canOpen
      ? 'Start the day to begin taking shifts.'
      : `Today · ${displayDate}`;

  const heroAction = canOpen ? (
    <Button
      variant="primary"
      size="lg"
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
          'Start the day for this station?',
          'Day started.',
        )
      }
    >
      Start day
    </Button>
  ) : day?.state === 'OPEN' && closeBusinessDay.canExecute ? (
    <Button
      variant="primary"
      size="lg"
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
          'Close the day? Every shift that ran must be finished and its meters closed first.',
          'Day closed.',
        )
      }
    >
      Close day
    </Button>
  ) : day?.state === 'CLOSED' && lockBusinessDay.canExecute ? (
    <Button
      variant="danger"
      size="lg"
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
          'Lock this day? This cannot be undone and stops ordinary changes.',
          'Day locked.',
        )
      }
    >
      Lock day
    </Button>
  ) : null;

  const needsStepUp =
    day?.state === 'CLOSED' && lockBusinessDay.permissionGranted && lockBusinessDay.requiresStepUp;

  return (
    <div className="operations-control-room" aria-label="Operations control room">
      {error ? (
        <ErrorState
          title="That didn’t work"
          message={error}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : null}
      {conflict ? (
        <ErrorState
          title="This changed"
          message={conflict}
          action={<Button onClick={() => void load()}>Reload</Button>}
        />
      ) : null}
      {notice ? (
        <p className="state state-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <div className="page-split">
        <div className="page-main">
          <section className="section" aria-label="Business day">
            <HeroStatusCard
              title={overview.station.name}
              detail={heroDetail}
              status={
                <StatusBadge tone={tone(dayState)}>{formatStatusSentence(dayState)}</StatusBadge>
              }
              action={heroAction}
            />
            {day && (day.openedAt || day.closedAt) ? (
              <dl className="operational-summary">
                <div>
                  <dt>Opened</dt>
                  <dd>
                    {day.openedAt ? formatTimestamp(day.openedAt, overview.station.timezone) : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Closed</dt>
                  <dd>
                    {day.closedAt ? formatTimestamp(day.closedAt, overview.station.timezone) : '—'}
                  </dd>
                </div>
              </dl>
            ) : null}
          </section>

          {needsStepUp ? (
            <Section title="Lock this day" headingId="lock-day-title">
              <div className="form-actions">
                {mfaEnabled !== true ? (
                  <form
                    className="step-up-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (mfaSetup) void confirmMfaEnrollment();
                      else void startMfaEnrollment();
                    }}
                    aria-describedby="lock-business-day-step-up-help"
                  >
                    <strong>Set up your authenticator</strong>
                    <p className="semantic-note">
                      Locking a day needs your password and a code from an authenticator app. Set it
                      up once, then use the current six-digit code.
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
                          Add this to your authenticator app, keep the backup codes somewhere safe,
                          then enter the current six-digit code.
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
                      Confirm your password to continue
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
                      Verify
                    </Button>
                    {stepUpError ? (
                      <p className="state state-error" role="alert">
                        {stepUpError}
                      </p>
                    ) : null}
                  </form>
                )}
                <Button variant="danger" disabled aria-describedby="lock-business-day-step-up-help">
                  Lock business day
                </Button>
                <p className="semantic-note" id="lock-business-day-step-up-help" role="status">
                  Locking this business day requires current password and authenticator
                  verification. Secrets are verified by the server and are never stored by this
                  form.
                </p>
                <Button variant="danger" disabled aria-describedby="lock-business-day-step-up-help">
                  Lock day
                </Button>
                <p className="semantic-note" id="lock-business-day-step-up-help" role="status">
                  Locking needs your password and an authenticator code. It can’t be undone;
                  corrections after that are made as separate adjustments.
                </p>
              </div>
            </Section>
          ) : null}

          <Section
            title="Shifts"
            headingId="shifts-title"
            action={<RefreshButton onClick={() => void load()} disabled={loading} />}
          >
            {!day || overview.shifts.length === 0 ? (
              <EmptyState
                title="No shifts yet"
                message={day ? 'Shifts appear here once they are planned.' : 'Start the day first.'}
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
                        <strong>
                          {timeRange(
                            shift.plannedStartAt,
                            shift.plannedEndAt,
                            overview.station.timezone,
                          )}
                        </strong>
                        <small>
                          {shift.attendantCount} attendant{shift.attendantCount === 1 ? '' : 's'}
                        </small>
                      </div>
                      <StatusBadge tone={tone(shift.state)}>
                        {formatStatusSentence(shift.state)}
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
                                'Start this shift?',
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
                                'Close the meters for this shift? The final meter readings must already be entered.',
                                'Meters closed.',
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
                                'Finish this shift?',
                                'Shift finished.',
                              )
                            }
                          >
                            Finish shift
                          </Button>
                        ) : null}
                        <a className="text-link" href={dayHref(day.id, shift.id)}>
                          Open
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
          </Section>

          <Section title="Reconciliations" headingId="reconciliations-title">
            {!overview.visibility.reconciliations ? (
              <EmptyState
                title="No access"
                message="You don’t have access to reconciliations for this station."
              />
            ) : overview.reconciliations.length === 0 ? (
              <EmptyState
                title="No reconciliations yet"
                message="They appear here when a shift is closed."
              />
            ) : (
              <div className="operations-list">
                {overview.reconciliations.map((item) => (
                  <div className="operations-list-row" key={item.id}>
                    <span>
                      <strong>{formatStatusSentence(item.state)}</strong>
                      <small>
                        Updated {formatTimestamp(item.updatedAt, overview.station.timezone)}
                      </small>
                    </span>
                    <StatusBadge tone={tone(item.state)}>
                      {item.revisionState ? formatStatusSentence(item.revisionState) : 'Draft'}
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
          </Section>
        </div>

        <div className="page-side">
          <Section title="Previous days" headingId="day-history-title">
            {overview.businessDays.length === 0 ? (
              <EmptyState title="No days yet" message="Days you start will be listed here." />
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
                    <StatusBadge tone={tone(item.state)}>
                      {formatStatusSentence(item.state)}
                    </StatusBadge>
                  </a>
                ))}
              </div>
            )}
          </Section>

          <Section title="Activity" headingId="timeline-title">
            {!overview.visibility.auditTimeline ? (
              <EmptyState
                title="No access"
                message="You don’t have access to activity for this station."
              />
            ) : overview.timeline.length === 0 ? (
              <EmptyState title="Nothing yet" message="What people do here will be listed." />
            ) : (
              <ol className="operations-timeline">
                {overview.timeline.map((event, index) => (
                  <li key={`${event.eventCode}-${event.occurredAt}-${index}`}>
                    <div>
                      <strong>
                        {formatStatusSentence(event.eventCode.replace('FORECOURT.', ''))}
                      </strong>
                      <small>
                        {event.actorName ?? 'Unknown user'} ·{' '}
                        {formatTimestamp(event.occurredAt, overview.station.timezone)}
                      </small>
                      {event.reason ? <p>{event.reason}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
