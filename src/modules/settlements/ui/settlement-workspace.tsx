'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildContextHref,
  contextRoutePolicy,
  type ContextResolution,
  type ContextSelection,
} from '@/modules/context';
import Decimal from 'decimal.js';
import {
  formatBusinessDate,
  formatMoneyDisplay,
  formatStatusSentence,
} from '../../../design-system/formatters';
import { Section } from '../../../design-system/layout';
import {
  ActionSheet,
  KpiGrid,
  KpiTile,
  RefreshButton,
  SkeletonCard,
  SkeletonTiles,
} from '../../../design-system/page-kit';
import {
  AccessDeniedState,
  Button,
  ConflictState,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  Field,
  Skeleton,
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

const METHOD_LABELS: Record<string, string> = { POS: 'Card', ECOCASH: 'EcoCash' };

function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? formatStatusSentence(method);
}

/** Exact decimal total of server amounts, returned as a string for display. */
function sumAmounts(values: string[]): string {
  return values.reduce((total, value) => total.plus(new Decimal(value)), new Decimal(0)).toFixed(4);
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
  const [matchOpen, setMatchOpen] = useState(false);
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
        throw apiError(body?.message ?? 'The station could not be loaded.', body?.error, true);
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
          'Choose the station for this page at the top of the screen.',
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
        throw apiError(body?.message ?? 'Provider payouts could not be loaded', body?.error);
      }
      if (!unmatchedResponse.ok) {
        const body = unmatchedBody as { message?: string; error?: string } | null;
        throw apiError(body?.message ?? 'Unmatched payments could not be loaded', body?.error);
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
            : apiError(cause instanceof Error ? cause.message : 'Payouts could not be loaded');
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
          : apiError(cause instanceof Error ? cause.message : 'Payouts could not be loaded');
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
      throw apiError(failure?.message ?? 'That could not be saved', failure?.error);
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

  async function allocate(): Promise<boolean> {
    if (!context || !selectedSettlement || !paymentId) return false;
    if (!isPositiveDecimal(amount)) {
      setAmountError('Enter an amount greater than zero.');
      return false;
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
        throw new Error('The match was saved, but the latest payouts could not be loaded.');
      }
      forgetAttempt(logicalKey);
      setAmount('');
      setMessage('Payment matched.');
      return true;
    } catch (cause) {
      const failure = isApiError(cause)
        ? cause
        : apiError(cause instanceof Error ? cause.message : 'The match could not be saved');
      handleCommandError(failure, 'The match could not be saved');
      if (failure.code === 'CONFLICT' || failure.code === 'IDEMPOTENCY_CONFLICT') {
        await refresh(context);
        setErrorKind('conflict');
        setError(failure.message);
      }
      return false;
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
      setMessage('Enter a reason for the difference, then confirm.');
      return;
    }
    const reason = hasVariance ? reconciliationReason.trim() : null;
    if (hasVariance && !reason) {
      setErrorKind('error');
      setError('Enter a reason for the difference.');
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
        throw new Error('It was saved, but the latest payouts could not be loaded.');
      }
      forgetAttempt(logicalKey);
      setPendingReconciliationId('');
      setReconciliationReason('');
      setMessage(hasVariance ? 'Difference recorded.' : 'Payout reconciled.');
    } catch (cause) {
      const failure = isApiError(cause)
        ? cause
        : apiError(cause instanceof Error ? cause.message : 'The payout could not be reconciled');
      handleCommandError(failure, 'The payout could not be reconciled');
      if (failure.code === 'CONFLICT' || failure.code === 'IDEMPOTENCY_CONFLICT') {
        await refresh(context);
        setErrorKind('conflict');
        setError(failure.message);
      }
    } finally {
      setWorking(false);
    }
  }

  if (workspaceState === 'loading') {
    return (
      <div className="settlements-page" aria-busy="true">
        <SkeletonTiles count={3} label="Loading provider payouts" />
        <SkeletonCard label="Loading provider payouts" lines={3} />
      </div>
    );
  }

  if (workspaceState !== 'ready') {
    return workspaceState === 'required' ? (
      <ContextRequiredState
        title="Choose a station"
        message={contextMessage || 'Pick the station at the top of the page to see its payouts.'}
      />
    ) : (
      <ErrorState
        title="Payouts unavailable"
        message={contextMessage || 'The station could not be loaded.'}
        action={<Button onClick={() => window.location.reload()}>Try again</Button>}
      />
    );
  }

  const canShowSettlementRows =
    !loading && settlements.length > 0 && (!error || errorKind === 'conflict');
  const canShowUnmatchedRows =
    !loading && unmatched.length > 0 && (!error || errorKind === 'conflict');
  const ready = !loading && !error;
  const waitingForPayout = sumAmounts(unmatched.map((row) => row.unallocatedAmount));
  const paidOut = sumAmounts(settlements.map((row) => row.grossAmount));
  const notMatched = sumAmounts(settlements.map((row) => row.unallocatedProviderAmount));
  const tileState = loading ? 'loading' : error ? 'error' : 'ready';

  const notices = (
    <>
      {error && errorKind === 'conflict' ? <ConflictState message={error} /> : null}
      {error && errorKind === 'access' ? <AccessDeniedState message={error} /> : null}
      {error && errorKind === 'error' ? <ErrorState message={error} /> : null}
    </>
  );

  return (
    <div className="settlements-page">
      <div className="kpi-section">
        <KpiGrid label="Provider payouts">
          <KpiTile
            label="Waiting for payout"
            icon="clock"
            state={tileState}
            value={ready ? formatMoneyDisplay(waitingForPayout) : null}
          />
          <KpiTile
            label="Paid out"
            icon="wallet"
            state={tileState}
            value={ready ? formatMoneyDisplay(paidOut) : null}
          />
          <KpiTile
            label="Not matched yet"
            icon="alert"
            state={tileState}
            value={ready ? formatMoneyDisplay(notMatched) : null}
          />
        </KpiGrid>
      </div>

      {matchOpen ? null : notices}
      {message && !matchOpen ? (
        <p className="state state-success" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      <Section
        title="Provider payouts"
        headingId="provider-payouts-title"
        action={<RefreshButton onClick={() => void refresh()} disabled={loading || working} />}
      >
        {loading ? <Skeleton lines={3} label="Loading provider payouts" /> : null}
        {!loading && !error && settlements.length === 0 ? (
          <EmptyState
            title="No payouts yet"
            message="Payouts from EcoCash and card providers appear here."
          />
        ) : null}
        {canShowSettlementRows ? (
          <TableScrollRegion label="Provider payouts">
            <table className="responsive-table">
              <caption className="visually-hidden">Provider payouts</caption>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Dates</th>
                  <th scope="col">Paid out</th>
                  <th scope="col">Matched</th>
                  <th scope="col">Not matched</th>
                  <th scope="col">Fees</th>
                  <th scope="col">Net</th>
                  <th scope="col">Difference</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((row) => {
                  const isPendingReason = pendingReconciliationId === row.settlementId;
                  return (
                    <tr key={row.settlementId}>
                      <td data-label="Provider">
                        <strong>{row.providerName}</strong>
                        <br />
                        {row.settlementReference}
                        <br />
                        <small>{row.accountReference}</small>
                      </td>
                      <td data-label="Dates">
                        <span className="numeric">{formatBusinessDate(row.transactionDate)}</span>
                        <br />
                        <small>Paid {formatBusinessDate(row.settlementDate)}</small>
                      </td>
                      <td data-label="Paid out" className="numeric">
                        {formatMoneyDisplay(row.grossAmount, row.currency)}
                      </td>
                      <td data-label="Matched" className="numeric">
                        {formatMoneyDisplay(row.allocatedAmount, row.currency)}
                      </td>
                      <td data-label="Not matched" className="numeric">
                        {formatMoneyDisplay(row.unallocatedProviderAmount, row.currency)}
                      </td>
                      <td data-label="Fees" className="numeric">
                        <span>
                          Fee{' '}
                          {row.providerFeeAmount
                            ? formatMoneyDisplay(row.providerFeeAmount, row.currency)
                            : '—'}
                        </span>
                        <br />
                        <small>
                          Deduction{' '}
                          {row.providerDeductionAmount
                            ? formatMoneyDisplay(row.providerDeductionAmount, row.currency)
                            : '—'}
                        </small>
                      </td>
                      <td data-label="Net" className="numeric">
                        {row.reportedNetAmount
                          ? formatMoneyDisplay(row.reportedNetAmount, row.currency)
                          : '—'}
                      </td>
                      <td data-label="Difference" className="numeric">
                        {formatMoneyDisplay(row.varianceAmount, row.currency)}
                      </td>
                      <td data-label="Status">
                        <StatusBadge tone={settlementTone(row.state)}>
                          {formatStatusSentence(row.state)}
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
                                  label="Reason for the difference"
                                  hint="Needed because the matched payments don’t add up to the payout."
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
                          <span>Done</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : null}
      </Section>

      <Section
        title="Unmatched payments"
        headingId="matching-title"
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setError(null);
              setMessage(null);
              setMatchOpen(true);
            }}
            disabled={!canShowUnmatchedRows || settlements.length === 0}
          >
            Match payment
          </Button>
        }
      >
        {loading ? <Skeleton lines={2} label="Loading unmatched payments" /> : null}
        {!loading && !error && unmatched.length === 0 ? (
          <EmptyState
            title="Everything is matched"
            message="Card and EcoCash payments waiting for a payout appear here."
          />
        ) : null}
        {canShowUnmatchedRows ? (
          <TableScrollRegion label="Unmatched payments">
            <table className="responsive-table">
              <caption className="visually-hidden">Unmatched payments</caption>
              <thead>
                <tr>
                  <th scope="col">Payment</th>
                  <th scope="col">Date</th>
                  <th scope="col">Shift status</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Left to match</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((row) => (
                  <tr key={row.paymentId}>
                    <td data-label="Payment">
                      <strong>{methodLabel(row.method)}</strong>
                      <br />
                      {row.reference ?? row.paymentId.slice(0, 12)}
                    </td>
                    <td data-label="Date" className="numeric">
                      {formatBusinessDate(row.businessDate)}
                    </td>
                    <td data-label="Shift status">
                      <StatusBadge tone="informational">
                        {formatStatusSentence(row.reconciliationState)}
                      </StatusBadge>
                    </td>
                    <td data-label="Amount" className="numeric">
                      {formatMoneyDisplay(row.amount)}
                    </td>
                    <td data-label="Left to match" className="numeric">
                      {formatMoneyDisplay(row.unallocatedAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : null}
        {error && !matchOpen ? (
          <p className="field-hint">Matching is unavailable until the latest data loads.</p>
        ) : null}
      </Section>

      <ActionSheet
        title="Match payment"
        description="Choose a payout, the payment it covers, and how much."
        open={matchOpen}
        onOpenChange={setMatchOpen}
        dismissible={!working}
      >
        {() => (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void allocate().then((saved) => {
                if (saved) setMatchOpen(false);
              });
            }}
          >
            {notices}
            <Field id="settlement" label="Payout" required>
              <select
                id="settlement"
                value={settlementId}
                onChange={(event) => setSettlementId(event.target.value)}
              >
                <option value="">Choose a payout</option>
                {settlements.map((row) => (
                  <option key={row.settlementId} value={row.settlementId}>
                    {row.providerName} · {row.settlementReference} ·{' '}
                    {formatMoneyDisplay(row.unallocatedProviderAmount, row.currency)} left
                  </option>
                ))}
              </select>
            </Field>
            <Field id="payment" label="Payment" required>
              <select
                id="payment"
                value={paymentId}
                onChange={(event) => setPaymentId(event.target.value)}
              >
                <option value="">Choose a payment</option>
                {unmatched.map((row) => (
                  <option key={row.paymentId} value={row.paymentId}>
                    {methodLabel(row.method)} · {formatBusinessDate(row.businessDate)} ·{' '}
                    {formatMoneyDisplay(row.unallocatedAmount)} ·{' '}
                    {row.reference ?? row.paymentId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="allocation-amount"
              label="Amount to match"
              hint="You can match part of a payment."
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
                placeholder="0.00"
                required
              />
            </Field>
            <div className="sheet-actions">
              <Button
                type="submit"
                loading={working}
                disabled={!selectedSettlement || !paymentId || !context}
                block
              >
                Match payment
              </Button>
              <Button type="button" variant="secondary" onClick={() => setMatchOpen(false)} block>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </ActionSheet>
    </div>
  );
}
