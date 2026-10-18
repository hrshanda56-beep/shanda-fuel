'use client';
import { useContextFetch } from '@/modules/context/client-context';

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
} from '@/design-system/primitives';
import { Modal } from '@/design-system/modal';
import { Icon } from '@/design-system/icons';
import { formatTileMoney } from '@/modules/reporting/format';
import { initials, isOverdue, movementLabel, overduePercent } from './supplier-format';

type SupplierSummary = {
  supplierId: string;
  code: string;
  legalName: string;
  current: string;
  overdue: string;
  total: string;
  asOf?: string;
};

type StatementLine = {
  sourceId: string;
  movementType: string;
  effectiveDate: string;
  postedAt: string;
  amount: string;
  runningBalance: string;
  currency: string;
};

type DocumentForm = {
  documentType: 'INVOICE' | 'CREDIT_NOTE';
  referenceNumber: string;
  documentDate: string;
  dueDate: string;
  amount: string;
};

type PaymentForm = {
  paymentDate: string;
  amount: string;
  reference: string;
};

const SUPPLIER_ROUTE_POLICY = contextRoutePolicy('/suppliers/:supplierId');
const EMPTY_DOCUMENT_FORM: DocumentForm = {
  documentType: 'INVOICE',
  referenceNumber: '',
  documentDate: '',
  dueDate: '',
  amount: '',
};
const EMPTY_PAYMENT_FORM: PaymentForm = {
  paymentDate: '',
  amount: '',
  reference: '',
};

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

function isExactDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

export function SupplierDetailWorkspace({ supplierId }: { supplierId: string }) {
  const contextFetch = useContextFetch();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [context, setContext] = useState<ContextResolution | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [supplier, setSupplier] = useState<SupplierSummary | null>(null);
  const [statement, setStatement] = useState<StatementLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentForm, setDocumentForm] = useState<DocumentForm>(EMPTY_DOCUMENT_FORM);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(EMPTY_PAYMENT_FORM);
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<'document' | 'payment' | null>(null);

  const current = context?.current ?? null;
  const hasRequiredContext = Boolean(
    current?.organisationId &&
    current.legalEntityId &&
    (SUPPLIER_ROUTE_POLICY.allStationsAllowed || current.stationId),
  );
  const backHref = current ? buildContextHref('/suppliers', search, current) : '/suppliers';

  const contextLabel = useMemo(() => {
    if (!context || !current) return null;
    const organisation = context.available.organisations.find(
      (candidate) => candidate.id === current.organisationId,
    );
    return (
      organisation?.legalEntities.find((entity) => entity.id === current.legalEntityId)?.name ??
      'Legal entity'
    );
  }, [context, current]);

  async function loadContext(signal: AbortSignal) {
    setContextLoading(true);
    setContextError(null);
    try {
      const response = await contextFetch(contextRequestUrl(`/suppliers/${supplierId}`, search), {
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

  async function loadDetails(selection: ContextSelection, signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const summaryParams = new URLSearchParams({
        tenantId: selection.organisationId,
        legalEntityId: selection.legalEntityId ?? '',
        supplierId,
      });
      const statementParams = new URLSearchParams({
        tenantId: selection.organisationId,
        legalEntityId: selection.legalEntityId ?? '',
        supplierId,
      });
      const [summaryResponse, statementResponse] = await Promise.all([
        fetch(`/api/suppliers/summary?${summaryParams.toString()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        }),
        fetch(`/api/suppliers/statement?${statementParams.toString()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        }),
      ]);
      const [summaryResult, statementResult]: [unknown, unknown] = await Promise.all([
        summaryResponse.json(),
        statementResponse.json(),
      ]);
      if (!summaryResponse.ok || !Array.isArray(summaryResult)) {
        throw new Error(getErrorMessage(summaryResult, 'Supplier balance could not be loaded'));
      }
      if (!statementResponse.ok || !Array.isArray(statementResult)) {
        throw new Error(getErrorMessage(statementResult, 'Supplier statement could not be loaded'));
      }
      setSupplier((summaryResult as SupplierSummary[])[0] ?? null);
      setStatement(statementResult as StatementLine[]);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Supplier detail could not be loaded');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadContext(controller.signal));
    return () => controller.abort();
    // URL changes trigger a fresh server-validated context resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, supplierId, contextFetch]);

  useEffect(() => {
    if (!hasRequiredContext || !current) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadDetails(current, controller.signal));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.organisationId, current?.legalEntityId, current?.stationId, current?.allStations]);

  async function submitCommand(
    commandType: 'SubmitSupplierDocument' | 'SubmitSupplierPayment',
    body: Record<string, unknown>,
    successMessage: string,
  ): Promise<boolean> {
    if (!current?.legalEntityId) return false;
    setAction(commandType);
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await fetch('/api/suppliers/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': newIdempotencyKey(),
        },
        body: JSON.stringify({
          commandType,
          tenantId: current.organisationId,
          legalEntityId: current.legalEntityId,
          supplierId,
          ...body,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(result, 'The supplier command failed'));
      setActionSuccess(successMessage);
      await loadDetails(current);
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The supplier command failed');
      return false;
    } finally {
      setAction(null);
    }
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = documentForm;
    if (!form.referenceNumber.trim() || !form.documentDate || !isExactDecimal(form.amount)) {
      setActionError('Document reference, date, and an exact decimal amount are required.');
      return;
    }
    if (form.dueDate && form.dueDate < form.documentDate) {
      setActionError('Due date cannot be before the document date.');
      return;
    }
    const submitted = await submitCommand(
      'SubmitSupplierDocument',
      {
        documentType: form.documentType,
        referenceNumber: form.referenceNumber.trim(),
        documentDate: form.documentDate,
        ...(form.dueDate ? { dueDate: form.dueDate } : {}),
        amount: form.amount,
      },
      'Supplier document submitted for posting review.',
    );
    if (submitted) {
      setDocumentForm(EMPTY_DOCUMENT_FORM);
      setOpenForm(null);
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = paymentForm;
    if (!form.paymentDate || !isExactDecimal(form.amount) || !form.reference.trim()) {
      setActionError('Payment date, reference, and an exact decimal amount are required.');
      return;
    }
    const submitted = await submitCommand(
      'SubmitSupplierPayment',
      {
        paymentDate: form.paymentDate,
        amount: form.amount,
        reference: form.reference.trim(),
      },
      'Supplier payment submitted for posting review.',
    );
    if (submitted) {
      setPaymentForm(EMPTY_PAYMENT_FORM);
      setOpenForm(null);
    }
  }

  function openSubmitForm(form: 'document' | 'payment') {
    setActionError(null);
    setActionSuccess(null);
    setOpenForm(form);
  }

  function closeSubmitForm() {
    if (action) return;
    setActionError(null);
    setOpenForm(null);
  }

  const late = supplier ? isOverdue(supplier) : false;

  return (
    <div className="content-grid wide-workspace">
      {contextLoading ? <LoadingState label="Loading" /> : null}
      {contextError ? <ErrorState message={contextError} /> : null}
      {!contextLoading && !contextError && !hasRequiredContext ? (
        <ContextRequiredState
          title="Select a legal entity"
          message="Choose a company from the work context to see this supplier."
        />
      ) : null}
      {error ? (
        <ErrorState
          message={error}
          action={
            current ? <Button onClick={() => void loadDetails(current)}>Retry</Button> : undefined
          }
        />
      ) : null}
      {loading ? <LoadingState label="Loading supplier detail" /> : null}
      {!loading && !error && hasRequiredContext && !supplier ? (
        <EmptyState
          title="Supplier not found in this context"
          message="This supplier may belong to a different company, or it has no balance recorded yet."
          action={
            <Link className="button button-secondary" href={backHref}>
              Return to suppliers
            </Link>
          }
        />
      ) : null}

      {actionSuccess ? <SuccessState title="Submitted" message={actionSuccess} /> : null}

      {supplier && hasRequiredContext && current ? (
        <>
          <Card
            as="section"
            className="panel content-span supplier-hero"
            aria-labelledby="supplier-detail-title"
          >
            <div className="supplier-hero-top">
              <div className="supplier-hero-actions">
                <Button variant="secondary" onClick={() => openSubmitForm('payment')}>
                  Submit payment
                </Button>
                <Button onClick={() => openSubmitForm('document')}>Submit document</Button>
              </div>
            </div>
            <div className="supplier-hero-id">
              <span className="list-avatar supplier-hero-avatar" aria-hidden="true">
                {initials(supplier.legalName)}
              </span>
              <div>
                <h2 id="supplier-detail-title">{supplier.legalName}</h2>
                <p>
                  {supplier.code}
                  {contextLabel ? ` · ${contextLabel}` : ''}
                </p>
              </div>
            </div>
            <dl className="supplier-figures" aria-label="Supplier balance summary">
              <div>
                <dt>Owed in total</dt>
                <dd>{formatTileMoney(supplier.total)}</dd>
              </div>
              <div>
                <dt>Not yet due</dt>
                <dd>{formatTileMoney(supplier.current)}</dd>
              </div>
              <div data-tone={late ? 'warning' : undefined}>
                <dt>Overdue</dt>
                <dd>{formatTileMoney(supplier.overdue)}</dd>
              </div>
              <div className="list-status">
                <dt>Status</dt>
                <dd>
                  <span className="balance-bar" aria-hidden="true">
                    <span style={{ width: `${late ? overduePercent(supplier) : 0}%` }} />
                  </span>
                  <span data-tone={late ? 'warning' : undefined}>
                    {late ? `${overduePercent(supplier)}% overdue` : 'Up to date'}
                  </span>
                </dd>
              </div>
            </dl>
          </Card>

          <Card
            as="section"
            className="panel content-span"
            aria-labelledby="supplier-statement-title"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Posted movements</p>
                <h2 id="supplier-statement-title">Statement</h2>
              </div>
              <Button variant="secondary" onClick={() => void loadDetails(current)}>
                Refresh
              </Button>
            </div>
            {statement.length === 0 ? (
              <EmptyState
                layout="block"
                icon="receipt"
                title="No posted movements"
                message="Submitted documents and payments appear here only after they are posted."
              />
            ) : (
              <div className="list-table ledger-table">
                <div className="list-head" aria-hidden="true">
                  <span>Effective date</span>
                  <span>Movement</span>
                  <span>Posted</span>
                  <span>Amount</span>
                  <span>Running balance</span>
                </div>
                <ul className="list-rows" aria-label="Posted supplier statement movements">
                  {statement.map((line) => (
                    <li key={`${line.sourceId}-${line.postedAt}`} className="list-row ledger-row">
                      <span className="list-cell" data-label="Effective date">
                        {line.effectiveDate}
                      </span>
                      <span className="list-cell ledger-movement" data-label="Movement">
                        {movementLabel(line.movementType)}
                      </span>
                      <span className="list-cell" data-label="Posted">
                        {line.postedAt}
                      </span>
                      <span className="list-cell list-amount" data-label="Amount">
                        {formatTileMoney(line.amount, line.currency)}
                      </span>
                      <span className="list-cell list-amount" data-label="Running balance">
                        {formatTileMoney(line.runningBalance, line.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Modal
            open={openForm === 'document'}
            onClose={closeSubmitForm}
            title="Submit document"
            description="Submit an invoice or credit note for posting review. Posting and correction actions remain separate controls."
            dismissible={!action}
            footer={
              <>
                <Button variant="secondary" onClick={closeSubmitForm} disabled={Boolean(action)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="submit-document-form"
                  loading={action === 'SubmitSupplierDocument'}
                >
                  Submit document
                </Button>
              </>
            }
          >
            {actionError ? <ErrorState message={actionError} /> : null}
            <form
              id="submit-document-form"
              className="stack"
              onSubmit={(event) => void submitDocument(event)}
            >
              <Field id="document-type" label="Document type" required>
                <select
                  id="document-type"
                  value={documentForm.documentType}
                  onChange={(event) =>
                    setDocumentForm((form) => ({
                      ...form,
                      documentType: event.target.value as DocumentForm['documentType'],
                    }))
                  }
                >
                  <option value="INVOICE">Invoice</option>
                  <option value="CREDIT_NOTE">Credit note</option>
                </select>
              </Field>
              <Field id="document-reference" label="Reference number" required>
                <input
                  id="document-reference"
                  value={documentForm.referenceNumber}
                  maxLength={120}
                  onChange={(event) =>
                    setDocumentForm((form) => ({ ...form, referenceNumber: event.target.value }))
                  }
                />
              </Field>
              <div className="form-grid">
                <Field id="document-date" label="Document date" required>
                  <input
                    id="document-date"
                    type="date"
                    value={documentForm.documentDate}
                    onChange={(event) =>
                      setDocumentForm((form) => ({ ...form, documentDate: event.target.value }))
                    }
                  />
                </Field>
                <Field id="document-due-date" label="Due date" optional>
                  <input
                    id="document-due-date"
                    type="date"
                    value={documentForm.dueDate}
                    onChange={(event) =>
                      setDocumentForm((form) => ({ ...form, dueDate: event.target.value }))
                    }
                  />
                </Field>
              </div>
              <Field
                id="document-amount"
                label="Amount"
                hint="Enter an exact decimal amount; binary floating point is not used."
                required
              >
                <input
                  id="document-amount"
                  inputMode="decimal"
                  value={documentForm.amount}
                  onChange={(event) =>
                    setDocumentForm((form) => ({ ...form, amount: event.target.value }))
                  }
                />
              </Field>
            </form>
          </Modal>

          <Modal
            open={openForm === 'payment'}
            onClose={closeSubmitForm}
            title="Submit payment"
            description="Record payment evidence for posting review. Allocation is available only after payment posting."
            dismissible={!action}
            footer={
              <>
                <Button variant="secondary" onClick={closeSubmitForm} disabled={Boolean(action)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="submit-payment-form"
                  loading={action === 'SubmitSupplierPayment'}
                >
                  Submit payment
                </Button>
              </>
            }
          >
            {actionError ? <ErrorState message={actionError} /> : null}
            <form
              id="submit-payment-form"
              className="stack"
              onSubmit={(event) => void submitPayment(event)}
            >
              <Field id="payment-date" label="Payment date" required>
                <input
                  id="payment-date"
                  type="date"
                  value={paymentForm.paymentDate}
                  onChange={(event) =>
                    setPaymentForm((form) => ({ ...form, paymentDate: event.target.value }))
                  }
                />
              </Field>
              <Field id="payment-reference" label="Reference" required>
                <input
                  id="payment-reference"
                  value={paymentForm.reference}
                  maxLength={120}
                  onChange={(event) =>
                    setPaymentForm((form) => ({ ...form, reference: event.target.value }))
                  }
                />
              </Field>
              <Field
                id="payment-amount"
                label="Amount"
                hint="Enter an exact decimal amount; payment method metadata is not yet supported by the command contract."
                required
              >
                <input
                  id="payment-amount"
                  inputMode="decimal"
                  value={paymentForm.amount}
                  onChange={(event) =>
                    setPaymentForm((form) => ({ ...form, amount: event.target.value }))
                  }
                />
              </Field>
            </form>
          </Modal>
        </>
      ) : null}
    </div>
  );
}
