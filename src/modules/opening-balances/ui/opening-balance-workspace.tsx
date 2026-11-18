'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Card, EmptyState, StatusBadge } from '@/design-system/primitives';
import { useContextFetch } from '@/modules/context/client-context';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import type { OpeningBalanceState } from '../domain';

type Batch = Readonly<{
  batchId: string;
  asOfDate: string;
  sourceFilename: string | null;
  state: OpeningBalanceState;
  lineCount: number;
  version: number;
  createdAt: string;
  approvedAt: string | null;
  lockedAt: string | null;
}>;

type Preview = Readonly<{
  valid: boolean;
  sourceHash: string;
  rowCount: number;
  duplicateBatch: { id: string; state: string } | null;
  parserIssues: ReadonlyArray<{ lineNumber: number | null; field: string | null; message: string }>;
  resolutionIssues: ReadonlyArray<{ lineNumber: number; field: string; message: string }>;
}>;

type ApiError = Readonly<{ error?: string; message?: string; details?: { issues?: unknown } }>;

function commandKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** True when the server wants a fresh identity check before it will make this change. */
async function needsStepUp(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => ({}))) as { code?: string };
  return body.code === 'STEP_UP_REQUIRED';
}

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as ApiError;
  if (typeof body.message === 'string') return body.message;
  if (typeof body.error === 'string') return body.error;
  return 'The request could not be completed. Nothing was changed.';
}

function stateTone(state: Batch['state']): 'informational' | 'positive' | 'warning' {
  return state === 'LOCKED' ? 'positive' : state === 'APPROVED' ? 'informational' : 'warning';
}

export function OpeningBalanceWorkspace({
  tenantId,
  initialBatches,
}: {
  tenantId: string;
  initialBatches: readonly Batch[];
}) {
  const contextFetch = useContextFetch();
  const [file, setFile] = useState<File | null>(null);
  const [asOfDate, setAsOfDate] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batches, setBatches] = useState<readonly Batch[]>(initialBatches);
  const [busy, setBusy] = useState<'preview' | 'create' | string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const stepUpRetry = useRef<(() => void) | null>(null);

  const loadBatches = useCallback(async () => {
    const response = await contextFetch(
      `/api/opening-balances?tenantId=${encodeURIComponent(tenantId)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error(await readApiError(response));
    const body = (await response.json()) as { batches: readonly Batch[] };
    setBatches(body.batches);
  }, [contextFetch, tenantId]);

  const issues = useMemo(
    () => [...(preview?.parserIssues ?? []), ...(preview?.resolutionIssues ?? [])],
    [preview],
  );

  async function previewFile() {
    if (!file) {
      setMessage('Choose the CSV file supplied for opening balances.');
      return;
    }
    setBusy('preview');
    setMessage(null);
    try {
      if (file.size > 10_000_000) throw new Error('Each CSV import must be 10 MB or smaller.');
      const response = await contextFetch(
        `/api/opening-balances?tenantId=${encodeURIComponent(tenantId)}`,
        { method: 'POST', headers: { 'content-type': 'text/csv' }, body: await file.text() },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      setPreview((await response.json()) as Preview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The CSV could not be previewed.');
      setPreview(null);
    } finally {
      setBusy(null);
    }
  }

  async function createBatch() {
    if (!file || !asOfDate || !preview?.valid) {
      setMessage('Preview a valid CSV and choose the opening date before importing.');
      return;
    }
    setBusy('create');
    setMessage(null);
    try {
      const response = await contextFetch('/api/opening-balances', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': commandKey('opening-create'),
        },
        body: JSON.stringify({
          commandType: 'CreateOpeningBalanceBatch',
          tenantId,
          asOfDate,
          sourceFilename: file.name,
          csv: await file.text(),
        }),
      });
      if (await needsStepUp(response)) {
        stepUpRetry.current = () => void createBatch();
        setStepUpOpen(true);
        return;
      }
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage('Opening balances imported as a draft. Review it before approval.');
      setPreview(null);
      await loadBatches();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'The opening balances could not be imported.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function transition(
    batch: Batch,
    commandType: 'ApproveOpeningBalanceBatch' | 'LockOpeningBalanceBatch',
  ) {
    setBusy(batch.batchId);
    setMessage(null);
    try {
      const response = await contextFetch('/api/opening-balances', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': commandKey(commandType) },
        body: JSON.stringify({
          commandType,
          tenantId,
          batchId: batch.batchId,
          expectedVersion: batch.version,
        }),
      });
      if (await needsStepUp(response)) {
        stepUpRetry.current = () => void transition(batch, commandType);
        setStepUpOpen(true);
        return;
      }
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage(
        commandType.startsWith('Approve')
          ? 'Draft approved. It is ready to be locked.'
          : 'Opening balances locked and posted.',
      );
      await loadBatches();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The batch could not be advanced. Refresh and try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="content-grid">
      <Card as="section" className="panel content-span" aria-labelledby="opening-balance-title">
        <div className="panel-heading">
          <div>
            <h1 id="opening-balance-title">Opening balances</h1>
            <p>
              Upload one CSV, check every line, then approve and lock it. Locked figures cannot be
              edited.
            </p>
          </div>
        </div>
        <p className="state" role="note">
          Use this for supplier invoices, customer debt, station cash, bank balances and tank stock.
          Drafts do not change the ledgers.
        </p>
        <div className="form-grid">
          <label>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setMessage(null);
              }}
            />
          </label>
          <label>
            Opening date
            <input
              type="date"
              value={asOfDate}
              onChange={(event) => setAsOfDate(event.target.value)}
            />
          </label>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void previewFile()}
            disabled={busy !== null}
          >
            {busy === 'preview' ? 'Checking…' : 'Preview CSV'}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void createBatch()}
            disabled={busy !== null || !preview?.valid}
          >
            {busy === 'create' ? 'Importing…' : 'Import as draft'}
          </button>
        </div>
        {message ? (
          <p className="state" role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
        {preview ? (
          <div className="state" role="status" aria-live="polite">
            <strong>{preview.valid ? 'Ready to import' : 'Corrections needed'}</strong> —{' '}
            {preview.rowCount} line{preview.rowCount === 1 ? '' : 's'} checked.
            {preview.duplicateBatch ? (
              <p>This exact CSV was already imported as batch {preview.duplicateBatch.id}.</p>
            ) : null}
            {issues.length > 0 ? (
              <ul>
                {issues.slice(0, 20).map((issue, index) => (
                  <li key={`${issue.lineNumber ?? 'header'}-${issue.field ?? 'csv'}-${index}`}>
                    {issue.lineNumber ? `Line ${issue.lineNumber}: ` : ''}
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card
        as="section"
        className="panel content-span"
        aria-labelledby="opening-balance-batches-title"
      >
        <div className="panel-heading">
          <h2 id="opening-balance-batches-title">Imported batches</h2>
        </div>
        {batches.length === 0 ? (
          <EmptyState title="No batches yet" message="Preview a CSV to begin the go-live import." />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">Opening balance batches</caption>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Opening date</th>
                  <th>Lines</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.batchId}>
                    <th scope="row">{batch.sourceFilename ?? 'Unnamed CSV'}</th>
                    <td>{batch.asOfDate}</td>
                    <td>{batch.lineCount}</td>
                    <td>
                      <StatusBadge tone={stateTone(batch.state)}>
                        {batch.state === 'DRAFT'
                          ? 'Draft'
                          : batch.state === 'APPROVED'
                            ? 'Approved'
                            : 'Locked'}
                      </StatusBadge>
                    </td>
                    <td>
                      {batch.state === 'DRAFT' ? (
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => void transition(batch, 'ApproveOpeningBalanceBatch')}
                          disabled={busy !== null}
                        >
                          Approve
                        </button>
                      ) : batch.state === 'APPROVED' ? (
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => void transition(batch, 'LockOpeningBalanceBatch')}
                          disabled={busy !== null}
                        >
                          Lock and post
                        </button>
                      ) : (
                        <span>Immutable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <StepUpDialog
        open={stepUpOpen}
        tenantId={tenantId}
        description="Changing opening balances needs a fresh identity check. Nothing is changed until you confirm."
        confirmLabel="Confirm and continue"
        onCancel={() => {
          stepUpRetry.current = null;
          setStepUpOpen(false);
        }}
        onVerified={() => {
          const retry = stepUpRetry.current;
          stepUpRetry.current = null;
          setStepUpOpen(false);
          retry?.();
        }}
      />
    </div>
  );
}
