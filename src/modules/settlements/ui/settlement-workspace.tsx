'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMoney } from '../../../design-system/formatters';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '../../../design-system/primitives';
import type { ProviderSettlementSummaryRow, UnmatchedProviderPaymentRow } from '../contracts';

export function SettlementWorkspace({
  tenantId,
  stationId,
}: {
  tenantId: string;
  stationId: string;
}) {
  const [settlements, setSettlements] = useState<ProviderSettlementSummaryRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedProviderPaymentRow[]>([]);
  const [settlementId, setSettlementId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedSettlement = useMemo(
    () => settlements.find((row) => row.settlementId === settlementId),
    [settlements, settlementId],
  );

  const loadSettlementData = useCallback(
    async (signal?: AbortSignal) => {
      const [settlementResponse, unmatchedResponse] = await Promise.all([
        fetch(`/api/settlements/summary?tenantId=${tenantId}&stationId=${stationId}`, {
          cache: 'no-store',
          signal,
        }),
        fetch(`/api/settlements/unmatched?tenantId=${tenantId}&stationId=${stationId}`, {
          cache: 'no-store',
          signal,
        }),
      ]);
      const settlementBody = await settlementResponse.json();
      const unmatchedBody = await unmatchedResponse.json();
      if (!settlementResponse.ok)
        throw new Error(settlementBody.message ?? 'Provider settlements could not be loaded');
      if (!unmatchedResponse.ok)
        throw new Error(unmatchedBody.message ?? 'Unmatched payment evidence could not be loaded');
      return {
        settlements: settlementBody as ProviderSettlementSummaryRow[],
        unmatched: unmatchedBody as UnmatchedProviderPaymentRow[],
      };
    },
    [stationId, tenantId],
  );

  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const data = await loadSettlementData(signal);
      setSettlements(data.settlements);
      setUnmatched(data.unmatched);
      setSettlementId((current) => current || data.settlements[0]?.settlementId || '');
      setPaymentId((current) => current || data.unmatched[0]?.paymentId || '');
    } catch (cause) {
      if (!signal?.aborted)
        setError(cause instanceof Error ? cause.message : 'Settlement data could not be loaded');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await loadSettlementData(controller.signal);
        setSettlements(data.settlements);
        setUnmatched(data.unmatched);
        setSettlementId((current) => current || data.settlements[0]?.settlementId || '');
        setPaymentId((current) => current || data.unmatched[0]?.paymentId || '');
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Settlement data could not be loaded');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [loadSettlementData]);

  async function allocate() {
    if (!selectedSettlement || !paymentId || !amount.trim()) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/settlements/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          commandType: 'AllocateProviderSettlement',
          tenantId,
          stationId,
          settlementId: selectedSettlement.settlementId,
          reconciliationPaymentId: paymentId,
          amount,
          allocationKey: `ui-${crypto.randomUUID()}`,
          expectedVersion: selectedSettlement.version,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Allocation could not be saved');
      setAmount('');
      setMessage('Allocation saved and the settlement view was refreshed.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Allocation could not be saved');
    } finally {
      setWorking(false);
    }
  }

  async function reconcile(row: ProviderSettlementSummaryRow) {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/settlements/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          commandType: 'ReconcileProviderSettlement',
          tenantId,
          stationId,
          settlementId: row.settlementId,
          expectedVersion: row.version,
          reason: row.varianceAmount === '0' ? null : 'Provider variance requires finance review',
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Settlement could not be reconciled');
      setMessage('Settlement status saved and the view was refreshed.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Settlement could not be reconciled');
    } finally {
      setWorking(false);
    }
  }

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
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
        <p>
          POS and ECOCASH evidence is matched separately from cash custody and bank deposits. A
          settlement date may lag the A5 transaction date.
        </p>
        {loading ? <LoadingState label="Loading provider settlements" /> : null}
        {error ? <ErrorState message={error} /> : null}
        {message ? <p role="status">{message}</p> : null}
        {!loading && !error && settlements.length === 0 ? (
          <EmptyState
            title="No provider settlements yet"
            message="Record a provider statement or import after provider-account onboarding."
          />
        ) : null}
        {!loading && !error && settlements.length > 0 ? (
          <div className="responsive-table-wrap">
            <table className="responsive-table">
              <caption className="visually-hidden">Provider settlement reconciliation</caption>
              <thead>
                <tr>
                  <th scope="col">Provider / reference</th>
                  <th scope="col">Dates</th>
                  <th scope="col">Gross</th>
                  <th scope="col">Matched</th>
                  <th scope="col">Variance</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((row) => (
                  <tr key={row.settlementId}>
                    <td data-label="Provider / reference">
                      <strong>{row.providerName}</strong>
                      <br />
                      {row.settlementReference}
                    </td>
                    <td data-label="Dates">
                      <span className="numeric">{row.transactionDate}</span>
                      <br />
                      <small>Settled {row.settlementDate}</small>
                    </td>
                    <td data-label="Gross" className="numeric">
                      {formatMoney(row.grossAmount)}
                    </td>
                    <td data-label="Matched" className="numeric">
                      {formatMoney(row.allocatedAmount)}
                    </td>
                    <td data-label="Variance" className="numeric">
                      {formatMoney(row.varianceAmount)}
                    </td>
                    <td data-label="Status">
                      <StatusBadge tone={row.state === 'RECONCILED' ? 'positive' : 'warning'}>
                        {row.state}
                      </StatusBadge>
                    </td>
                    <td data-label="Action">
                      {row.state !== 'RECONCILED' ? (
                        <Button
                          variant="quiet"
                          type="button"
                          onClick={() => void reconcile(row)}
                          disabled={working}
                        >
                          Reconcile
                        </Button>
                      ) : (
                        <span>Finalized</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card as="section" className="panel" aria-labelledby="matching-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Named allocation</p>
            <h2 id="matching-title">Match A5 electronic evidence</h2>
          </div>
          <StatusBadge tone="informational">No automatic inference</StatusBadge>
        </div>
        {unmatched.length === 0 ? (
          <EmptyState
            title="No unmatched POS or ECOCASH evidence"
            message="Approved, posted, and locked A5 provider evidence appears here until fully allocated."
          />
        ) : (
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
                    {row.providerName} · {row.settlementReference} · {row.grossAmount}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="payment" label="A5 payment evidence" required>
              <select
                id="payment"
                value={paymentId}
                onChange={(event) => setPaymentId(event.target.value)}
              >
                <option value="">Select payment evidence</option>
                {unmatched.map((row) => (
                  <option key={row.paymentId} value={row.paymentId}>
                    {row.method} · {row.businessDate} · {row.amount} · {row.paymentId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="allocation-amount"
              label="Allocation amount"
              hint="Use an exact decimal amount."
              required
            >
              <input
                id="allocation-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.0000"
                required
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              disabled={working || !selectedSettlement || !paymentId}
            >
              Allocate evidence
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
