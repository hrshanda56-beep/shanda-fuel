'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AccessDeniedState,
  Button,
  Card,
  DialogFrame,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
  SuccessState,
} from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';

type Context = { tenantId: string; stationId: string };
type Capabilities = { request: boolean; approve: boolean; post: boolean };
type SourceMovement = {
  id: string;
  movementType: string;
  sourceType: string;
  sourceId: string;
  quantityLitres: string;
  effectiveAt: string | null;
  businessDate: string;
};
type Stream = {
  station: { id: string; code: string; name: string };
  tank: { id: string; code: string };
  product: { id: string; code: string; name: string };
  quantityLitres: string;
  valuationStatus: 'VALUED' | 'UNVALUED';
  inventoryValue: string | null;
  weightedAverageCost: string | null;
  currency: string | null;
  lastValuationOrCostEventAt: string | null;
  lastCostEventId: string | null;
  projectionVersion: number;
  blockingReason: string | null;
  sourceMovementRequiringCost: SourceMovement | null;
  activeRevaluation: { id: string; status: string; requestedAt: string | null } | null;
  hasActiveRevaluation: boolean;
};
type Revaluation = {
  id: string;
  status: string;
  reason: string;
  station: { id: string; code: string; name: string };
  tank: { id: string; code: string };
  product: { id: string; code: string; name: string };
  source: { type: string; id: string } | null;
  amount: string | null;
  currency: string | null;
  effectiveAt: string | null;
  businessDate: string;
  requestedBy: { id: string; name: string };
  requestedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  postedBy: { id: string; name: string } | null;
  postedAt: string | null;
  replayFingerprint: string | null;
  affectedSales: number;
  costAllocation: {
    lateCostAmount: string | null;
    cogsDeltaTotal: string;
    impliedEndingInventoryIncrease: string | null;
  } | null;
};

type ValuationResponse = {
  capabilities: Capabilities;
  streams: Stream[];
  revaluations: Revaluation[];
};
type RevaluationResponse = {
  capabilities: Capabilities;
  revaluation: Revaluation & {
    sourceMovement: SourceMovement | null;
    currentStreamProjection: {
      quantityLitres: string | null;
      inventoryValue: string | null;
      weightedAverageCost: string | null;
      currency: string | null;
      valuationStatus: string | null;
      projectionVersion: number;
    };
    lines: Array<{
      id: string;
      saleMovementId: string;
      saleAttributionId: string;
      meterSegmentId: string;
      saleQuantityLitres: string;
      originalPreSaleWac: string;
      recomputedPreSaleWac: string;
      originalCogs: string;
      priorRestatedCogs: string;
      recomputedCogs: string;
      cogsDelta: string;
      currency: string;
      saleEffectiveAt: string | null;
      cogsRevaluationEventId: string;
      replayFingerprint: string;
    }>;
    timeline: Array<{
      label: string;
      at: string | null;
      actor: { id: string; name: string } | null;
      detail: string;
    }>;
  };
};

function date(value: string | null) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-ZW', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function tone(status: string): 'positive' | 'warning' | 'pending' | 'neutral' | 'critical' {
  if (status === 'VALUED' || status === 'POSTED') return 'positive';
  if (status === 'UNVALUED') return 'critical';
  if (status === 'REQUESTED' || status === 'APPROVED') return 'pending';
  return 'neutral';
}

function knownError(error: string, message: string) {
  if (message.includes('UNVALUED')) {
    return {
      title: 'Valuation is blocking this operation',
      message:
        'The stream has no usable authoritative cost. Open the affected valuation stream, resolve its source movement, then retry.',
    };
  }
  if (message.includes('already has a revaluation workflow')) {
    return {
      title: 'A revaluation already exists',
      message:
        'This source movement is already covered by a revaluation workflow. Refresh the stream before trying again.',
    };
  }
  if (message.includes('Only a requested')) {
    return {
      title: 'The request is no longer awaiting approval',
      message: 'Another operator changed this workflow. Refresh to review the current state.',
    };
  }
  if (message.includes('Only an approved')) {
    return {
      title: 'The revaluation is not ready to post',
      message: 'Approval is required before posting. Refresh to review the current workflow state.',
    };
  }
  if (error === 'IDEMPOTENCY_CONFLICT' || error === 'CONFLICT') {
    return {
      title: 'The record changed elsewhere',
      message: message || 'Refresh before trying this action again.',
    };
  }
  if (error === 'FORBIDDEN')
    return {
      title: 'Action not permitted',
      message: message || 'Your permission or authentication level does not allow this action.',
    };
  if (error === 'VALIDATION_FAILED')
    return {
      title: 'Check the revaluation details',
      message: message || 'Review the amount, currency, and reason before retrying.',
    };
  if (message.includes('BETTER_AUTH_SECRET'))
    return {
      title: 'Authentication is unavailable',
      message:
        'The station session could not be verified in this environment. Retry after authentication configuration is available.',
    };
  return {
    title: 'Action failed',
    message: message || 'The action could not be completed. Retry after checking the latest state.',
  };
}

function apiUrl(path: string, context: Context) {
  const params = new URLSearchParams(context);
  return `${path}?${params.toString()}`;
}

function Status({ status }: { status: string }) {
  return <StatusBadge tone={tone(status)}>{status}</StatusBadge>;
}

export function ValuationOverview({ context }: { context: Context }) {
  const [data, setData] = useState<ValuationResponse | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(apiUrl('/api/inventory/valuation', context), {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw { code: body.error ?? 'INTERNAL_ERROR', message: body.message ?? '' };
      setData(body);
      setError(null);
    } catch (caught) {
      const failure = caught as { code?: string; message?: string };
      setError({ code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? '' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [context]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  if (loading) return <LoadingState label="Loading valuation streams" />;
  if (error?.code === 'FORBIDDEN')
    return (
      <AccessDeniedState message="Inventory valuation is restricted to authorised station users." />
    );
  if (error) {
    const mapped = knownError(error.code, error.message);
    return (
      <ErrorState
        title={mapped.title}
        message={mapped.message}
        action={
          <Button variant="secondary" onClick={load}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!data) return null;

  const unvalued = data.streams.filter((stream) => stream.valuationStatus === 'UNVALUED');
  return (
    <div className="valuation-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Inventory control · A12</span>
          <h1>Inventory valuation</h1>
          <p>
            See which cost streams are valued, what is blocking an unvalued stream, and how
            revaluation evidence changes historical COGS.
          </p>
        </div>
        <Button variant="secondary" loading={refreshing} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {success ? <SuccessState title="Workflow updated" message={success} /> : null}
      <div className="valuation-summary-grid" aria-label="Valuation summary">
        <Card>
          <span className="metric-label">Streams</span>
          <strong className="metric-value">{data.streams.length}</strong>
          <p>Persisted A12 projections</p>
        </Card>
        <Card>
          <span className="metric-label">Unvalued</span>
          <strong className="metric-value metric-critical">{unvalued.length}</strong>
          <p>May block sale-cost posting</p>
        </Card>
        <Card>
          <span className="metric-label">Active revaluations</span>
          <strong className="metric-value">
            {
              data.revaluations.filter(
                (item) => item.status === 'REQUESTED' || item.status === 'APPROVED',
              ).length
            }
          </strong>
          <p>Requested or approved</p>
        </Card>
      </div>
      {data.streams.length === 0 ? (
        <EmptyState
          title="No valuation streams yet"
          message="This station has no persisted A12 cost stream projection. Create or import inventory movements before reviewing valuation."
        />
      ) : (
        <Card className="table-card">
          <div className="section-heading">
            <div>
              <h2>Cost streams</h2>
              <p>Value and WAC are read from the persisted projection.</p>
            </div>
          </div>
          <TableScrollRegion label="Inventory valuation streams">
            <table className="data-table">
              <caption className="visually-hidden">Inventory valuation streams</caption>
              <thead>
                <tr>
                  <th scope="col">Tank / product</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Inventory value</th>
                  <th scope="col">WAC</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.streams.map((stream) => (
                  <tr key={`${stream.tank.id}-${stream.product.id}`}>
                    <th scope="row">
                      <Link
                        href={`/inventory/valuation/streams/${stream.tank.id}/${stream.product.id}?${new URLSearchParams(context)}`}
                      >
                        {stream.tank.code} · {stream.product.name}
                      </Link>
                      <span className="table-secondary">{stream.product.code}</span>
                    </th>
                    <td>{stream.quantityLitres} L</td>
                    <td>
                      <Status status={stream.valuationStatus} />
                      {stream.hasActiveRevaluation ? (
                        <span className="table-secondary">
                          Revaluation {stream.activeRevaluation?.status}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {stream.inventoryValue === null
                        ? '—'
                        : `${stream.currency} ${stream.inventoryValue}`}
                    </td>
                    <td>
                      {stream.weightedAverageCost === null
                        ? '—'
                        : `${stream.currency} ${stream.weightedAverageCost}/L`}
                    </td>
                    <td>
                      <Link
                        className="button button-secondary button-small"
                        href={`/inventory/valuation/streams/${stream.tank.id}/${stream.product.id}?${new URLSearchParams(context)}`}
                      >
                        Review stream
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        </Card>
      )}
      <Card className="table-card">
        <div className="section-heading">
          <div>
            <h2>Revaluation history</h2>
            <p>Every transition retains its actor, timestamp, and persisted evidence.</p>
          </div>
        </div>
        {data.revaluations.length === 0 ? (
          <EmptyState
            title="No revaluation workflows"
            message="A request appears here when a source movement needs late authoritative cost."
          />
        ) : (
          <TableScrollRegion label="Revaluation workflow history">
            <table className="data-table">
              <caption className="visually-hidden">Revaluation workflow history</caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Status</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Affected sales</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.revaluations.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      {item.tank.code} · {item.product.name}
                      <span className="table-secondary">
                        {item.source?.type ?? 'Source unavailable'}
                      </span>
                    </th>
                    <td>
                      <Status status={item.status} />
                    </td>
                    <td>{item.amount === null ? '—' : `${item.currency} ${item.amount}`}</td>
                    <td>
                      {date(item.requestedAt)}
                      <span className="table-secondary">{item.requestedBy.name}</span>
                    </td>
                    <td>{item.affectedSales}</td>
                    <td>
                      <Link
                        className="button button-secondary button-small"
                        href={`/inventory/valuation/revaluations/${item.id}?${new URLSearchParams(context)}`}
                      >
                        Open history
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        )}
      </Card>
    </div>
  );
}

function RequestRevaluationDialog({
  context,
  stream,
  capability,
  onSuccess,
}: {
  context: Context;
  stream: Stream;
  capability: boolean;
  onSuccess: () => void;
}) {
  const source = stream.sourceMovementRequiringCost;
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [reason, setReason] = useState('Late authoritative source cost');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [openSuccess, setOpenSuccess] = useState(false);
  if (!source) return null;
  const mapped = error ? knownError(error.code, error.message) : null;
  return (
    <DialogFrame
      trigger={<Button disabled={!capability}>Request revaluation</Button>}
      title="Request late-cost revaluation"
      description="This creates a REQUESTED workflow. It does not post cost or change the projection until approved and posted."
    >
      <form
        className="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError(null);
          try {
            const response = await fetch('/api/inventory/commands', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': crypto.randomUUID(),
              },
              body: JSON.stringify({
                commandType: 'RequestInventoryCostRevaluation',
                tenantId: context.tenantId,
                stationId: context.stationId,
                tankId: stream.tank.id,
                productId: stream.product.id,
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                amount,
                currency,
                reason,
              }),
            });
            const body = await response.json();
            if (!response.ok)
              throw { code: body.error ?? 'INTERNAL_ERROR', message: body.message ?? '' };
            setOpenSuccess(true);
            onSuccess();
          } catch (caught) {
            const failure = caught as { code?: string; message?: string };
            setError({ code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? '' });
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="callout callout-warning">
          <strong>Source requiring cost</strong>
          <p>
            {source.movementType} · {source.quantityLitres} L · {date(source.effectiveAt)}
            <br />
            Source ID <code>{source.sourceId}</code>
          </p>
        </div>
        <p className="muted-small">
          A12.5 is whole-history only. This request has no editable restatement bounds and reporting
          filters do not change its revaluation scope.
        </p>
        <Field
          id="revaluation-amount"
          label="Authoritative cost"
          hint="Missing cost must never be entered as zero."
          required
        >
          <input
            id="revaluation-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>
        <Field id="revaluation-currency" label="Currency" required>
          <input
            id="revaluation-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            maxLength={3}
          />
        </Field>
        <Field id="revaluation-reason" label="Reason" required>
          <textarea
            id="revaluation-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
          />
        </Field>
        {mapped ? <ErrorState title={mapped.title} message={mapped.message} /> : null}
        {openSuccess ? (
          <SuccessState
            title="Request recorded"
            message="The revaluation is now awaiting approval."
          />
        ) : null}
        <div className="dialog-actions">
          <Button
            type="submit"
            loading={saving}
            disabled={openSuccess || !amount || !reason.trim()}
          >
            Create request
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function ValuationStreamDetail({
  context,
  tankId,
  productId,
}: {
  context: Context;
  tankId: string;
  productId: string;
}) {
  const [data, setData] = useState<ValuationResponse | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = apiUrl('/api/inventory/valuation', { ...context });
      const response = await fetch(`${url}&tankId=${tankId}&productId=${productId}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw { code: body.error ?? 'INTERNAL_ERROR', message: body.message ?? '' };
      setData(body);
      setError(null);
    } catch (caught) {
      const failure = caught as { code?: string; message?: string };
      setError({ code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? '' });
    } finally {
      setLoading(false);
    }
  }, [context, productId, tankId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  if (loading) return <LoadingState label="Loading valuation stream" />;
  if (error?.code === 'FORBIDDEN') return <AccessDeniedState />;
  if (error) {
    const mapped = knownError(error.code, error.message);
    return (
      <ErrorState
        title={mapped.title}
        message={mapped.message}
        action={
          <Button variant="secondary" onClick={load}>
            Retry
          </Button>
        }
      />
    );
  }
  const stream = data?.streams[0];
  if (!data || !stream)
    return (
      <EmptyState
        title="Stream not found"
        message="This stream may not belong to the selected station or may not have a persisted projection."
      />
    );
  return (
    <div className="valuation-workspace">
      <div className="page-heading">
        <div>
          <Link className="back-link" href={`/inventory/valuation?${new URLSearchParams(context)}`}>
            ← Inventory valuation
          </Link>
          <span className="eyebrow">Cost stream explanation</span>
          <h1>
            {stream.tank.code} · {stream.product.name}
          </h1>
          <p>
            {stream.product.code} · projection version {stream.projectionVersion}
          </p>
        </div>
        <RequestRevaluationDialog
          context={context}
          stream={stream}
          capability={data.capabilities.request}
          onSuccess={load}
        />
      </div>
      <Card
        className={`valuation-status-card ${stream.valuationStatus === 'UNVALUED' ? 'valuation-status-card-critical' : ''}`}
      >
        <div>
          <span className="eyebrow">Current valuation status</span>
          <div className="status-line">
            <Status status={stream.valuationStatus} />
            {stream.valuationStatus === 'UNVALUED' ? (
              <strong>Operator action required</strong>
            ) : (
              <strong>Cost projection is available</strong>
            )}
          </div>
          <p>
            {stream.blockingReason ??
              'The persisted A12 projection has an authoritative cost basis for this stream.'}
          </p>
        </div>
        {stream.valuationStatus === 'UNVALUED' && stream.sourceMovementRequiringCost ? (
          <div className="source-card">
            <span className="eyebrow">Source requiring cost</span>
            <strong>
              {stream.sourceMovementRequiringCost.movementType} ·{' '}
              {stream.sourceMovementRequiringCost.quantityLitres} L
            </strong>
            <p>
              {date(stream.sourceMovementRequiringCost.effectiveAt)} ·{' '}
              {stream.sourceMovementRequiringCost.businessDate}
            </p>
            <code>
              {stream.sourceMovementRequiringCost.sourceType} /{' '}
              {stream.sourceMovementRequiringCost.sourceId}
            </code>
          </div>
        ) : null}
      </Card>
      <div className="valuation-detail-grid">
        <Card>
          <h2>Projection</h2>
          <dl className="detail-list">
            <dt>Quantity</dt>
            <dd>{stream.quantityLitres} L</dd>
            <dt>Inventory value</dt>
            <dd>
              {stream.inventoryValue === null
                ? 'Not available while UNVALUED'
                : `${stream.currency} ${stream.inventoryValue}`}
            </dd>
            <dt>WAC</dt>
            <dd>
              {stream.weightedAverageCost === null
                ? 'Not available while UNVALUED'
                : `${stream.currency} ${stream.weightedAverageCost}/L`}
            </dd>
            <dt>Last cost event</dt>
            <dd>{date(stream.lastValuationOrCostEventAt)}</dd>
            <dt>Currency</dt>
            <dd>{stream.currency ?? 'Not available while UNVALUED'}</dd>
          </dl>
        </Card>
        <Card>
          <h2>Workflow visibility</h2>
          {stream.activeRevaluation ? (
            <p>
              <Status status={stream.activeRevaluation.status} />{' '}
              <Link
                href={`/inventory/valuation/revaluations/${stream.activeRevaluation.id}?${new URLSearchParams(context)}`}
              >
                Open active revaluation
              </Link>
            </p>
          ) : (
            <p>No active revaluation workflow for this stream.</p>
          )}
          <p className="muted-small">
            A5 reconciliation approval can remain blocked while this stream is UNVALUED. Resolve the
            source cost, then retry the blocked operation.
          </p>
        </Card>
      </div>
      <Card className="table-card">
        <h2>Revaluation history for this stream</h2>
        {data.revaluations.length === 0 ? (
          <EmptyState
            title="No revaluation history"
            message="No request, approval, or posting evidence exists for this stream."
          />
        ) : (
          <TableScrollRegion label="Revaluation history for this stream">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Source</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Affected sales</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.revaluations.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Status status={item.status} />
                    </td>
                    <td>{item.source?.type ?? '—'}</td>
                    <td>{item.amount === null ? '—' : `${item.currency} ${item.amount}`}</td>
                    <td>{item.affectedSales}</td>
                    <td>
                      <Link
                        className="button button-secondary button-small"
                        href={`/inventory/valuation/revaluations/${item.id}?${new URLSearchParams(context)}`}
                      >
                        Open detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        )}
      </Card>
    </div>
  );
}

export function RevaluationDetail({
  context,
  revaluationId,
}: {
  context: Context;
  revaluationId: string;
}) {
  const [data, setData] = useState<RevaluationResponse | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'approve' | 'post' | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        apiUrl(`/api/inventory/valuation/revaluations/${revaluationId}`, context),
        { cache: 'no-store' },
      );
      const body = await response.json();
      if (!response.ok) throw { code: body.error ?? 'INTERNAL_ERROR', message: body.message ?? '' };
      setData(body);
      setError(null);
    } catch (caught) {
      const failure = caught as { code?: string; message?: string };
      setError({ code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? '' });
    } finally {
      setLoading(false);
    }
  }, [context, revaluationId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const execute = async (
    commandType: 'ApproveInventoryCostRevaluation' | 'PostInventoryCostRevaluation',
  ) => {
    setAction(commandType.startsWith('Approve') ? 'approve' : 'post');
    setActionError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/inventory/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          commandType,
          tenantId: context.tenantId,
          stationId: context.stationId,
          revaluationId,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw { code: body.error ?? 'INTERNAL_ERROR', message: body.message ?? '' };
      setSuccess(
        commandType.startsWith('Approve')
          ? 'Revaluation approved. It is ready for posting.'
          : 'Revaluation posted. Refreshing the persisted valuation and historical COGS evidence.',
      );
      setConfirmPost(false);
      await load();
    } catch (caught) {
      const failure = caught as { code?: string; message?: string };
      setActionError({ code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? '' });
    } finally {
      setAction(null);
    }
  };
  if (loading) return <LoadingState label="Loading revaluation history" />;
  if (error?.code === 'FORBIDDEN') return <AccessDeniedState />;
  if (error) {
    const mapped = knownError(error.code, error.message);
    return (
      <ErrorState
        title={mapped.title}
        message={mapped.message}
        action={
          <Button variant="secondary" onClick={load}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!data) return null;
  const item = data.revaluation;
  const mapped = actionError ? knownError(actionError.code, actionError.message) : null;
  return (
    <div className="valuation-workspace">
      <div className="page-heading">
        <div>
          <Link className="back-link" href={`/inventory/valuation?${new URLSearchParams(context)}`}>
            ← Inventory valuation
          </Link>
          <span className="eyebrow">Revaluation evidence</span>
          <h1>
            {item.tank.code} · {item.product.name}
          </h1>
          <p>
            Envelope <code>{item.id}</code>
          </p>
        </div>
        <div className="action-row">
          {item.status === 'REQUESTED' && data.capabilities.approve ? (
            <Button
              onClick={() => void execute('ApproveInventoryCostRevaluation')}
              loading={action === 'approve'}
            >
              Approve revaluation
            </Button>
          ) : null}
          {item.status === 'APPROVED' && data.capabilities.post ? (
            <Button
              variant="danger"
              onClick={() => setConfirmPost(true)}
              disabled={Boolean(action)}
            >
              Post revaluation
            </Button>
          ) : null}
        </div>
      </div>
      {success ? <SuccessState title="Workflow updated" message={success} /> : null}
      {mapped ? (
        <ErrorState
          title={mapped.title}
          message={mapped.message}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
          }
        />
      ) : null}
      {confirmPost ? (
        <Card className="confirmation-card">
          <StatusBadge tone="warning">Irreversible accounting action</StatusBadge>
          <h2>Post this revaluation?</h2>
          <p>
            Posting records the ordinary source cost and persisted COGS_REVALUATION evidence for{' '}
            {item.affectedSales} affected historical sale{item.affectedSales === 1 ? '' : 's'}.
            Review the source, amount, and actor history before continuing.
          </p>
          <div className="action-row">
            <Button variant="secondary" onClick={() => setConfirmPost(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={action === 'post'}
              onClick={() => void execute('PostInventoryCostRevaluation')}
            >
              Confirm post
            </Button>
          </div>
        </Card>
      ) : null}
      <Card className="revaluation-header-card">
        <div>
          <Status status={item.status} />
          <h2>{item.reason}</h2>
          <p>
            {item.source?.type ?? 'Source unavailable'} · {item.source?.id ?? '—'} ·{' '}
            {item.currency ?? 'Currency pending'} {item.amount ?? 'amount pending'}
          </p>
        </div>
        <dl className="detail-list">
          <dt>Effective date</dt>
          <dd>{date(item.effectiveAt)}</dd>
          <dt>Business date</dt>
          <dd>{item.businessDate}</dd>
          <dt>Affected sales</dt>
          <dd>{item.affectedSales}</dd>
        </dl>
      </Card>
      <div className="valuation-detail-grid">
        <Card>
          <h2>Current stream projection</h2>
          <p className="muted-small">
            Read from the current persisted stream state. Later movements or revaluations may have
            changed it; A12 does not persist a historical post-revaluation snapshot.
          </p>
          <dl className="detail-list">
            <dt>Status</dt>
            <dd>
              {data.revaluation.currentStreamProjection.valuationStatus ? (
                <Status status={data.revaluation.currentStreamProjection.valuationStatus} />
              ) : (
                'Not available'
              )}
            </dd>
            <dt>Quantity</dt>
            <dd>{data.revaluation.currentStreamProjection.quantityLitres ?? 'Not available'} L</dd>
            <dt>Inventory value</dt>
            <dd>
              {data.revaluation.currentStreamProjection.inventoryValue === null
                ? 'Not available'
                : `${data.revaluation.currentStreamProjection.currency} ${data.revaluation.currentStreamProjection.inventoryValue}`}
            </dd>
            <dt>WAC</dt>
            <dd>
              {data.revaluation.currentStreamProjection.weightedAverageCost === null
                ? 'Not available'
                : `${data.revaluation.currentStreamProjection.currency} ${data.revaluation.currentStreamProjection.weightedAverageCost}/L`}
            </dd>
          </dl>
        </Card>
        <Card>
          <h2>Cost allocation summary</h2>
          <p className="muted-small">
            Derived from the persisted envelope amount and posted COGS revaluation lines. The
            ending-inventory figure is implied; A12 does not store independent pre/post evidence to
            verify conservation here.
          </p>
          {item.costAllocation ? (
            <dl className="detail-list">
              <dt>Late source cost</dt>
              <dd>
                {item.currency} {item.costAllocation.lateCostAmount}
              </dd>
              <dt>Historical COGS delta</dt>
              <dd>
                {item.currency} {item.costAllocation.cogsDeltaTotal}
              </dd>
              <dt>Implied residual retained in ending inventory</dt>
              <dd>
                {item.currency} {item.costAllocation.impliedEndingInventoryIncrease}
              </dd>
            </dl>
          ) : (
            <p>Available after posting the revaluation evidence.</p>
          )}
        </Card>
      </div>
      <Card>
        <h2>Operator timeline</h2>
        <ol className="timeline">
          {item.timeline.map((event, index) => (
            <li key={`${event.label}-${index}`}>
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <strong>{event.label}</strong>
                <span>
                  {date(event.at)}
                  {event.actor ? ` · ${event.actor.name}` : ''}
                </span>
                <p>{event.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <Card className="table-card">
        <h2>Affected historical sales and COGS</h2>
        {item.lines.length === 0 ? (
          <EmptyState
            title="No sale adjustments persisted yet"
            message="Pending workflows have no posted COGS_REVALUATION lines."
          />
        ) : (
          <TableScrollRegion label="Affected historical sales">
            <table className="data-table">
              <caption className="visually-hidden">Affected historical sales</caption>
              <thead>
                <tr>
                  <th scope="col">Sale</th>
                  <th scope="col">Original COGS</th>
                  <th scope="col">Prior restated COGS</th>
                  <th scope="col">Recomputed COGS</th>
                  <th scope="col">Signed delta</th>
                  <th scope="col">Event</th>
                </tr>
              </thead>
              <tbody>
                {item.lines.map((line) => (
                  <tr key={line.id}>
                    <th scope="row">
                      {date(line.saleEffectiveAt)}
                      <span className="table-secondary">
                        {line.saleQuantityLitres} L · meter {line.meterSegmentId.slice(0, 8)}…
                      </span>
                    </th>
                    <td>
                      {line.currency} {line.originalCogs}
                    </td>
                    <td>
                      {line.currency} {line.priorRestatedCogs}
                    </td>
                    <td>
                      {line.currency} {line.recomputedCogs}
                    </td>
                    <td>
                      {line.currency} {line.cogsDelta}
                    </td>
                    <td>
                      <span className="table-secondary">COGS_REVALUATION</span>
                      <code>{line.cogsRevaluationEventId}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        )}
      </Card>
      <Card>
        <h2>Audit identity</h2>
        <dl className="detail-list">
          <dt>Requested by</dt>
          <dd>
            {item.requestedBy.name} · {date(item.requestedAt)}
          </dd>
          <dt>Approved by</dt>
          <dd>
            {item.approvedBy
              ? `${item.approvedBy.name} · ${date(item.approvedAt)}`
              : 'Not approved'}
          </dd>
          <dt>Posted by</dt>
          <dd>{item.postedBy ? `${item.postedBy.name} · ${date(item.postedAt)}` : 'Not posted'}</dd>
          <dt>Replay fingerprint</dt>
          <dd>
            <code>{item.replayFingerprint ?? 'Not assigned until posting'}</code>
          </dd>
        </dl>
      </Card>
    </div>
  );
}
