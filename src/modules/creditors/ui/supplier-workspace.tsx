'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  buildContextHref,
  contextRoutePolicy,
  type ContextApiResponse,
  type ContextResolution,
  type ContextSelection,
} from '@/modules/context';
import {
  Button,
  Card,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  SuccessState,
  StatusBadge,
} from '@/design-system/primitives';
import { Modal } from '@/design-system/modal';
import { PageHeader } from '@/design-system/layout';
import { TableScrollRegion } from '@/design-system/table';

type SupplierSummary = {
  supplierId: string;
  code: string;
  legalName: string;
  current: string;
  overdue: string;
  total: string;
  asOf?: string;
};

type CreateSupplierForm = {
  code: string;
  legalName: string;
  registrationReference: string;
};

const EMPTY_CREATE_FORM: CreateSupplierForm = {
  code: '',
  legalName: '',
  registrationReference: '',
};

const SUPPLIER_ROUTE_POLICY = contextRoutePolicy('/suppliers');

function getErrorMessage(result: unknown, fallback: string): string {
  if (typeof result === 'object' && result !== null && 'message' in result) {
    const message = (result as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function contextRequestUrl(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set('pathname', pathname);
  return `/api/context?${params.toString()}`;
}

function legalEntityName(
  resolution: ContextResolution,
  selection: ContextSelection,
): string | null {
  for (const organisation of resolution.available.organisations) {
    if (organisation.id !== selection.organisationId) continue;
    return (
      organisation.legalEntities.find((entity) => entity.id === selection.legalEntityId)?.name ??
      null
    );
  }
  return null;
}

export function SupplierWorkspace() {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [context, setContext] = useState<ContextResolution | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [rows, setRows] = useState<SupplierSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateSupplierForm>(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const current = context?.current ?? null;
  const currentLegalEntityName = useMemo(
    () => (context && current ? legalEntityName(context, current) : null),
    [context, current],
  );
  const hasRequiredContext = Boolean(
    current?.organisationId &&
    current.legalEntityId &&
    (SUPPLIER_ROUTE_POLICY.allStationsAllowed || current.stationId),
  );

  async function loadContext(signal: AbortSignal) {
    setContextLoading(true);
    setContextError(null);
    try {
      const response = await fetch(contextRequestUrl('/suppliers', search), {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const result = (await response.json()) as Partial<ContextApiResponse> & {
        message?: string;
      };
      if (!response.ok || !result.data) {
        throw new Error(getErrorMessage(result, 'Authorised supplier context could not be loaded'));
      }
      setContext(result.data);
    } catch (cause) {
      if (!signal.aborted) {
        setContext(null);
        setContextError(
          cause instanceof Error
            ? cause.message
            : 'Authorised supplier context could not be loaded',
        );
      }
    } finally {
      if (!signal.aborted) setContextLoading(false);
    }
  }

  async function loadSummary(selection: ContextSelection, signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        tenantId: selection.organisationId,
        legalEntityId: selection.legalEntityId ?? '',
      });
      const response = await fetch(`/api/suppliers/summary?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const result: unknown = await response.json();
      if (!response.ok || !Array.isArray(result)) {
        throw new Error(getErrorMessage(result, 'Supplier balances could not be loaded'));
      }
      setRows(result as SupplierSummary[]);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Supplier balances could not be loaded');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadContext(controller.signal));
    return () => controller.abort();
    // The URL is only a context refresh trigger. The server context endpoint
    // validates every requested dimension before returning current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!hasRequiredContext || !current) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadSummary(current, controller.signal));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.organisationId, current?.legalEntityId, current?.stationId, current?.allStations]);

  function resetCreateForm() {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateError(null);
    setCreateSuccess(null);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current?.legalEntityId) return;

    const code = createForm.code.trim();
    const legalName = createForm.legalName.trim();
    const registrationReference = createForm.registrationReference.trim();
    if (!code || !legalName) {
      setCreateError('Supplier code and legal name are required.');
      return;
    }

    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      const response = await fetch('/api/suppliers/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': newIdempotencyKey(),
        },
        body: JSON.stringify({
          commandType: 'CreateSupplier',
          tenantId: current.organisationId,
          legalEntityId: current.legalEntityId,
          code,
          legalName,
          ...(registrationReference ? { registrationReference } : {}),
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(result, 'Supplier could not be created'));

      setCreateSuccess(`Supplier ${code} was created.`);
      setCreateForm(EMPTY_CREATE_FORM);
      setCreateOpen(false);
      await loadSummary(current);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Supplier could not be created');
    } finally {
      setCreating(false);
    }
  }

  const supplierSelection = current;

  return (
    <div className="content-grid">
      <PageHeader
        eyebrow="Supplier creditors"
        title="Payables position"
        headingLevel="h2"
        titleId="supplier-payables-title"
        description="What each legal entity owes its suppliers, current and overdue."
        actions={
          hasRequiredContext ? (
            <Button
              onClick={() => {
                resetCreateForm();
                setCreateOpen(true);
              }}
            >
              Add supplier
            </Button>
          ) : null
        }
      />

      {contextLoading ? <LoadingState label="Loading authorised context" /> : null}
      {contextError ? (
        <ErrorState
          message={contextError}
          action={<Button onClick={() => window.location.reload()}>Retry</Button>}
        />
      ) : null}
      {!contextLoading && !contextError && !hasRequiredContext ? (
        <ContextRequiredState
          title="Select a legal entity"
          message="Choose an authorised legal-entity context before creditor balances can be loaded."
        />
      ) : null}

      {createSuccess ? <SuccessState title="Supplier created" message={createSuccess} /> : null}

      {hasRequiredContext && supplierSelection ? (
        <Card as="section" className="panel" aria-labelledby="supplier-creditors-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{currentLegalEntityName ?? 'Legal entity'}</p>
              <h2 id="supplier-creditors-title">Supplier balances</h2>
            </div>
            <StatusBadge tone="informational">Legal-entity scoped</StatusBadge>
          </div>
          {loading ? <LoadingState label="Loading supplier balances" /> : null}
          {error ? (
            <ErrorState
              message={error}
              action={<Button onClick={() => void loadSummary(supplierSelection)}>Retry</Button>}
            />
          ) : null}
          {!loading && !error && rows.length === 0 ? (
            <EmptyState
              title="No suppliers yet"
              message="Supplier records will appear after onboarding."
              action={
                <Button
                  onClick={() => {
                    resetCreateForm();
                    setCreateOpen(true);
                  }}
                >
                  Add supplier
                </Button>
              }
            />
          ) : null}
          {!loading && !error && rows.length > 0 ? (
            <TableScrollRegion label="Supplier creditor balances">
              <table className="responsive-table">
                <caption className="visually-hidden">Supplier creditor balances</caption>
                <thead>
                  <tr>
                    <th scope="col">Supplier</th>
                    <th scope="col">Current</th>
                    <th scope="col">Overdue</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.supplierId}>
                      <td data-label="Supplier">
                        <Link
                          href={buildContextHref(
                            `/suppliers/${encodeURIComponent(row.supplierId)}`,
                            search,
                            supplierSelection,
                          )}
                        >
                          <strong>{row.code}</strong>
                          <br />
                          {row.legalName}
                        </Link>
                      </td>
                      <td data-label="Current" className="numeric">
                        ${row.current}
                      </td>
                      <td data-label="Overdue" className="numeric">
                        ${row.overdue}
                      </td>
                      <td data-label="Total" className="numeric">
                        ${row.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
          ) : null}
        </Card>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="Add supplier"
        description="Create a supplier record in the currently authorised legal entity."
        dismissible={!creating}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="create-supplier-form" loading={creating}>
              Create supplier
            </Button>
          </>
        }
      >
        {createError ? <ErrorState message={createError} /> : null}
        <form
          id="create-supplier-form"
          className="stack"
          onSubmit={(event) => void submitCreate(event)}
        >
          <Field id="supplier-code" label="Supplier code" required>
            <input
              id="supplier-code"
              value={createForm.code}
              maxLength={80}
              onChange={(event) => setCreateForm((form) => ({ ...form, code: event.target.value }))}
              autoComplete="off"
            />
          </Field>
          <Field id="supplier-legal-name" label="Legal name" required>
            <input
              id="supplier-legal-name"
              value={createForm.legalName}
              maxLength={240}
              onChange={(event) =>
                setCreateForm((form) => ({ ...form, legalName: event.target.value }))
              }
              autoComplete="organization"
            />
          </Field>
          <Field id="supplier-registration-reference" label="Registration reference" optional>
            <input
              id="supplier-registration-reference"
              value={createForm.registrationReference}
              maxLength={120}
              onChange={(event) =>
                setCreateForm((form) => ({
                  ...form,
                  registrationReference: event.target.value,
                }))
              }
              autoComplete="off"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
