'use client';
import { useContextFetch } from '@/modules/context/client-context';

import Decimal from 'decimal.js';
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
import { calculateDueDate } from '../credit-terms';
import { initials, isOverdue, movementLabel, overduePercent } from './supplier-format';

type SupplierSummary = {
  supplierId: string;
  code: string;
  legalName: string;
  current: string;
  overdue: string;
  total: string;
  asOf?: string;
  version?: number;
  creditLimit?: {
    status: 'none' | 'ok' | 'near' | 'over';
    limit: string | null;
    available: string | null;
    percentUsed: number | null;
  };
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

type LineForm = { description: string; quantity: string; unitPrice: string };

type DocumentForm = {
  documentType: 'INVOICE' | 'CREDIT_NOTE';
  referenceNumber: string;
  documentDate: string;
  dueDate: string;
  paymentTerms: '' | 'CASH' | 'CREDIT';
  creditPeriodDays: string;
  amount: string;
  lines: LineForm[];
};

type PaymentForm = {
  paymentDate: string;
  amount: string;
  reference: string;
};

const SUPPLIER_ROUTE_POLICY = contextRoutePolicy('/suppliers/:supplierId');
const EMPTY_LINE: LineForm = { description: '', quantity: '', unitPrice: '' };
const EMPTY_DOCUMENT_FORM: DocumentForm = {
  documentType: 'INVOICE',
  referenceNumber: '',
  documentDate: '',
  dueDate: '',
  paymentTerms: '',
  creditPeriodDays: '',
  amount: '',
  lines: [EMPTY_LINE],
};
const EMPTY_PAYMENT_FORM: PaymentForm = {
  paymentDate: '',
  amount: '',
  reference: '',
};

/** Whole days from the credit-period box: a number, null when empty, or 'invalid'. */
function periodDays(text: string): number | null | 'invalid' {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d{1,3}$/.test(value)) return 'invalid';
  const days = Number(value);
  return days > 365 ? 'invalid' : days;
}

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

function lineTotal(line: LineForm): Decimal | null {
  if (!isExactDecimal(line.quantity.trim()) || !isExactDecimal(line.unitPrice.trim())) return null;
  return new Decimal(line.quantity.trim()).mul(line.unitPrice.trim());
}

function linesSubtotal(lines: LineForm[]): string {
  return lines.reduce((sum, line) => sum.add(lineTotal(line) ?? 0), new Decimal(0)).toFixed(4);
}

export function SupplierDetailWorkspace({
  supplierId,
  initial,
}: {
  supplierId: string;
  initial?: {
    resolution: ContextResolution;
    supplier: SupplierSummary | null;
    statement: StatementLine[];
  };
}) {
  const contextFetch = useContextFetch();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [context, setContext] = useState<ContextResolution | null>(initial?.resolution ?? null);
  const [contextLoading, setContextLoading] = useState(!initial);
  const [contextError, setContextError] = useState<string | null>(null);
  const [supplier, setSupplier] = useState<SupplierSummary | null>(initial?.supplier ?? null);
  const [statement, setStatement] = useState<StatementLine[]>(initial?.statement ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentForm, setDocumentForm] = useState<DocumentForm>(EMPTY_DOCUMENT_FORM);
  const calculatedDueDate = useMemo(() => {
    if (documentForm.documentType !== 'INVOICE' || documentForm.paymentTerms !== 'CREDIT') {
      return '';
    }
    const days = periodDays(documentForm.creditPeriodDays);
    if (typeof days !== 'number' || !documentForm.documentDate) return '';
    try {
      return calculateDueDate(documentForm.documentDate, days);
    } catch {
      return '';
    }
  }, [documentForm]);
  const dueDateFromPeriod = calculatedDueDate !== '';
  const shownDueDate = dueDateFromPeriod ? calculatedDueDate : documentForm.dueDate;
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(EMPTY_PAYMENT_FORM);
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<'document' | 'payment' | null>(null);
  const [limitText, setLimitText] = useState('');

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
    if (initial) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadContext(controller.signal));
    return () => controller.abort();
    // URL changes trigger a fresh server-validated context resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, supplierId, contextFetch]);

  useEffect(() => {
    if (initial || !hasRequiredContext || !current) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadDetails(current, controller.signal));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.organisationId, current?.legalEntityId, current?.stationId, current?.allStations]);

  async function submitCommand(
    commandType: 'SubmitSupplierDocument' | 'SubmitSupplierPayment' | 'SetSupplierCreditLimit',
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

  async function saveCreditLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = limitText.trim();
    if (text !== '' && !/^\d+(?:\.\d{1,4})?$/.test(text.replace(/,/g, ''))) {
      setActionError('Enter the limit as an amount, for example 5000');
      return;
    }
    const saved = await submitCommand(
      'SetSupplierCreditLimit',
      {
        expectedVersion: supplier?.version ?? 0,
        creditLimit: text === '' ? null : text.replace(/,/g, ''),
      },
      text === '' ? 'Credit limit removed.' : 'Credit limit saved.',
    );
    if (saved) setLimitText('');
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = documentForm;
    if (!form.referenceNumber.trim() || !form.documentDate || !isExactDecimal(form.amount)) {
      setActionError('Document reference, date, and an exact decimal amount are required.');
      return;
    }
    const isInvoice = form.documentType === 'INVOICE';
    const creditDays = periodDays(form.creditPeriodDays);
    if (isInvoice && form.paymentTerms === 'CREDIT') {
      if (creditDays === 'invalid') {
        setActionError('Credit period must be a whole number of days, from 0 to 365.');
        return;
      }
      if (creditDays === null && !form.dueDate) {
        setActionError('For a credit purchase, enter the credit period in days or a due date.');
        return;
      }
    }
    if (form.dueDate && form.dueDate < form.documentDate) {
      setActionError('Due date cannot be before the document date.');
      return;
    }
    const filledLines = form.lines.filter(
      (line) => line.description.trim() || line.quantity.trim() || line.unitPrice.trim(),
    );
    if (
      filledLines.length === 0 ||
      filledLines.some((line) => !line.description.trim() || lineTotal(line) === null)
    ) {
      setActionError(
        'Add at least one invoice line. Each line needs a description, a quantity and a unit price.',
      );
      return;
    }
    const submitted = await submitCommand(
      'SubmitSupplierDocument',
      {
        lines: filledLines.map((line) => ({
          description: line.description.trim(),
          quantity: line.quantity.trim(),
          unitPrice: line.unitPrice.trim(),
        })),
        documentType: form.documentType,
        referenceNumber: form.referenceNumber.trim(),
        documentDate: form.documentDate,
        ...(isInvoice && form.paymentTerms === 'CASH' ? { paymentTerms: 'CASH' as const } : {}),
        ...(isInvoice && form.paymentTerms === 'CREDIT'
          ? {
              paymentTerms: 'CREDIT' as const,
              ...(typeof creditDays === 'number'
                ? { creditPeriodDays: creditDays }
                : { dueDate: form.dueDate }),
            }
          : {}),
        ...(isInvoice && form.paymentTerms === '' && form.dueDate ? { dueDate: form.dueDate } : {}),
        ...(!isInvoice && form.dueDate ? { dueDate: form.dueDate } : {}),
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

  function setDocumentLine(index: number, patch: Partial<LineForm>) {
    setDocumentForm((form) => ({
      ...form,
      lines: form.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)),
    }));
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

          <Card as="section" className="panel content-span" aria-labelledby="supplier-limit-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Agreed with the supplier</p>
                <h2 id="supplier-limit-title">Credit limit</h2>
              </div>
            </div>
            <p>{creditLimitSentence(supplier.creditLimit)}</p>
            <form onSubmit={saveCreditLimit} className="stack">
              <Field
                id="supplier-credit-limit"
                label="New credit limit"
                hint="The most you are willing to owe this supplier. Leave empty to remove the limit. It warns you; it never stops a purchase."
              >
                <input
                  id="supplier-credit-limit"
                  value={limitText}
                  onChange={(event) => setLimitText(event.target.value)}
                  inputMode="decimal"
                  placeholder="5000.00"
                />
              </Field>
              <Button type="submit" variant="secondary" disabled={action !== null}>
                Save credit limit
              </Button>
            </form>
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
                    value={shownDueDate}
                    readOnly={dueDateFromPeriod}
                    onChange={(event) =>
                      setDocumentForm((form) => ({ ...form, dueDate: event.target.value }))
                    }
                  />
                </Field>
              </div>
              {documentForm.documentType === 'INVOICE' ? (
                <div className="form-grid">
                  <Field id="document-payment-terms" label="How is this invoice paid?" optional>
                    <select
                      id="document-payment-terms"
                      value={documentForm.paymentTerms}
                      onChange={(event) =>
                        setDocumentForm((form) => ({
                          ...form,
                          paymentTerms: event.target.value as DocumentForm['paymentTerms'],
                          ...(event.target.value === 'CREDIT'
                            ? {}
                            : { creditPeriodDays: '', dueDate: '' }),
                        }))
                      }
                    >
                      <option value="">Not stated</option>
                      <option value="CASH">Cash (paid now)</option>
                      <option value="CREDIT">Credit (pay later)</option>
                    </select>
                  </Field>
                  {documentForm.paymentTerms === 'CREDIT' ? (
                    <Field id="document-credit-period" label="Credit period (days)" optional>
                      <input
                        id="document-credit-period"
                        inputMode="numeric"
                        value={documentForm.creditPeriodDays}
                        maxLength={3}
                        onChange={(event) =>
                          setDocumentForm((form) => ({
                            ...form,
                            creditPeriodDays: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  ) : null}
                </div>
              ) : null}
              <fieldset className="stack">
                <legend>Invoice lines</legend>
                {documentForm.lines.map((line, index) => (
                  <div className="form-grid" key={index}>
                    <Field id={`document-line-${index}-description`} label="Description" required>
                      <input
                        id={`document-line-${index}-description`}
                        value={line.description}
                        maxLength={300}
                        onChange={(event) =>
                          setDocumentLine(index, { description: event.target.value })
                        }
                      />
                    </Field>
                    <Field id={`document-line-${index}-quantity`} label="Quantity" required>
                      <input
                        id={`document-line-${index}-quantity`}
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(event) =>
                          setDocumentLine(index, { quantity: event.target.value })
                        }
                      />
                    </Field>
                    <Field id={`document-line-${index}-price`} label="Unit price" required>
                      <input
                        id={`document-line-${index}-price`}
                        inputMode="decimal"
                        value={line.unitPrice}
                        onChange={(event) =>
                          setDocumentLine(index, { unitPrice: event.target.value })
                        }
                      />
                    </Field>
                    {documentForm.lines.length > 1 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          setDocumentForm((form) => ({
                            ...form,
                            lines: form.lines.filter((_, at) => at !== index),
                          }))
                        }
                      >
                        Remove line
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setDocumentForm((form) => ({ ...form, lines: [...form.lines, EMPTY_LINE] }))
                  }
                >
                  Add line
                </Button>
                <p className="muted-small">Lines add up to {linesSubtotal(documentForm.lines)}.</p>
              </fieldset>
              <Field
                id="document-amount"
                label="Total payable"
                hint="The total printed on the invoice. It must equal the lines, plus VAT if your company adds VAT."
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

/** The credit position in one plain sentence. */
function creditLimitSentence(position: SupplierSummary['creditLimit']): string {
  if (!position || position.status === 'none' || position.limit === null) {
    return 'No credit limit is set for this supplier.';
  }
  const limit = formatTileMoney(position.limit);
  if (position.status === 'over') {
    return `You owe more than the ${limit} limit.`;
  }
  const room =
    position.available === null ? '' : ` ${formatTileMoney(position.available)} left to use.`;
  if (position.status === 'near') return `Close to the ${limit} limit.${room}`;
  return `The limit is ${limit}.${room}`;
}
