'use client';

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
        throw new Error(body.message ?? 'Step-up verification failed.');
      }
      setStepUpPassword('');
      setStepUpTotpCode('');
      setNotice('Step-up authentication verified. The lock action is now available briefly.');
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
      setNotice('Authenticator MFA is enabled. Enter a current code to establish step-up.');
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
              message="Open the server-derived current business date to begin operations."
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
                    'Open this server-derived business day?',
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
                    'Close this business day? The server will require all operated shifts and meter evidence to be complete.',
                    'Business day closed after server validation.',
                  )
                }
              >
                Close business day
              </Button>
            ) : null}
            {day?.state === 'CLOSED' && lockBusinessDay.canExecute ? (
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
            {day?.state === 'CLOSED' &&
            lockBusinessDay.permissionGranted &&
            lockBusinessDay.requiresStepUp ? (
              <>
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
                    <p className="eyebrow">Authenticator setup required</p>
                    <p className="semantic-note">
                      Supervisor high-risk actions require password re-authentication plus an
                      authenticator code. Set up TOTP once, then use the current six-digit code.
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
                          Scan or enter this authenticator URI, save the backup codes securely, then
                          confirm with the current six-digit code.
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
                <Button variant="danger" disabled aria-describedby="lock-business-day-step-up-help">
                  Lock business day
                </Button>
                <p className="semantic-note" id="lock-business-day-step-up-help" role="status">
                  Locking this business day requires current password and authenticator
                  verification. Secrets are verified by the server and are never stored by this
                  form.
                </p>
              </>
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
                    <small>
                      Updated {formatTimestamp(item.updatedAt, overview.station.timezone)}
                    </small>
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
                    <strong>
                      {timeRange(
                        shift.plannedStartAt,
                        shift.plannedEndAt,
                        overview.station.timezone,
                      )}
                    </strong>
                    <small>
                      {shift.attendantCount} attendant{shift.attendantCount === 1 ? '' : 's'} ·{' '}
                      {shift.id}
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
                    {shift.state === 'METER_CLOSED' && overview.actions.CompleteShift.canExecute ? (
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
          {!overview.visibility.reconciliations ? (
            <EmptyState
              title="Reconciliation details restricted"
              message="You do not have permission to view reconciliation details for this station."
            />
          ) : overview.reconciliations.length === 0 ? (
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
          {!overview.visibility.auditTimeline ? (
            <EmptyState
              title="Audit history restricted"
              message="You do not have permission to view audit history for this station."
            />
          ) : overview.timeline.length === 0 ? (
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
                      {event.actorName ?? 'Unknown actor'} ·{' '}
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
    </div>
  );
}
