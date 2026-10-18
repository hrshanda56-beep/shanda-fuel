'use client';
import { useContextFetch } from '@/modules/context/client-context';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildContextHref,
  contextRoutePolicy,
  type ContextResolution,
  type ContextSelection,
} from '@/modules/context';
import { formatStatusLabel } from '../../../design-system/formatters';
import { formatTileMoney } from '@/modules/reporting/format';
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
import { EcoCashMark, MastercardMark, VisaMark } from './provider-logos';
import { Modal } from '../../../design-system/modal';
import { Select } from '../../../design-system/forms';
import { Icon } from '../../../design-system/icons';
import { CashDonut, type DonutSlice } from '@/modules/cash/ui/cash-visuals';
import type { ProviderSettlementSummaryRow, UnmatchedProviderPaymentRow } from '../contracts';
import { ProviderDonut } from './provider-donut';
import {
  allocatedPercent,
  initials,
  methodLabel,
  methodTotals,
  providerShares,
  settlementCounts,
  settlementStateLabel,
} from './settlement-summary';

function money(value: string, currency = 'USD'): string {
  return formatTileMoney(value, currency);
}

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

function isApiError(value: unknown): value is ApiError {
  return value instanceof Error;
}

function commandFailureKind(error: ApiError): ErrorKind {
  if (error.code === 'CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT') return 'conflict';
  if (error.code === 'FORBIDDEN' || error.code === 'UNAUTHENTICATED') return 'access';
  return 'error';
}

export function SettlementWorkspace({ stationId }: { stationId: string }) {
  const contextFetch = useContextFetch();
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
      const response = await contextFetch(`/api/context?${params.toString()}`, {
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
        throw apiError('Use the station selector above to choose a station.', 'FORBIDDEN', true);
      }
      const canonicalHref = buildContextHref(pathname, window.location.search, current);
      return { ...current, canonicalHref };
    },
    [pathname, routePolicy.station, stationId, contextFetch],
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
      setMatchOpen(false);
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
      <div className="content-grid cash-workspace settlement-workspace">
        <Card as="section" className="panel content-span" aria-label="Provider settlements">
          <p>Settlements are shown for one station at a time.</p>
          {workspaceState === 'loading' ? (
            <LoadingState label="Loading" />
          ) : workspaceState === 'required' ? (
            <ContextRequiredState
              title="Choose a station"
              message={contextMessage || 'Use the station selector above to choose a station.'}
            />
          ) : (
            <ErrorState message={contextMessage || 'The station could not be loaded.'} />
          )}
        </Card>
      </div>
    );
  }

  const canShowSettlementRows =
    !loading && settlements.length > 0 && (!error || errorKind === 'conflict');
  const canShowUnmatchedRows =
    !loading && unmatched.length > 0 && (!error || errorKind === 'conflict');

  const methods = methodTotals(unmatched);
  const counts = settlementCounts(settlements);
  const shares = providerShares(settlements);
  const dataReady = !loading && !error;
  const canMatch = dataReady && unmatched.length > 0 && settlements.length > 0 && Boolean(context);

  const shareCurrencies = new Set(shares.map((share) => share.currency));
  const providerSlices: DonutSlice[] = shares.map((share, index) => {
    const count = settlements.filter(
      (row) => `${row.providerName}|${row.currency}` === share.key,
    ).length;
    return {
      key: share.key,
      label: share.name,
      total: share.gross,
      count,
      detail: `${count} ${count === 1 ? 'settlement' : 'settlements'}`,
      tone: index % 6,
    };
  });

  const stateNotice = (
    <>
      {loading ? <LoadingState label="Loading provider settlements" /> : null}
      {error && errorKind === 'conflict' ? <ConflictState message={error} /> : null}
      {error && errorKind === 'access' ? <AccessDeniedState message={error} /> : null}
      {error && errorKind === 'error' ? <ErrorState message={error} /> : null}
    </>
  );

  return (
    <div className="content-grid cash-workspace settlement-workspace">
      <Card as="section" className="panel cash-panel" aria-labelledby="settlement-actions-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Provider payments</p>
            <h2 id="settlement-actions-title">Match Payments</h2>
          </div>
        </div>
        {dataReady ? (
          <div className="settlement-overview">
            <ul className="channel-cards" aria-label="Payments waiting to match">
              {(['ECOCASH', 'POS'] as const).map((method) => {
                const total = methods.find((row) => row.method === method);
                return (
                  <li
                    key={method}
                    className="channel-card"
                    data-waiting={total ? 'true' : undefined}
                  >
                    <div className="channel-logos">
                      {method === 'ECOCASH' ? (
                        <EcoCashMark />
                      ) : (
                        <>
                          <VisaMark />
                          <MastercardMark />
                        </>
                      )}
                    </div>
                    <p className="channel-label">{methodLabel(method)} waiting to match</p>
                    <p className="channel-amount">{total ? money(total.remaining) : money('0')}</p>
                    <span className="channel-pill">
                      {total
                        ? `${total.count} ${total.count === 1 ? 'payment' : 'payments'}`
                        : 'All matched'}
                    </span>
                  </li>
                );
              })}
            </ul>
            <dl className="settlement-status-strip" aria-label="Settlement summary">
              <div data-tone={counts.open > 0 ? 'info' : undefined}>
                <dt>Settlements not reconciled</dt>
                <dd>{counts.open}</dd>
              </div>
              <div data-tone={counts.exceptions > 0 ? 'warning' : 'ok'}>
                <dt>Exceptions</dt>
                <dd>{counts.exceptions}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <LoadingState label="Loading settlement summary" />
        )}
        <div className="cash-action-bar">
          <Button aria-haspopup="dialog" onClick={() => setMatchOpen(true)} disabled={!canMatch}>
            Match a payment
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={loading || working}
          >
            Refresh
          </Button>
        </div>

        <Modal
          open={matchOpen}
          onClose={() => setMatchOpen(false)}
          title="Match a payment to a settlement"
          presentation="side"
          dismissible={!working}
          className="cash-sheet"
        >
          {error ? (
            <ErrorState
              message={error}
              action={<Button onClick={() => void refresh()}>Refresh</Button>}
            />
          ) : null}
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void allocate();
            }}
          >
            <Field id="settlement" label="Provider settlement" required>
              <Select
                id="settlement"
                value={settlementId}
                onChange={(event) => setSettlementId(event.target.value)}
                options={settlements.map((row) => ({
                  value: row.settlementId,
                  label: `${row.providerName} · ${row.settlementReference} · ${money(row.unallocatedProviderAmount, row.currency)} left`,
                }))}
                placeholder="Select a settlement"
              />
            </Field>
            <Field id="payment" label="Payment evidence" required>
              <Select
                id="payment"
                value={paymentId}
                onChange={(event) => setPaymentId(event.target.value)}
                options={unmatched.map((row) => ({
                  value: row.paymentId,
                  label: `${methodLabel(row.method)} · ${row.businessDate} · ${money(row.unallocatedAmount)} · ${row.reference ?? row.paymentId.slice(0, 8)}`,
                }))}
                placeholder="Select payment evidence"
              />
            </Field>
            <Field
              id="allocation-amount"
              label="Allocation amount"
              hint="Up to the amount left on both the payment and the settlement."
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
            <Button
              type="submit"
              variant="primary"
              loading={working}
              disabled={!selectedSettlement || !paymentId || !context}
            >
              Allocate evidence
            </Button>
          </form>
        </Modal>
      </Card>

      <Card as="section" className="panel cash-panel" aria-labelledby="settled-by-provider-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Overview</p>
            <h2 id="settled-by-provider-title">Settled By Provider</h2>
          </div>
        </div>
        {!dataReady ? (
          <LoadingState label="Loading settlements" />
        ) : shares.length === 0 ? (
          <CashDonut
            slices={[]}
            currency="USD"
            centreValue="0"
            centreLabel="settlements"
            emptyMessage="Settled amounts appear here once a provider statement has been recorded."
          />
        ) : shareCurrencies.size === 1 ? (
          <CashDonut
            slices={providerSlices}
            currency={shares[0]?.currency ?? 'USD'}
            centreValue={String(settlements.length)}
            centreLabel={settlements.length === 1 ? 'settlement' : 'settlements'}
          />
        ) : (
          <ProviderDonut shares={shares} />
        )}
      </Card>

      <Card as="section" className="panel content-span" aria-labelledby="settlements-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Provider statements</p>
            <h2 id="settlements-title">Provider Settlements</h2>
          </div>
        </div>
        <p className="field-hint">
          EcoCash and card (POS) payments are matched here, separately from cash and bank deposits.
          A provider may settle a few days after the sale.
        </p>
        {matchOpen ? null : stateNotice}
        {message && !matchOpen ? (
          <p role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
        {!loading && !error && settlements.length === 0 ? (
          <EmptyState
            title="No provider settlements yet"
            message="Settlements appear here once a provider statement has been recorded."
          />
        ) : null}
        {canShowSettlementRows ? (
          <div className="list-table settlement-list">
            <div className="list-head" aria-hidden="true">
              <span>Provider</span>
              <span>Settled</span>
              <span>Gross</span>
              <span>Allocated</span>
              <span>Status</span>
              <span>Action</span>
              <span />
            </div>
            <ul className="list-rows" aria-label="Provider settlement reconciliation">
              {settlements.map((row) => {
                const isPendingReason = pendingReconciliationId === row.settlementId;
                const open = expandedId === row.settlementId;
                const hasVariance = !isZeroAmount(row.varianceAmount);
                const detailsId = `settlement-details-${row.settlementId}`;
                return (
                  <li
                    key={row.settlementId}
                    className="settlement-item"
                    data-open={open || undefined}
                  >
                    <div
                      className="list-row settlement-row"
                      onClick={() => setExpandedId(open ? null : row.settlementId)}
                    >
                      <span className="list-name">
                        <span className="list-avatar" aria-hidden="true">
                          {initials(row.providerName)}
                        </span>
                        <span>
                          <strong>{row.providerName}</strong>
                          <small>{row.settlementReference}</small>
                        </span>
                      </span>
                      <span className="list-cell" data-label="Settled">
                        {row.settlementDate}
                      </span>
                      <span className="list-cell list-amount" data-label="Gross">
                        {money(row.grossAmount, row.currency)}
                      </span>
                      <span className="list-cell list-status" data-label="Allocated">
                        <span className="balance-bar" data-kind="progress" aria-hidden="true">
                          <span style={{ width: `${allocatedPercent(row)}%` }} />
                        </span>
                        <span>{money(row.unallocatedProviderAmount, row.currency)} left</span>
                      </span>
                      <span className="list-cell" data-label="Status">
                        <StatusBadge tone={settlementTone(row.state)}>
                          {settlementStateLabel(row.state)}
                        </StatusBadge>
                      </span>
                      <span className="list-cell" data-label="Action">
                        {row.state !== 'RECONCILED' ? (
                          <Button
                            variant="quiet"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void reconcile(row);
                            }}
                            disabled={working}
                          >
                            {isPendingReason ? 'Confirm reconciliation' : 'Reconcile'}
                          </Button>
                        ) : (
                          <span>Done</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="settlement-toggle"
                        aria-expanded={open}
                        aria-controls={detailsId}
                        aria-label={`${open ? 'Hide' : 'Show'} details for ${row.settlementReference}`}
                      >
                        <Icon name="chevron-down" />
                      </button>
                    </div>
                    {open ? (
                      <dl className="settlement-details" id={detailsId}>
                        <div>
                          <dt>Account</dt>
                          <dd>{row.accountReference}</dd>
                        </div>
                        <div>
                          <dt>Transaction date</dt>
                          <dd>{row.transactionDate}</dd>
                        </div>
                        <div>
                          <dt>Allocated</dt>
                          <dd>{money(row.allocatedAmount, row.currency)}</dd>
                        </div>
                        <div>
                          <dt>Provider fee</dt>
                          <dd>
                            {row.providerFeeAmount
                              ? money(row.providerFeeAmount, row.currency)
                              : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>Deduction</dt>
                          <dd>
                            {row.providerDeductionAmount
                              ? money(row.providerDeductionAmount, row.currency)
                              : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>Reported net</dt>
                          <dd>
                            {row.reportedNetAmount
                              ? money(row.reportedNetAmount, row.currency)
                              : '—'}
                          </dd>
                        </div>
                        <div data-tone={hasVariance ? 'warning' : undefined}>
                          <dt>Variance</dt>
                          <dd>{money(row.varianceAmount, row.currency)}</dd>
                        </div>
                      </dl>
                    ) : null}
                    {isPendingReason ? (
                      <div className="settlement-reason">
                        <Field
                          id={`reconcile-reason-${row.settlementId}`}
                          label="Variance reason"
                          hint="Required because allocated evidence differs from the settlement gross amount."
                          required
                        >
                          <input
                            id={`reconcile-reason-${row.settlementId}`}
                            value={reconciliationReason}
                            onChange={(event) => setReconciliationReason(event.target.value)}
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
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card as="section" className="panel content-span" aria-labelledby="matching-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Waiting for a settlement</p>
            <h2 id="matching-title">Unmatched Payments</h2>
          </div>
        </div>
        {!loading && !error && unmatched.length === 0 ? (
          <EmptyState
            title="No EcoCash or card payments waiting"
            message="Payments from approved shift reports appear here until they are matched to a settlement."
          />
        ) : null}
        {canShowUnmatchedRows ? (
          <TableScrollRegion label="Unmatched provider payment evidence">
            <table className="data-table">
              <caption className="sr-only">Unmatched provider payment evidence</caption>
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
                    <th scope="row" data-label="Method / reference">
                      <strong>{methodLabel(row.method)}</strong>
                      <br />
                      {row.reference ?? row.paymentId.slice(0, 12)}
                    </th>
                    <td data-label="Business date" className="numeric">
                      <span className="numeric">{row.businessDate}</span>
                    </td>
                    <td data-label="Reconciliation">
                      <StatusBadge tone="informational">
                        {formatStatusLabel(row.reconciliationState)}
                      </StatusBadge>
                    </td>
                    <td data-label="Evidence amount" className="numeric">
                      {money(row.amount)}
                    </td>
                    <td data-label="Remaining" className="numeric">
                      {money(row.unallocatedAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : null}
        {loading ? <LoadingState label="Loading unmatched payment evidence" /> : null}
        {error ? (
          <p className="field-hint">Matching is unavailable until the latest figures load.</p>
        ) : null}
      </Card>
    </div>
  );
}
