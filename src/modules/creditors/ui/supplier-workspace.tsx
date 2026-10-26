'use client';
import { useContextFetch } from '@/modules/context/client-context';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
} from '@/design-system/primitives';
import { Modal } from '@/design-system/modal';
import { Icon } from '@/design-system/icons';
import { formatTileMoney } from '@/modules/reporting/format';
import { initials, isOverdue, overduePercent } from './supplier-format';

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
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  creditDays: string;
  creditLimit: string;
};

const EMPTY_CREATE_FORM: CreateSupplierForm = {
  code: '',
  legalName: '',
  registrationReference: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  creditDays: '',
  creditLimit: '',
};

type SupplierFilter = 'all' | 'overdue' | 'current';

const FILTERS: ReadonlyArray<{ value: SupplierFilter; label: string }> = [
  { value: 'all', label: 'All Suppliers' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'current', label: 'Up To Date' },
];

function matchesFilter(row: SupplierSummary, filter: SupplierFilter): boolean {
  if (filter === 'overdue') return isOverdue(row);
  if (filter === 'current') return !isOverdue(row);
  return true;
}

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

/** Row actions. A sibling of the row link, not inside it, so a click never opens the supplier. */
function SupplierRowMenu({ row, href }: { row: SupplierSummary; href: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(row.code);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 900);
    } catch {
      setOpen(false);
    }
  }

  return (
    <div className="row-menu" ref={rootRef} data-open={open || undefined}>
      <button
        ref={triggerRef}
        type="button"
        className="row-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${row.legalName}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <div className="row-menu-list" role="menu">
          <Link role="menuitem" className="row-menu-item" href={href}>
            <Icon name="arrow-right" />
            Open supplier
          </Link>
          <button
            type="button"
            role="menuitem"
            className="row-menu-item"
            onClick={() => void copyCode()}
          >
            <Icon name={copied ? 'check' : 'tag'} />
            {copied ? 'Copied' : 'Copy supplier code'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SupplierWorkspace({
  initial,
}: {
  initial?: { resolution: ContextResolution; rows: SupplierSummary[] };
}) {
  const contextFetch = useContextFetch();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [context, setContext] = useState<ContextResolution | null>(initial?.resolution ?? null);
  const [contextLoading, setContextLoading] = useState(!initial);
  const [contextError, setContextError] = useState<string | null>(null);
  const [rows, setRows] = useState<SupplierSummary[]>(initial?.rows ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateSupplierForm>(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<SupplierFilter>('all');

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
      const response = await contextFetch(contextRequestUrl('/suppliers', search), {
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
    if (initial) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadContext(controller.signal));
    return () => controller.abort();
    // The URL is only a context refresh trigger. The server context endpoint
    // validates every requested dimension before returning current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, contextFetch]);

  useEffect(() => {
    if (initial || !hasRequiredContext || !current) return;
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
    const creditDays = createForm.creditDays.trim();
    if (creditDays && !/^\d{1,3}$/.test(creditDays)) {
      setCreateError('Enter the usual credit period as a whole number of days, for example 30.');
      return;
    }
    const creditLimit = createForm.creditLimit.trim().replace(/,/g, '');
    if (creditLimit && !/^\d+(?:\.\d{1,4})?$/.test(creditLimit)) {
      setCreateError('Enter the credit limit as an amount, for example 5000.');
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
          ...(createForm.contactName.trim() ? { contactName: createForm.contactName.trim() } : {}),
          ...(createForm.contactPhone.trim()
            ? { contactPhone: createForm.contactPhone.trim() }
            : {}),
          ...(createForm.contactEmail.trim()
            ? { contactEmail: createForm.contactEmail.trim() }
            : {}),
          ...(creditDays ? { defaultCreditDays: Number(creditDays) } : {}),
          ...(creditLimit ? { creditLimit } : {}),
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
  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return rows.filter(
      (row) =>
        matchesFilter(row, filter) &&
        (!query || `${row.code} ${row.legalName}`.toLowerCase().includes(query)),
    );
  }, [rows, searchTerm, filter]);
  const listReady = !loading && !error;
  const filterCount = (value: SupplierFilter) =>
    listReady ? rows.filter((row) => matchesFilter(row, value)).length : '—';

  return (
    <div className="content-grid wide-workspace">
      {contextLoading ? <LoadingState label="Loading" /> : null}
      {contextError ? (
        <ErrorState
          message={contextError}
          action={<Button onClick={() => window.location.reload()}>Retry</Button>}
        />
      ) : null}
      {!contextLoading && !contextError && !hasRequiredContext ? (
        <ContextRequiredState
          title="Select a legal entity"
          message="Choose a company from the work context to see what it owes suppliers."
        />
      ) : null}

      {createSuccess ? <SuccessState title="Supplier created" message={createSuccess} /> : null}

      {hasRequiredContext && supplierSelection ? (
        <Card
          as="section"
          className="panel content-span"
          aria-labelledby="supplier-creditors-title"
        >
          <h2 id="supplier-creditors-title" className="visually-hidden">
            Supplier balances
          </h2>

          <div className="list-toolbar">
            {rows.length > 0 ? (
              <>
                <label className="list-search">
                  <Icon name="search" />
                  <input
                    id="supplier-search"
                    type="search"
                    aria-label="Search suppliers"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search suppliers…"
                    autoComplete="off"
                  />
                </label>
                <div className="list-filters" role="group" aria-label="Filter suppliers">
                  {FILTERS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className="list-filter"
                      aria-pressed={filter === item.value}
                      onClick={() => setFilter(item.value)}
                    >
                      {item.label}
                      <span>{filterCount(item.value)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <Button
              className="list-toolbar-action"
              onClick={() => {
                resetCreateForm();
                setCreateOpen(true);
              }}
            >
              Add supplier
            </Button>
          </div>

          {loading ? <LoadingState label="Loading supplier balances" /> : null}
          {error ? (
            <ErrorState
              message={error}
              action={<Button onClick={() => void loadSummary(supplierSelection)}>Retry</Button>}
            />
          ) : null}
          {listReady && rows.length === 0 ? (
            <EmptyState
              layout="block"
              icon="users"
              title="No suppliers yet"
              message="Use Add supplier to create the first one."
            />
          ) : null}
          {listReady && rows.length > 0 && filteredRows.length === 0 ? (
            <EmptyState
              layout="block"
              icon="search"
              title="No matching suppliers"
              message="Try a different name or code."
            />
          ) : null}
          {listReady && filteredRows.length > 0 ? (
            <div className="list-table supplier-table">
              <div className="list-head" aria-hidden="true">
                <span>Supplier</span>
                <span>Status</span>
                <span>Not Yet Due</span>
                <span>Overdue</span>
                <span>Total</span>
                <span />
              </div>
              <ul className="list-rows" aria-label="Supplier balances">
                {filteredRows.map((row) => {
                  const href = buildContextHref(
                    `/suppliers/${encodeURIComponent(row.supplierId)}`,
                    search,
                    supplierSelection,
                  );
                  const late = isOverdue(row);
                  return (
                    <li key={row.supplierId} className="list-item">
                      <Link className="list-row" href={href}>
                        <span className="list-name">
                          <span className="list-avatar" aria-hidden="true">
                            {initials(row.legalName)}
                          </span>
                          <span>
                            <strong>{row.legalName}</strong>
                            <small>{row.code}</small>
                          </span>
                        </span>
                        <span className="list-cell list-status" data-label="Status">
                          <span className="balance-bar" aria-hidden="true">
                            <span style={{ width: `${late ? overduePercent(row) : 0}%` }} />
                          </span>
                          <span data-tone={late ? 'warning' : undefined}>
                            {late ? `${overduePercent(row)}% overdue` : 'Up to date'}
                          </span>
                        </span>
                        <span className="list-cell list-amount" data-label="Not yet due">
                          {formatTileMoney(row.current)}
                        </span>
                        <span
                          className="list-cell list-amount"
                          data-label="Overdue"
                          data-tone={late ? 'warning' : undefined}
                        >
                          {formatTileMoney(row.overdue)}
                        </span>
                        <span className="list-cell list-amount" data-label="Total">
                          {formatTileMoney(row.total)}
                        </span>
                      </Link>
                      <SupplierRowMenu row={row} href={href} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="Add supplier"
        description={`The supplier is added to ${currentLegalEntityName ?? 'the selected company'}.`}
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
          <Field id="supplier-contact-name" label="Contact person" optional>
            <input
              id="supplier-contact-name"
              value={createForm.contactName}
              maxLength={200}
              onChange={(event) =>
                setCreateForm((form) => ({ ...form, contactName: event.target.value }))
              }
              autoComplete="off"
            />
          </Field>
          <Field id="supplier-contact-phone" label="Phone number" optional>
            <input
              id="supplier-contact-phone"
              type="tel"
              value={createForm.contactPhone}
              maxLength={60}
              onChange={(event) =>
                setCreateForm((form) => ({ ...form, contactPhone: event.target.value }))
              }
              autoComplete="off"
            />
          </Field>
          <Field id="supplier-contact-email" label="Email" optional>
            <input
              id="supplier-contact-email"
              type="email"
              value={createForm.contactEmail}
              maxLength={200}
              onChange={(event) =>
                setCreateForm((form) => ({ ...form, contactEmail: event.target.value }))
              }
              autoComplete="off"
            />
          </Field>
          <Field
            id="supplier-credit-days"
            label="Usual credit period (days)"
            hint="How long this supplier normally gives you to pay. Pre-fills the due date on credit invoices."
            optional
          >
            <input
              id="supplier-credit-days"
              inputMode="numeric"
              value={createForm.creditDays}
              maxLength={3}
              onChange={(event) =>
                setCreateForm((form) => ({ ...form, creditDays: event.target.value }))
              }
              autoComplete="off"
            />
          </Field>
          <Field
            id="supplier-create-credit-limit"
            label="Credit limit (USD)"
            hint="The most you are willing to owe this supplier. It warns you; it never stops a purchase."
            optional
          >
            <input
              id="supplier-create-credit-limit"
              inputMode="decimal"
              value={createForm.creditLimit}
              onChange={(event) =>
                setCreateForm((form) => ({ ...form, creditLimit: event.target.value }))
              }
              autoComplete="off"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
