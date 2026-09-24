'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  NumericInput,
  StatusBadge,
  SuccessState,
} from '../../../design-system/primitives';

type CashSummary = {
  totals: {
    availableAtStation: string;
    collectedButUnbanked: string;
    pendingBankConfirmation: string;
  };
  collections: Array<{
    collectionId: string;
    collectionReference: string;
    amount: string;
    allocatedAmount: string;
    collectedButUnbanked: string;
    custodyState: string;
    currentLocationId: string;
  }>;
};

export function CashWorkspace({ tenantId, stationId }: { tenantId: string; stationId: string }) {
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/cash/summary?tenantId=${tenantId}&stationId=${stationId}`,
        {
          cache: 'no-store',
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Cash summary could not be loaded');
      setSummary(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cash summary could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/cash/summary?tenantId=${tenantId}&stationId=${stationId}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? 'Cash summary could not be loaded');
        setError(null);
        setSummary(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Cash summary could not be loaded');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [tenantId, stationId]);

  async function postCommand(event: FormEvent<HTMLFormElement>, form: HTMLFormElement) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    const data = new FormData(form);
    const commandType = String(data.get('commandType'));
    const payload: Record<string, unknown> = {
      commandType,
      tenantId,
      stationId,
    };
    for (const [key, value] of data.entries()) {
      if (key !== 'commandType' && value) payload[key] = String(value);
    }
    if (commandType === 'RecordCashCollection') {
      payload.sources = [
        {
          reconciliationId: String(data.get('reconciliationId')),
          amount: String(data.get('amount')),
        },
      ];
      delete payload.reconciliationId;
      delete payload.amount;
    }
    if (commandType === 'CreateBankDeposit') {
      const allocations = String(data.get('allocations'))
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          const [collectionId, amount] = item.split(':').map((part) => part.trim());
          return { collectionId, amount };
        });
      payload.allocations = allocations;
      delete payload.collectionIds;
    }
    if (commandType === 'ReceiveCashCollection') payload.expectedVersion = 0;
    if (commandType === 'ConfirmBankDeposit') payload.expectedVersion = 0;
    try {
      const response = await fetch('/api/cash/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Cash command failed');
      setSuccess(`${commandType} confirmed by the server.`);
      form.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cash command failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content-grid">
      <Card as="section" className="panel" aria-labelledby="cash-position-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Cash custody</p>
            <h2 id="cash-position-title">Collected is not banked</h2>
          </div>
          <StatusBadge tone="informational">Station scoped</StatusBadge>
        </div>
        {loading ? <LoadingState label="Loading cash position" /> : null}
        {error ? (
          <ErrorState
            message={error}
            action={<Button onClick={() => void refresh()}>Retry</Button>}
          />
        ) : null}
        {success ? <SuccessState message={success} /> : null}
        {summary ? (
          <>
            <dl className="operational-summary">
              <div>
                <dt>Available at station</dt>
                <dd>{summary.totals.availableAtStation} USD</dd>
              </div>
              <div>
                <dt>Collected but unbanked</dt>
                <dd>{summary.totals.collectedButUnbanked} USD</dd>
              </div>
              <div>
                <dt>Pending bank confirmation</dt>
                <dd>{summary.totals.pendingBankConfirmation} USD</dd>
              </div>
            </dl>
            {summary.collections.length === 0 ? (
              <EmptyState
                title="No collections yet"
                message="Record a collection against approved A5 reconciliation cash evidence."
              />
            ) : (
              <div className="responsive-table-wrap">
                <table className="data-table">
                  <caption className="sr-only">Station cash collections</caption>
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Amount</th>
                      <th>Unbanked</th>
                      <th>Custody</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.collections.map((collection) => (
                      <tr key={collection.collectionId}>
                        <th scope="row">{collection.collectionReference}</th>
                        <td>{collection.amount} USD</td>
                        <td>{collection.collectedButUnbanked} USD</td>
                        <td>
                          <StatusBadge
                            tone={collection.custodyState === 'BANKED' ? 'positive' : 'pending'}
                          >
                            {collection.custodyState.replaceAll('_', ' ')}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </Card>

      <Card as="section" className="panel" aria-labelledby="cash-actions-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Named commands</p>
            <h2 id="cash-actions-title">Record custody movement</h2>
          </div>
        </div>
        <form
          className="form-stack"
          onSubmit={(event) => void postCommand(event, event.currentTarget)}
        >
          <input type="hidden" name="commandType" value="RecordCashCollection" />
          <Field id="collection-reference" label="Collection reference" required>
            <input id="collection-reference" name="collectionReference" />
          </Field>
          <Field
            id="reconciliation-id"
            label="Approved A5 reconciliation ID"
            hint="Use the server identifier; browser totals are never authoritative."
            required
          >
            <input id="reconciliation-id" name="reconciliationId" />
          </Field>
          <Field id="source-location-id" label="Station cash location ID" required>
            <input id="source-location-id" name="sourceLocationId" />
          </Field>
          <NumericInput
            id="collection-amount"
            name="amount"
            label="Collected amount"
            unit="USD"
            required
          />
          <Button type="submit" loading={busy}>
            Record collection
          </Button>
        </form>
        <form
          className="form-stack"
          onSubmit={(event) => void postCommand(event, event.currentTarget)}
        >
          <input type="hidden" name="commandType" value="CreateBankDeposit" />
          <Field id="bank-account-id" label="Bank account ID" required>
            <input id="bank-account-id" name="bankAccountId" />
          </Field>
          <Field id="deposit-location-id" label="Deposit source location ID" required>
            <input id="deposit-location-id" name="sourceLocationId" />
          </Field>
          <Field id="deposit-reference" label="Deposit reference" required>
            <input id="deposit-reference" name="depositReference" />
          </Field>
          <Field
            id="deposit-allocations"
            label="Collection allocations"
            hint="Format: collection UUID:amount, collection UUID:amount"
            required
          >
            <input id="deposit-allocations" name="allocations" />
          </Field>
          <Button type="submit" variant="secondary" loading={busy}>
            Record bank deposit
          </Button>
        </form>
        <p className="field-hint">
          Deposit allocation and confirmation are available through the named cash API commands; no
          bank API is implied.
        </p>
      </Card>
    </div>
  );
}
