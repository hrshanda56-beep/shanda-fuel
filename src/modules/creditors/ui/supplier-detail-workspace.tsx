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
  StatusBadge,
  SuccessState,
} from '@/design-system/primitives';
import { PageHeader, MetricCard } from '@/design-system/layout';
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

  const current = context?.current ?? null;
  const hasRequiredContext = Boolean(
    current?.organisationId &&
    current.legalEntityId &&
    (SUPPLIER_ROUTE_POLICY.allStationsAllowed || current.stationId),
  );
  const backHref = current ? buildContextHref('/suppliers', search, current) : '/suppliers';
  const supplierHref = current
    ? buildContextHref(`/suppliers/${encodeURIComponent(supplierId)}`, search, current)
    : `/suppliers/${encodeURIComponent(supplierId)}`;

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
      const response = await fetch(contextRequestUrl(`/suppliers/${supplierId}`, search), {
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
  }, [search, supplierId]);

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
  ) {
    if (!current?.legalEntityId) return;
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
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The supplier command failed');
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
    await submitCommand(
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
    setDocumentForm(EMPTY_DOCUMENT_FORM);
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = paymentForm;
    if (!form.paymentDate || !isExactDecimal(form.amount) || !form.reference.trim()) {
      setActionError('Payment date, reference, and an exact decimal amount are required.');
      return;
    }
    await submitCommand(
      'SubmitSupplierPayment',
      {
        paymentDate: form.paymentDate,
        amount: form.amount,
        reference: form.reference.trim(),
      },
      'Supplier payment submitted for posting review.',
    );
    setPaymentForm(EMPTY_PAYMENT_FORM);
  }

  return (
    <div className="content-grid">
      <PageHeader
        eyebrow={contextLabel ?? 'Supplier creditors'}
        title={supplier ? supplier.legalName : 'Supplier detail'}
        description={
          supplier ? `Supplier code ${supplier.code}` : 'Review the authorised supplier position.'
        }
        actions={
          <Link className="button button-secondary" href={backHref}>
            Back to suppliers
          </Link>
        }
      />

      {contextLoading ? <LoadingState label="Loading authorised context" /> : null}
      {contextError ? <ErrorState message={contextError} /> : null}
      {!contextLoading && !contextError && !hasRequiredContext ? (
        <ContextRequiredState
          title="Select a legal entity"
          message="Choose an authorised legal-entity context before supplier detail can be loaded."
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
          message="The supplier may not belong to the selected legal entity, or its balance has no available read model yet."
          action={
            <Link className="button button-secondary" href={backHref}>
              Return to suppliers
            </Link>
          }
        />
      ) : null}

      {supplier && hasRequiredContext && current ? (
        <>
          <section className="metric-grid" aria-label="Supplier balance summary">
            <MetricCard label="Current" value={`$${supplier.current}`} />
            <MetricCard label="Overdue" value={`$${supplier.overdue}`} tone="critical" />
            <MetricCard label="Total" value={`$${supplier.total}`} />
          </section>

          {actionSuccess ? <SuccessState title="Submitted" message={actionSuccess} /> : null}
          {actionError ? <ErrorState message={actionError} /> : null}

          <Card as="section" className="panel" aria-labelledby="supplier-statement-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Posted movements</p>
                <h2 id="supplier-statement-title">Statement</h2>
              </div>
              <StatusBadge tone="informational">Read-only history</StatusBadge>
            </div>
            {statement.length === 0 ? (
              <EmptyState
                title="No posted movements"
                message="Submitted documents and payments appear here only after they are posted."
              />
            ) : (
              <TableScrollRegion label="Supplier statement">
                <table className="responsive-table">
                  <caption className="visually-hidden">Posted supplier statement movements</caption>
                  <thead>
                    <tr>
                      <th scope="col">Effective date</th>
                      <th scope="col">Movement</th>
                      <th scope="col">Posted</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Running balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.map((line) => (
                      <tr key={`${line.sourceId}-${line.postedAt}`}>
                        <td data-label="Effective date">{line.effectiveDate}</td>
                        <td data-label="Movement">{line.movementType}</td>
                        <td data-label="Posted">{line.postedAt}</td>
                        <td data-label="Amount" className="numeric">
                          {line.currency} {line.amount}
                        </td>
                        <td data-label="Running balance" className="numeric">
                          {line.currency} {line.runningBalance}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScrollRegion>
            )}
          </Card>

          <div className="content-grid content-span">
            <Card as="section" className="panel" aria-labelledby="submit-document-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Supplier documents</p>
                  <h2 id="submit-document-title">Submit document</h2>
                </div>
                <StatusBadge tone="pending">Posting review</StatusBadge>
              </div>
              <p>
                Submit an invoice or credit note. Posting and correction actions remain separate
                controls.
              </p>
              <form className="stack" onSubmit={(event) => void submitDocument(event)}>
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
                <div className="form-actions">
                  <Button type="submit" loading={action === 'SubmitSupplierDocument'}>
                    Submit document
                  </Button>
                </div>
              </form>
            </Card>

            <Card as="section" className="panel" aria-labelledby="submit-payment-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Supplier payments</p>
                  <h2 id="submit-payment-title">Submit payment</h2>
                </div>
                <StatusBadge tone="pending">Posting review</StatusBadge>
              </div>
              <p>
                Record payment evidence for posting. Allocation is available only after payment
                posting.
              </p>
              <form className="stack" onSubmit={(event) => void submitPayment(event)}>
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
                <div className="form-actions">
                  <Button type="submit" loading={action === 'SubmitSupplierPayment'}>
                    Submit payment
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          <p className="field-hint">
            <Link href={supplierHref}>Refresh this supplier view</Link> to re-resolve authorised
            context and reads.
          </p>
        </>
      ) : null}
    </div>
  );
}
