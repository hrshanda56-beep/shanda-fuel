'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildContextHref,
  contextRoutePolicy,
  type ContextResolution,
  type ContextSelection,
} from '@/modules/context';
import { formatMoney } from '../../../design-system/formatters';
import {
  AccessDeniedState,
  Button,
  Card,
  ConflictState,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '../../../design-system/primitives';
import { TableScrollRegion } from '../../../design-system/table';
import type { ProviderSettlementSummaryRow, UnmatchedProviderPaymentRow } from '../contracts';

type SettlementContext = ContextSelection & {
  canonicalHref: string;
};

type WorkspaceState = 'loading' | 'ready' | 'required' | 'error';
type ErrorKind = 'error' | 'conflict' | 'access';
type AttemptKeys = { idempotencyKey: string; allocationKey: string };
type ApiError = Error & { code?: string; contextFailure?: boolean };

function apiError(message: string, code?: string, contextFailure = false): ApiError {
  const error = new Error(message) as ApiError;
  error.code = code;
  error.contextFailure = contextFailure;
  return error;
}

function isZeroAmount(value: string): boolean {
  return /^0(?:\.0+)?$/.test(value.trim());
}

function isPositiveDecimal(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return false;
  return trimmed
    .replaceAll('.', '')
    .split('')
    .some((digit) => digit !== '0');
}

function settlementTone(state: ProviderSettlementSummaryRow['state']) {
  switch (state) {
    case 'RECONCILED':
      return 'positive' as const;
    case 'EXCEPTION':
      return 'critical' as const;
    case 'PARTIALLY_MATCHED':
      return 'warning' as const;
    default:
      return 'informational' as const;
  }
}

function settlementStateLabel(state: ProviderSettlementSummaryRow['state']): string {
  return state.replaceAll('_', ' ');
}

function isApiError(value: unknown): value is ApiError {
  return value instanceof Error;
}

function commandFailureKind(error: ApiError): ErrorKind {
  if (error.code === 'CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT') return 'conflict';
  if (error.code === 'FORBIDDEN' || error.code === 'UNAUTHENTICATED') return 'access';
  return 'error';
}

export function SettlementWorkspace({ stationId }: { stationId: string }) {
  const pathname = usePathname() ?? `/stations/${encodeURIComponent(stationId)}/settlements`;
  const routePolicy = contextRoutePolicy(pathname);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>('loading');
  const [contextMessage, setContextMessage] = useState('');
  const [context, setContext] = useState<SettlementContext | null>(null);
  const [settlements, setSettlements] = useState<ProviderSettlementSummaryRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedProviderPaymentRow[]>([]);
  const [settlementId, setSettlementId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>('error');
  const [message, setMessage] = useState<string | null>(null);
  const [pendingReconciliationId, setPendingReconciliationId] = useState('');
  const [reconciliationReason, setReconciliationReason] = useState('');
  const attemptKeys = useRef(new Map<string, AttemptKeys>());

  const selectedSettlement = useMemo(
    () => settlements.find((row) => row.settlementId === settlementId),
    [settlements, settlementId],
  );

  const applySettlementData = useCallback(
    (data: {
      settlements: ProviderSettlementSummaryRow[];
      unmatched: UnmatchedProviderPaymentRow[];
    }) => {
      setSettlements(data.settlements);
      setUnmatched(data.unmatched);
      setSettlementId((current) =>
        data.settlements.some((row) => row.settlementId === current)
          ? current
          : (data.settlements[0]?.settlementId ?? ''),
      );
      setPaymentId((current) =>
        data.unmatched.some((row) => row.paymentId === current)
          ? current
          : (data.unmatched[0]?.paymentId ?? ''),
      );
    },
    [],
  );

  const resolveContext = useCallback(
    async (signal: AbortSignal): Promise<SettlementContext> => {
      const params = new URLSearchParams(window.location.search);
      params.set('pathname', pathname);
      const response = await fetch(`/api/context?${params.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });
      const body = (await response.json().catch(() => null)) as {
        data?: ContextResolution;
        error?: string;
        message?: string;
      } | null;
      if (!response.ok || !body?.data) {
        throw apiError(
          body?.message ?? 'The authorised station context could not be loaded.',
          body?.error,
          true,
        );
      }

      const current = body.data.current;
      if (
        !current ||
        routePolicy.station !== 'required' ||
        current.allStations ||
        !current.stationId ||
        current.stationId !== stationId
      ) {
        throw apiError(
          'Choose the authorised station for this settlement workspace before loading settlement data.',
          'FORBIDDEN',
          true,
        );
      }
      const canonicalHref = buildContextHref(pathname, window.location.search, current);
      return { ...current, canonicalHref };
    },
    [pathname, routePolicy.station, stationId],
  );

  const loadSettlementData = useCallback(
    async (activeContext: SettlementContext, signal?: AbortSignal) => {
      const canonicalUrl = new URL(activeContext.canonicalHref, window.location.origin);
      const params = new URLSearchParams({
        tenantId: canonicalUrl.searchParams.get('tenantId') ?? activeContext.organisationId,
        stationId: activeContext.stationId ?? '',
      });
      const [settlementResponse, unmatchedResponse] = await Promise.all([
        fetch(`/api/settlements/summary?${params.toString()}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        }),
        fetch(`/api/settlements/unmatched?${params.toString()}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        }),
      ]);
      const settlementBody = (await settlementResponse.json().catch(() => null)) as
        { message?: string; error?: string } | ProviderSettlementSummaryRow[] | null;
      const unmatchedBody = (await unmatchedResponse.json().catch(() => null)) as
        { message?: string; error?: string } | UnmatchedProviderPaymentRow[] | null;
      if (!settlementResponse.ok) {
        const body = settlementBody as { message?: string; error?: string } | null;
        throw apiError(body?.message ?? 'Provider settlements could not be loaded', body?.error);
      }
      if (!unmatchedResponse.ok) {
        const body = unmatchedBody as { message?: string; error?: string } | null;
        throw apiError(
          body?.message ?? 'Unmatched payment evidence could not be loaded',
          body?.error,
        );
      }
      return {
        settlements: settlementBody as ProviderSettlementSummaryRow[],
        unmatched: unmatchedBody as UnmatchedProviderPaymentRow[],
      };
    },
    [],
  );

  const refresh = useCallback(
    async (activeContext = context, signal?: AbortSignal): Promise<boolean> => {
      if (!activeContext) return false;
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const data = await loadSettlementData(activeContext, signal);
        if (!signal?.aborted) applySettlementData(data);
        return true;
      } catch (cause) {
        if (!signal?.aborted) {
          const failure = isApiError(cause)
            ? cause
            : apiError(
                cause instanceof Error ? cause.message : 'Settlement data could not be loaded',
              );
          setErrorKind(commandFailureKind(failure));
          setError(failure.message);
        }
        return false;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [applySettlementData, context, loadSettlementData],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setWorkspaceState('loading');
      setContextMessage('');
      setContext(null);
      setSettlements([]);
      setUnmatched([]);
      setSettlementId('');
      setPaymentId('');
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const activeContext = await resolveContext(controller.signal);
        if (controller.signal.aborted) return;
        setContext(activeContext);
        setWorkspaceState('ready');
        const data = await loadSettlementData(activeContext, controller.signal);
        if (controller.signal.aborted) return;
        applySettlementData(data);
      } catch (cause) {
        if (controller.signal.aborted) return;
        const failure = isApiError(cause)
          ? cause
          : apiError(
              cause instanceof Error ? cause.message : 'Settlement data could not be loaded',
            );
        if (failure.contextFailure) {
          setWorkspaceState(failure.code === 'FORBIDDEN' ? 'required' : 'error');
          setContextMessage(failure.message);
        } else {
          setWorkspaceState('ready');
          setErrorKind(commandFailureKind(failure));
          setError(failure.message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [applySettlementData, loadSettlementData, resolveContext]);

  function stableAttempt(logicalKey: string): AttemptKeys {
    const existing = attemptKeys.current.get(logicalKey);
    if (existing) return existing;
    const created = {
      idempotencyKey: `settlement-ui-${crypto.randomUUID()}`,
      allocationKey: `settlement-allocation-${crypto.randomUUID()}`,
    };
    attemptKeys.current.set(logicalKey, created);
    return created;
  }

  function forgetAttempt(logicalKey: string) {
    attemptKeys.current.delete(logicalKey);
  }

  async function postCommand(input: Record<string, unknown>, logicalKey: string) {
    const keys = stableAttempt(logicalKey);
    const response = await fetch('/api/settlements/commands', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': keys.idempotencyKey,
      },
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => null)) as
      { message?: string; error?: string } | Record<string, unknown> | null;
    if (!response.ok) {
      const failure = body as { message?: string; error?: string } | null;
      throw apiError(
        failure?.message ?? 'The settlement command could not be saved',
        failure?.error,
      );
    }
    return { body, keys };
  }

  function handleCommandError(cause: unknown, fallback: string) {
    const failure = isApiError(cause)
      ? cause
      : apiError(cause instanceof Error ? cause.message : fallback);
    setErrorKind(commandFailureKind(failure));
    setError(failure.message || fallback);
  }

  async function allocate() {
    if (!context || !selectedSettlement || !paymentId) return;
    if (!isPositiveDecimal(amount)) {
      setAmountError('Enter a positive amount using exact decimal notation.');
      return;
    }
    setAmountError(undefined);
    const logicalKey = `allocate:${selectedSettlement.settlementId}:${paymentId}:${amount}:${selectedSettlement.version}`;
    const keys = stableAttempt(logicalKey);
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await postCommand(
        {
          commandType: 'AllocateProviderSettlement',
          tenantId: context.organisationId,
          stationId: context.stationId,
          settlementId: selectedSettlement.settlementId,
          reconciliationPaymentId: paymentId,
          amount,
          allocationKey: keys.allocationKey,
          expectedVersion: selectedSettlement.version,
        },
        logicalKey,
      );
      const refreshed = await refresh(context);
      if (!refreshed) {
        throw new Error(
          'The allocation was saved, but the latest settlement view could not be loaded.',
        );
      }
      forgetAttempt(logicalKey);
      setAmount('');
      setMessage('Allocation saved and the settlement view was refreshed from the server.');
    } catch (cause) {
      const failure = isApiError(cause)
        ? cause
        : apiError(cause instanceof Error ? cause.message : 'Allocation could not be saved');
      handleCommandError(failure, 'Allocation could not be saved');
      if (failure.code === 'CONFLICT' || failure.code === 'IDEMPOTENCY_CONFLICT') {
        await refresh(context);
        setErrorKind('conflict');
        setError(failure.message);
      }
    } finally {
      setWorking(false);
    }
  }

  async function reconcile(row: ProviderSettlementSummaryRow) {
    const hasVariance = !isZeroAmount(row.varianceAmount);
    if (hasVariance && pendingReconciliationId !== row.settlementId) {
      setPendingReconciliationId(row.settlementId);
      setReconciliationReason('');
      setError(null);
      setMessage('Enter and confirm a reason before recording this settlement variance.');
      return;
    }
    const reason = hasVariance ? reconciliationReason.trim() : null;
    if (hasVariance && !reason) {
      setErrorKind('error');
      setError('A reason is required before reconciling a variance.');
      return;
    }
    if (!context) return;
    const logicalKey = `reconcile:${row.settlementId}:${row.version}:${reason ?? ''}`;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await postCommand(
        {
          commandType: 'ReconcileProviderSettlement',
          tenantId: context.organisationId,
          stationId: context.stationId,
          settlementId: row.settlementId,
          expectedVersion: row.version,
          reason,
        },
        logicalKey,
      );
      const refreshed = await refresh(context);
      if (!refreshed) {
        throw new Error(
          'The reconciliation was saved, but the latest settlement view could not be loaded.',
        );
      }
      forgetAttempt(logicalKey);
      setPendingReconciliationId('');
      setReconciliationReason('');
      setMessage(
        hasVariance
          ? 'Variance exception recorded and the settlement view was refreshed from the server.'
          : 'Settlement reconciled and the view was refreshed from the server.',
      );
    } catch (cause) {
      const failure = isApiError(cause)
        ? cause
        : apiError(cause instanceof Error ? cause.message : 'Settlement could not be reconciled');
      handleCommandError(failure, 'Settlement could not be reconciled');
      if (failure.code === 'CONFLICT' || failure.code === 'IDEMPOTENCY_CONFLICT') {
        await refresh(context);
        setErrorKind('conflict');
        setError(failure.message);
      }
    } finally {
      setWorking(false);
    }
  }

  if (workspaceState !== 'ready') {
    return (
      <div className="content-grid">
        <Card as="section" className="panel" aria-labelledby="settlements-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Electronic payment control</p>
              <h1 id="settlements-title">Provider settlements</h1>
            </div>
            <StatusBadge tone="pending">Station context required</StatusBadge>
          </div>
          <p>
            Settlement evidence is always loaded for one authorised station. Provider setup and
            settlement recording remain unavailable until their setup read support lands.
          </p>
          {workspaceState === 'loading' ? (
            <LoadingState label="Resolving authorised station context" />
          ) : workspaceState === 'required' ? (
            <ContextRequiredState
              title="Choose an authorised station"
              message={
                contextMessage ||
                'Use the work-context control above to select one authorised station before loading settlement data.'
              }
            />
          ) : (
            <ErrorState
              message={contextMessage || 'The authorised station context is unavailable.'}
            />
          )}
        </Card>
      </div>
    );
  }

  const canShowSettlementRows =
    !loading && settlements.length > 0 && (!error || errorKind === 'conflict');
  const canShowUnmatchedRows =
    !loading && unmatched.length > 0 && (!error || errorKind === 'conflict');

  return (
    <div className="content-grid">
      <Card as="section" className="panel" aria-labelledby="settlements-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Electronic payment control</p>
            <h1 id="settlements-title">Provider settlements</h1>
          </div>
          <Button
            variant="secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={loading || working}
          >
            Refresh
          </Button>
        </div>
        <p>
          POS and ECOCASH evidence is matched separately from cash custody and bank deposits. A
          settlement date may lag the transaction date.
        </p>
        <p className="field-hint">
          Provider setup and settlement recording are unavailable in this slice because their
          authorised read projection is not yet implemented.
        </p>
        {loading ? <LoadingState label="Loading provider settlements" /> : null}
        {error && errorKind === 'conflict' ? <ConflictState message={error} /> : null}
        {error && errorKind === 'access' ? <AccessDeniedState message={error} /> : null}
        {error && errorKind === 'error' ? <ErrorState message={error} /> : null}
        {message ? (
          <p role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
        {!loading && !error && settlements.length === 0 ? (
          <EmptyState
            title="No provider settlements yet"
            message="Record a provider statement or import after provider-account onboarding is available."
          />
        ) : null}
        {canShowSettlementRows ? (
          <TableScrollRegion label="Provider settlement reconciliation">
            <table className="responsive-table">
              <caption className="visually-hidden">Provider settlement reconciliation</caption>
              <thead>
                <tr>
                  <th scope="col">Provider / reference</th>
                  <th scope="col">Dates</th>
                  <th scope="col">Gross</th>
                  <th scope="col">Allocated</th>
                  <th scope="col">Unallocated</th>
                  <th scope="col">Fees / deductions</th>
                  <th scope="col">Reported net</th>
                  <th scope="col">Variance</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((row) => {
                  const isPendingReason = pendingReconciliationId === row.settlementId;
                  return (
                    <tr key={row.settlementId}>
                      <td data-label="Provider / reference">
                        <strong>{row.providerName}</strong>
                        <br />
                        {row.settlementReference}
                        <br />
                        <small>{row.accountReference}</small>
                      </td>
                      <td data-label="Dates">
                        <span className="numeric">{row.transactionDate}</span>
                        <br />
                        <small>Settled {row.settlementDate}</small>
                      </td>
                      <td data-label="Gross" className="numeric">
                        {formatMoney(row.grossAmount)}
                      </td>
                      <td data-label="Allocated" className="numeric">
                        {formatMoney(row.allocatedAmount)}
                      </td>
                      <td data-label="Unallocated" className="numeric">
                        {formatMoney(row.unallocatedProviderAmount)}
                      </td>
                      <td data-label="Fees / deductions" className="numeric">
                        <span>
                          Fee {row.providerFeeAmount ? formatMoney(row.providerFeeAmount) : '—'}
                        </span>
                        <br />
                        <small>
                          Deduction{' '}
                          {row.providerDeductionAmount
                            ? formatMoney(row.providerDeductionAmount)
                            : '—'}
                        </small>
                      </td>
                      <td data-label="Reported net" className="numeric">
                        {row.reportedNetAmount ? formatMoney(row.reportedNetAmount) : '—'}
                      </td>
                      <td data-label="Variance" className="numeric">
                        {formatMoney(row.varianceAmount)}
                      </td>
                      <td data-label="Status">
                        <StatusBadge tone={settlementTone(row.state)}>
                          {settlementStateLabel(row.state)}
                        </StatusBadge>
                      </td>
                      <td data-label="Action">
                        {row.state !== 'RECONCILED' ? (
                          <div>
                            <Button
                              variant="quiet"
                              type="button"
                              onClick={() => void reconcile(row)}
                              disabled={working}
                            >
                              {isPendingReason ? 'Confirm reconciliation' : 'Reconcile'}
                            </Button>
                            {isPendingReason ? (
                              <div className="demo-form">
                                <Field
                                  id={`reconcile-reason-${row.settlementId}`}
                                  label="Variance reason"
                                  hint="Required because allocated evidence differs from the settlement gross amount."
                                  required
                                >
                                  <input
                                    id={`reconcile-reason-${row.settlementId}`}
                                    value={reconciliationReason}
                                    onChange={(event) =>
                                      setReconciliationReason(event.target.value)
                                    }
                                    maxLength={500}
                                    required
                                  />
                                </Field>
                                <Button
                                  variant="quiet"
                                  type="button"
                                  onClick={() => {
                                    setPendingReconciliationId('');
                                    setReconciliationReason('');
                                  }}
                                  disabled={working}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span>Finalized</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : null}
      </Card>

      <Card as="section" className="panel" aria-labelledby="matching-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Named allocation</p>
            <h2 id="matching-title">Match electronic payment evidence</h2>
          </div>
          <StatusBadge tone="informational">No automatic inference</StatusBadge>
        </div>
        {!loading && !error && unmatched.length === 0 ? (
          <EmptyState
            title="No unmatched POS or ECOCASH evidence"
            message="Provider evidence from approved, posted, and locked reconciliations appears here until fully allocated."
          />
        ) : null}
        {canShowUnmatchedRows ? (
          <>
            <TableScrollRegion label="Unmatched provider payment evidence">
              <table className="responsive-table">
                <caption className="visually-hidden">Unmatched provider payment evidence</caption>
                <thead>
                  <tr>
                    <th scope="col">Method / reference</th>
                    <th scope="col">Business date</th>
                    <th scope="col">Reconciliation</th>
                    <th scope="col">Evidence amount</th>
                    <th scope="col">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.map((row) => (
                    <tr key={row.paymentId}>
                      <td data-label="Method / reference">
                        <strong>{row.method}</strong>
                        <br />
                        {row.reference ?? row.paymentId.slice(0, 12)}
                      </td>
                      <td data-label="Business date" className="numeric">
                        {row.businessDate}
                      </td>
                      <td data-label="Reconciliation">
                        <StatusBadge tone="informational">{row.reconciliationState}</StatusBadge>
                      </td>
                      <td data-label="Evidence amount" className="numeric">
                        {formatMoney(row.amount)}
                      </td>
                      <td data-label="Remaining" className="numeric">
                        {formatMoney(row.unallocatedAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
            <form
              className="demo-form"
              onSubmit={(event) => {
                event.preventDefault();
                void allocate();
              }}
            >
              <Field id="settlement" label="Provider settlement" required>
                <select
                  id="settlement"
                  value={settlementId}
                  onChange={(event) => setSettlementId(event.target.value)}
                >
                  <option value="">Select a settlement</option>
                  {settlements.map((row) => (
                    <option key={row.settlementId} value={row.settlementId}>
                      {row.providerName} · {row.settlementReference} ·{' '}
                      {row.unallocatedProviderAmount}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="payment" label="Payment evidence" required>
                <select
                  id="payment"
                  value={paymentId}
                  onChange={(event) => setPaymentId(event.target.value)}
                >
                  <option value="">Select payment evidence</option>
                  {unmatched.map((row) => (
                    <option key={row.paymentId} value={row.paymentId}>
                      {row.method} · {row.businessDate} · {row.unallocatedAmount} ·{' '}
                      {row.reference ?? row.paymentId.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="allocation-amount"
                label="Allocation amount"
                hint="Use an exact decimal amount. The server checks both remaining capacities."
                error={amountError}
                required
              >
                <input
                  id="allocation-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setAmountError(undefined);
                  }}
                  placeholder="0.0000"
                  required
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                loading={working}
                disabled={!selectedSettlement || !paymentId || !context}
              >
                Allocate evidence
              </Button>
            </form>
          </>
        ) : null}
        {loading ? <LoadingState label="Loading unmatched payment evidence" /> : null}
        {error ? (
          <p className="field-hint">
            Matching actions are unavailable until the latest data loads.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
