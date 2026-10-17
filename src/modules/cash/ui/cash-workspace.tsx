'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatMoney, formatStatusLabel } from '../../../design-system/formatters';
import { Select } from '../../../design-system/forms';
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
import { TableScrollRegion } from '../../../design-system/table';

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
  locations?: Array<{
    locationId: string;
    code: string;
    name: string;
    locationType: string;
  }>;
  handovers?: CashHandover[];
  handoverCapabilities?: {
    prepareHandover: boolean;
    acceptHandover: boolean;
    resolveHandover: boolean;
  };
};

type CashHandover = {
  handoverId: string;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  expectedAmount: string;
  countedAmount: string | null;
  variance: string | null;
  state: string;
  deliveredBy: string;
  receivedBy: string | null;
  disputeReason: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  version: number;
};

const emptyHandoverCapabilities = {
  prepareHandover: false,
  acceptHandover: false,
  resolveHandover: false,
};

function handoverTone(state: string): 'positive' | 'pending' | 'warning' | 'critical' | 'locked' {
  if (state === 'ACCEPTED' || state === 'RESOLVED') return 'positive';
  if (state === 'DISPUTED') return 'critical';
  if (state === 'CANCELLED') return 'locked';
  if (state === 'SUBMITTED') return 'pending';
  return 'warning';
}

export function CashWorkspace({ tenantId, stationId }: { tenantId: string; stationId: string }) {
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const handoverIntentKeys = useRef(new Map<string, string>());

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

  async function postHandoverCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const commandType = String(data.get('commandType'));
    const payload: Record<string, unknown> = { commandType, tenantId, stationId };
    for (const [key, value] of data.entries()) {
      if (key !== 'commandType' && value !== '') payload[key] = String(value);
    }
    if ('expectedVersion' in payload) payload.expectedVersion = Number(payload.expectedVersion);
    const signature = JSON.stringify(payload);
    const idempotencyKey = handoverIntentKeys.current.get(signature) ?? crypto.randomUUID();
    handoverIntentKeys.current.set(signature, idempotencyKey);
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/cash/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Cash handover command failed');
      handoverIntentKeys.current.delete(signature);
      setSuccess(`${formatStatusLabel(commandType)} recorded. The station status was refreshed.`);
      form.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cash handover command failed');
    } finally {
      setBusy(false);
    }
  }

  const handovers = summary?.handovers ?? [];
  const locations = summary?.locations ?? [];
  const handoverCapabilities = summary?.handoverCapabilities ?? emptyHandoverCapabilities;

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
              <TableScrollRegion label="Station cash collections">
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
              </TableScrollRegion>
            )}
          </>
        ) : null}
      </Card>

      <Card as="section" className="panel" aria-labelledby="cash-actions-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Named commands</p>
            <h2 id="cash-actions-title">Record cash control</h2>
          </div>
        </div>
        <form
          className="form-stack"
          onSubmit={(event) => void postCommand(event, event.currentTarget)}
        >
          <input type="hidden" name="commandType" value="CountCash" />
          <Field id="count-location-id" label="Cash location ID" required>
            <input id="count-location-id" name="locationId" />
          </Field>
          <Field id="count-business-date" label="Business date" required>
            <input id="count-business-date" name="businessDate" type="date" />
          </Field>
          <NumericInput
            id="counted-cash-amount"
            name="countedAmount"
            label="Physical cash counted"
            unit="USD"
            required
          />
          <Field
            id="cash-count-explanation"
            label="Variance explanation"
            hint="Required when the physical count differs from the server-derived expected balance."
          >
            <textarea id="cash-count-explanation" name="explanation" rows={3} />
          </Field>
          <Button type="submit" loading={busy}>
            Record cash count
          </Button>
        </form>
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

      <Card as="section" className="panel" aria-labelledby="cash-handovers-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Cash custody handover</p>
            <h2 id="cash-handovers-title">Prepare, confirm, and resolve custody</h2>
          </div>
          <StatusBadge tone="informational">Tenant and station scoped</StatusBadge>
        </div>
        <p>
          The sender confirms the physical count. A variance must be explained and is routed for
          receiver dispute and owner resolution.
        </p>

        {summary && handovers.length === 0 ? (
          <EmptyState
            title="No cash handovers yet"
            message="Prepare a handover when cash is ready to move between two active station locations."
          />
        ) : null}
        {summary && handovers.length > 0 ? (
          <TableScrollRegion label="Cash handover status">
            <table className="data-table">
              <caption className="sr-only">Cash handover status</caption>
              <thead>
                <tr>
                  <th scope="col">Handover</th>
                  <th scope="col">Route</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Counted</th>
                  <th scope="col">Variance</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {handovers.map((handover) => (
                  <tr key={handover.handoverId}>
                    <th scope="row">
                      <span title={handover.handoverId}>{handover.handoverId.slice(0, 8)}</span>
                      <br />
                      <small>Version {handover.version}</small>
                    </th>
                    <td>
                      {handover.fromLocationName}
                      <br />
                      <small>to {handover.toLocationName}</small>
                    </td>
                    <td className="numeric">{formatMoney(handover.expectedAmount)}</td>
                    <td className="numeric">
                      {handover.countedAmount ? formatMoney(handover.countedAmount) : '—'}
                    </td>
                    <td className="numeric">
                      {handover.variance ? formatMoney(handover.variance) : '—'}
                    </td>
                    <td>
                      <StatusBadge tone={handoverTone(handover.state)}>
                        {formatStatusLabel(handover.state)}
                      </StatusBadge>
                      {handover.disputeReason ? (
                        <p className="field-hint">{handover.disputeReason}</p>
                      ) : null}
                    </td>
                    <td>
                      {handover.state === 'DRAFT' && handoverCapabilities.prepareHandover ? (
                        <form
                          className="form-stack"
                          onSubmit={(event) => void postHandoverCommand(event)}
                        >
                          <input type="hidden" name="commandType" value="SenderConfirmHandover" />
                          <input type="hidden" name="handoverId" value={handover.handoverId} />
                          <input type="hidden" name="expectedVersion" value={handover.version} />
                          <NumericInput
                            id={`handover-count-${handover.handoverId}`}
                            name="countedAmount"
                            label="Sender counted amount"
                            hint="A mismatch opens a dispute."
                            unit="USD"
                            required
                          />
                          <Field
                            id={`handover-variance-${handover.handoverId}`}
                            label="Variance explanation"
                            optional
                          >
                            <textarea
                              id={`handover-variance-${handover.handoverId}`}
                              name="varianceExplanation"
                              rows={2}
                            />
                          </Field>
                          <Button type="submit" loading={busy}>
                            Sender confirm
                          </Button>
                        </form>
                      ) : null}
                      {handover.state === 'SUBMITTED' && handoverCapabilities.acceptHandover ? (
                        <div className="form-stack">
                          <form onSubmit={(event) => void postHandoverCommand(event)}>
                            <input
                              type="hidden"
                              name="commandType"
                              value="ReceiverConfirmHandover"
                            />
                            <input type="hidden" name="handoverId" value={handover.handoverId} />
                            <input type="hidden" name="expectedVersion" value={handover.version} />
                            <Button type="submit" loading={busy}>
                              Receiver accept
                            </Button>
                          </form>
                          <form onSubmit={(event) => void postHandoverCommand(event)}>
                            <input type="hidden" name="commandType" value="DisputeHandover" />
                            <input type="hidden" name="handoverId" value={handover.handoverId} />
                            <input type="hidden" name="expectedVersion" value={handover.version} />
                            <Field
                              id={`handover-dispute-${handover.handoverId}`}
                              label="Dispute reason"
                              required
                            >
                              <textarea
                                id={`handover-dispute-${handover.handoverId}`}
                                name="reason"
                                rows={2}
                              />
                            </Field>
                            <Button type="submit" variant="secondary" loading={busy}>
                              Dispute handover
                            </Button>
                          </form>
                        </div>
                      ) : null}
                      {handover.state === 'DISPUTED' && handoverCapabilities.resolveHandover ? (
                        <form
                          className="form-stack"
                          onSubmit={(event) => void postHandoverCommand(event)}
                        >
                          <input type="hidden" name="commandType" value="ResolveHandoverDispute" />
                          <input type="hidden" name="handoverId" value={handover.handoverId} />
                          <input type="hidden" name="expectedVersion" value={handover.version} />
                          <Field
                            id={`handover-resolution-${handover.handoverId}`}
                            label="Resolution reason"
                            required
                          >
                            <textarea
                              id={`handover-resolution-${handover.handoverId}`}
                              name="reason"
                              rows={2}
                            />
                          </Field>
                          <Button type="submit" loading={busy}>
                            Resolve dispute
                          </Button>
                        </form>
                      ) : null}
                      {(handover.state === 'DRAFT' ||
                        handover.state === 'SUBMITTED' ||
                        handover.state === 'DISPUTED') &&
                      handoverCapabilities.prepareHandover ? (
                        <form onSubmit={(event) => void postHandoverCommand(event)}>
                          <input type="hidden" name="commandType" value="CancelHandover" />
                          <input type="hidden" name="handoverId" value={handover.handoverId} />
                          <input type="hidden" name="expectedVersion" value={handover.version} />
                          <Field
                            id={`handover-cancel-${handover.handoverId}`}
                            label="Cancellation reason"
                            required
                          >
                            <input id={`handover-cancel-${handover.handoverId}`} name="reason" />
                          </Field>
                          <Button type="submit" variant="danger" loading={busy}>
                            Cancel handover
                          </Button>
                        </form>
                      ) : null}
                      {handover.state === 'ACCEPTED' ||
                      handover.state === 'RESOLVED' ||
                      handover.state === 'CANCELLED' ? (
                        <span>Finalized</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : null}

        {handoverCapabilities.prepareHandover && locations.length === 0 ? (
          <EmptyState
            title="Active cash locations are required"
            message="Configure active cash locations for this station before preparing a handover."
          />
        ) : null}
        {handoverCapabilities.prepareHandover && locations.length > 0 ? (
          <form className="form-stack" onSubmit={(event) => void postHandoverCommand(event)}>
            <h3>Prepare a handover</h3>
            <input type="hidden" name="commandType" value="PrepareHandover" />
            <Field id="handover-from-location" label="From cash location" required>
              <Select
                id="handover-from-location"
                name="fromLocationId"
                options={locations
                  .filter((location) => location.locationType !== 'TRANSIT')
                  .map((location) => ({
                    value: location.locationId,
                    label: `${location.name} (${location.code})`,
                  }))}
                placeholder="Choose the source location"
                required
              />
            </Field>
            <Field id="handover-to-location" label="To cash location" required>
              <Select
                id="handover-to-location"
                name="toLocationId"
                options={locations
                  .filter((location) => location.locationType !== 'TRANSIT')
                  .map((location) => ({
                    value: location.locationId,
                    label: `${location.name} (${location.code})`,
                  }))}
                placeholder="Choose the receiving location"
                required
              />
            </Field>
            <Field id="handover-transit-location" label="Transit location" required>
              <Select
                id="handover-transit-location"
                name="transitLocationId"
                options={locations
                  .filter((location) => location.locationType === 'TRANSIT')
                  .map((location) => ({
                    value: location.locationId,
                    label: `${location.name} (${location.code})`,
                  }))}
                placeholder="Choose the transit location"
                required
              />
            </Field>
            <Field id="handover-business-date" label="Business date" required>
              <input id="handover-business-date" name="businessDate" type="date" required />
            </Field>
            <NumericInput
              id="handover-expected-amount"
              name="expectedAmount"
              label="Expected amount"
              hint="The server checks available cash before creating the custody record."
              unit="USD"
              required
            />
            <Button type="submit" loading={busy}>
              Prepare handover
            </Button>
          </form>
        ) : null}
      </Card>
    </div>
  );
}
