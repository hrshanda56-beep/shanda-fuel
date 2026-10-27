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
import {
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_PAYMENT_METHOD_LABELS,
  type ExpensePaymentMethod,
} from '@/modules/expenses/domain';
import { clientErrorMessage } from '@/platform/errors/client';
import { calculateDueDate } from '../credit-terms';
import { previewLandedCost } from '../landed-cost-preview';
import { DocumentAttachments } from '@/modules/documents/ui/document-attachments';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
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
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  defaultCreditDays?: number | null;
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
  paymentMethod?: string;
  bankAccount?: { bankName: string; accountReferenceMasked: string | null };
};

type PendingDocument = {
  kind: 'DOCUMENT';
  id: string;
  documentType: string;
  referenceNumber: string;
  documentDate: string;
  dueDate: string | null;
  amount: string;
  currency: string;
  version: number;
};
type PendingPayment = {
  kind: 'PAYMENT';
  id: string;
  paymentDate: string;
  referenceNumber: string;
  amount: string;
  currency: string;
  version: number;
};
type PendingItem = PendingDocument | PendingPayment;

type LineType = 'FUEL' | 'TRANSPORT' | 'OTHER_DIRECT_COST';
type LineForm = {
  lineType: LineType;
  /** The fuel on a fuel line; empty when it is not said. */
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  /** The confirmed delivery a fuel line is for; empty when it is not tied to one. */
  deliveryId: string;
};
type InvoiceDelivery = {
  id: string;
  stationId: string;
  productId: string;
  deliveryNoteNumber: string;
  businessDate: string;
  receivedLitres: string;
  noteLitres: string;
};
type InvoiceChoices = {
  products: { id: string; name: string }[];
  stations: { id: string; name: string }[];
  bankAccounts: {
    id: string;
    name: string;
    bankName: string;
    accountReferenceMasked: string;
  }[];
  /** Confirmed deliveries from this supplier that no posted invoice covers yet. */
  deliveries?: InvoiceDelivery[];
};

const LINE_TYPE_LABELS: Record<LineType, string> = {
  FUEL: 'Fuel',
  TRANSPORT: 'Transport',
  OTHER_DIRECT_COST: 'Other direct cost',
};

type DocumentForm = {
  documentType: 'INVOICE' | 'CREDIT_NOTE';
  referenceNumber: string;
  documentDate: string;
  dueDate: string;
  paymentTerms: '' | 'CASH' | 'CREDIT';
  creditPeriodDays: string;
  amount: string;
  /** null = not touched yet, so the current station is used; '' = no station. */
  stationId: string | null;
  lines: LineForm[];
};

type PaymentForm = {
  paymentDate: string;
  amount: string;
  reference: string;
  paymentMethod: ExpensePaymentMethod;
  bankAccountId: string;
};

type SupplierCommandFailure = Error & { status?: number; code?: string };
type SupplierStepUpRetry = {
  commandType:
    | 'SubmitSupplierDocument'
    | 'SubmitSupplierPayment'
    | 'PostSupplierPayment'
    | 'PostSupplierDocument'
    | 'ReturnSupplierDocument'
    | 'SetSupplierCreditLimit'
    | 'UpdateSupplierDetails';
  body: Record<string, unknown>;
  successMessage: string;
};

const SUPPLIER_ROUTE_POLICY = contextRoutePolicy('/suppliers/:supplierId');
const EMPTY_LINE: LineForm = {
  lineType: 'FUEL',
  productId: '',
  description: '',
  quantity: '',
  unitPrice: '',
  deliveryId: '',
};
const EMPTY_DOCUMENT_FORM: DocumentForm = {
  documentType: 'INVOICE',
  referenceNumber: '',
  documentDate: '',
  dueDate: '',
  paymentTerms: '',
  creditPeriodDays: '',
  amount: '',
  stationId: null,
  lines: [EMPTY_LINE],
};
const EMPTY_PAYMENT_FORM: PaymentForm = {
  paymentDate: '',
  amount: '',
  reference: '',
  paymentMethod: 'STATION_CASH',
  bankAccountId: '',
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

function formatPostedAt(value: string, timeZone: string | undefined): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (!timeZone) return value;
  return date.toLocaleString('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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
    pending?: PendingItem[];
    choices?: InvoiceChoices;
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
  const [pending, setPending] = useState<PendingItem[]>(initial?.pending ?? []);
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
  const [openForm, setOpenForm] = useState<'document' | 'document-file' | 'payment' | null>(null);
  const [limitText, setLimitText] = useState('');
  const choices: InvoiceChoices = initial?.choices ?? {
    products: [],
    stations: [],
    bankAccounts: [],
    deliveries: [],
  };
  const [savedDocumentId, setSavedDocumentId] = useState<string | null>(null);
  const [savedStationId, setSavedStationId] = useState('');
  const [returning, setReturning] = useState<PendingDocument | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [stepUpRetry, setStepUpRetry] = useState<SupplierStepUpRetry | null>(null);
  const [contactForm, setContactForm] = useState<{
    name: string;
    phone: string;
    email: string;
    days: string;
  } | null>(null);

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

  const statementTimezone = useMemo(() => {
    if (!context || !current) return undefined;
    const organisation = context.available.organisations.find(
      (candidate) => candidate.id === current.organisationId,
    );
    const legalEntity = organisation?.legalEntities.find(
      (candidate) => candidate.id === current.legalEntityId,
    );
    const station = current.stationId
      ? legalEntity?.stations.find((candidate) => candidate.id === current.stationId)
      : legalEntity?.stations[0];
    return station?.timezone;
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
      const [summaryResponse, statementResponse, pendingResponse] = await Promise.all([
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
        fetch(`/api/suppliers/pending?${statementParams.toString()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        }),
      ]);
      const [summaryResult, statementResult, pendingResult]: [unknown, unknown, unknown] =
        await Promise.all([
          summaryResponse.json(),
          statementResponse.json(),
          pendingResponse.json(),
        ]);
      if (!summaryResponse.ok || !Array.isArray(summaryResult)) {
        throw new Error(getErrorMessage(summaryResult, 'Supplier balance could not be loaded'));
      }
      if (!statementResponse.ok || !Array.isArray(statementResult)) {
        throw new Error(getErrorMessage(statementResult, 'Supplier statement could not be loaded'));
      }
      setSupplier((summaryResult as SupplierSummary[])[0] ?? null);
      setStatement(statementResult as StatementLine[]);
      // A failed list must not hide the rest of the page; it shows as nothing waiting.
      setPending(
        pendingResponse.ok && Array.isArray(pendingResult) ? (pendingResult as PendingItem[]) : [],
      );
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
    commandType:
      | 'SubmitSupplierDocument'
      | 'SubmitSupplierPayment'
      | 'PostSupplierPayment'
      | 'PostSupplierDocument'
      | 'ReturnSupplierDocument'
      | 'SetSupplierCreditLimit'
      | 'UpdateSupplierDetails',
    body: Record<string, unknown>,
    successMessage: string,
    isStepUpRetry = false,
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
      const result: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = new Error(
          clientErrorMessage({
            status: response.status,
            code:
              typeof result === 'object' && result !== null && 'error' in result
                ? typeof (result as { error?: unknown }).error === 'string'
                  ? (result as { error: string }).error
                  : undefined
                : undefined,
            message: getErrorMessage(result, ''),
            fallback: 'The supplier command failed',
          }),
        ) as SupplierCommandFailure;
        failure.status = response.status;
        if (typeof result === 'object' && result !== null && 'error' in result) {
          const code = (result as { error?: unknown }).error;
          if (typeof code === 'string') failure.code = code;
        }
        if (failure.status === 403 && failure.code === 'STEP_UP_REQUIRED' && !isStepUpRetry) {
          setStepUpRetry({ commandType, body, successMessage });
          return false;
        }
        throw failure;
      }
      if (
        commandType === 'SubmitSupplierDocument' &&
        typeof result === 'object' &&
        result !== null &&
        'documentId' in result
      ) {
        setSavedDocumentId(String((result as { documentId: unknown }).documentId));
      }
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

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactForm) return;
    const days = contactForm.days.trim();
    if (days && !/^\d{1,3}$/.test(days)) {
      setActionError('Enter the usual credit period as a whole number of days, for example 30.');
      return;
    }
    const saved = await submitCommand(
      'UpdateSupplierDetails',
      {
        expectedVersion: supplier?.version ?? 0,
        contactName: contactForm.name.trim() || null,
        contactPhone: contactForm.phone.trim() || null,
        contactEmail: contactForm.email.trim() || null,
        defaultCreditDays: days ? Number(days) : null,
      },
      'Supplier details saved.',
    );
    if (saved) setContactForm(null);
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
    if (isInvoice && form.paymentTerms === '') {
      setActionError('Say how this invoice is paid: cash now, or credit to pay later.');
      return;
    }
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
    if (
      choices.products.length > 0 &&
      filledLines.some((line) => line.lineType === 'FUEL' && !line.productId)
    ) {
      setActionError('Choose the fuel type on every fuel line.');
      return;
    }
    const stationId = form.stationId ?? current?.stationId ?? '';
    const deliveryRefs = [
      ...new Set(
        filledLines
          .filter((line) => line.lineType === 'FUEL' && line.deliveryId)
          .map((l) => l.deliveryId),
      ),
    ].map((deliveryId) => {
      const delivery = (choices.deliveries ?? []).find((candidate) => candidate.id === deliveryId)!;
      const own = filledLines.filter(
        (line) => line.lineType === 'FUEL' && line.deliveryId === deliveryId,
      );
      return {
        stationId: delivery.stationId,
        deliveryId,
        invoicedQuantityLitres: own
          .reduce((sum, line) => sum.add(line.quantity.trim()), new Decimal(0))
          .toFixed(3),
        invoicedAmount: own
          .reduce((sum, line) => sum.add(lineTotal(line) ?? 0), new Decimal(0))
          .toFixed(4),
      };
    });
    const submitted = await submitCommand(
      'SubmitSupplierDocument',
      {
        ...(stationId ? { stationId } : {}),
        lines: filledLines.map((line) => ({
          lineType: line.lineType,
          ...(line.lineType === 'FUEL' && line.productId ? { productId: line.productId } : {}),
          ...(line.lineType === 'FUEL' && line.deliveryId ? { deliveryId: line.deliveryId } : {}),
          description: line.description.trim(),
          quantity: line.quantity.trim(),
          unitPrice: line.unitPrice.trim(),
        })),
        ...(deliveryRefs.length > 0 ? { deliveryReferences: deliveryRefs } : {}),
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
      setSavedStationId(stationId);
      setDocumentForm(EMPTY_DOCUMENT_FORM);
      // Stay on the form's last step so the supplier's paper or PDF can be attached.
      setOpenForm('document-file');
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = paymentForm;
    if (!form.paymentDate || !isExactDecimal(form.amount) || !form.reference.trim()) {
      setActionError('Payment date, reference, and an exact decimal amount are required.');
      return;
    }
    if (form.paymentMethod === 'BANK' && !form.bankAccountId) {
      setActionError('Choose the bank account used for this payment.');
      return;
    }
    const submitted = await submitCommand(
      'SubmitSupplierPayment',
      {
        paymentDate: form.paymentDate,
        amount: form.amount,
        reference: form.reference.trim(),
        paymentMethod: form.paymentMethod,
        ...(form.paymentMethod === 'BANK' ? { bankAccountId: form.bankAccountId } : {}),
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
                <Link
                  className="button button-secondary"
                  href={buildContextHref(`/suppliers/${supplierId}/payments`, search, current)}
                >
                  Payment proofs
                </Link>
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
              {pending.length > 0 ? (
                <div>
                  <dt>Waiting to be posted</dt>
                  <dd>
                    {formatTileMoney(
                      pending
                        .filter((item): item is PendingDocument => item.kind === 'DOCUMENT')
                        .reduce(
                          (sum, item) =>
                            item.documentType === 'CREDIT_NOTE'
                              ? sum.minus(item.amount)
                              : sum.plus(item.amount),
                          new Decimal(0),
                        )
                        .toFixed(4),
                    )}
                    <small> not counted above</small>
                  </dd>
                </div>
              ) : null}
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
            aria-labelledby="supplier-contact-title"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Who to call and when you pay</p>
                <h2 id="supplier-contact-title">Contact and credit period</h2>
              </div>
            </div>
            {contactForm ? (
              <form onSubmit={saveContact} className="stack">
                <Field id="supplier-edit-name" label="Contact person" optional>
                  <input
                    id="supplier-edit-name"
                    value={contactForm.name}
                    maxLength={200}
                    onChange={(event) =>
                      setContactForm({ ...contactForm, name: event.target.value })
                    }
                  />
                </Field>
                <Field id="supplier-edit-phone" label="Phone number" optional>
                  <input
                    id="supplier-edit-phone"
                    type="tel"
                    value={contactForm.phone}
                    maxLength={60}
                    onChange={(event) =>
                      setContactForm({ ...contactForm, phone: event.target.value })
                    }
                  />
                </Field>
                <Field id="supplier-edit-email" label="Email" optional>
                  <input
                    id="supplier-edit-email"
                    type="email"
                    value={contactForm.email}
                    maxLength={200}
                    onChange={(event) =>
                      setContactForm({ ...contactForm, email: event.target.value })
                    }
                  />
                </Field>
                <Field id="supplier-edit-days" label="Usual credit period (days)" optional>
                  <input
                    id="supplier-edit-days"
                    inputMode="numeric"
                    maxLength={3}
                    value={contactForm.days}
                    onChange={(event) =>
                      setContactForm({ ...contactForm, days: event.target.value })
                    }
                  />
                </Field>
                <div className="form-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setContactForm(null)}
                    disabled={action !== null}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={action !== null}>
                    Save details
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <p>
                  {supplier.contactName || supplier.contactPhone || supplier.contactEmail
                    ? [supplier.contactName, supplier.contactPhone, supplier.contactEmail]
                        .filter(Boolean)
                        .join(' · ')
                    : 'No contact details recorded yet.'}
                </p>
                <p>
                  {supplier.defaultCreditDays === null || supplier.defaultCreditDays === undefined
                    ? 'Usual credit period not recorded.'
                    : `Usual credit period: ${supplier.defaultCreditDays} days.`}
                </p>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setContactForm({
                      name: supplier.contactName ?? '',
                      phone: supplier.contactPhone ?? '',
                      email: supplier.contactEmail ?? '',
                      days: supplier.defaultCreditDays?.toString() ?? '',
                    })
                  }
                >
                  Edit details
                </Button>
              </>
            )}
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
                  // Never a made-up figure: the limit in force, or a plain "no limit".
                  placeholder={
                    supplier.creditLimit?.limit == null
                      ? 'No limit set'
                      : `Currently ${supplier.creditLimit.limit}`
                  }
                />
              </Field>
              <Button type="submit" variant="secondary" disabled={action !== null}>
                Save credit limit
              </Button>
            </form>
          </Card>

          {pending.length > 0 ? (
            <Card
              as="section"
              className="panel content-span"
              aria-labelledby="supplier-pending-title"
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Entered, not counted yet</p>
                  <h2 id="supplier-pending-title">Waiting to be posted</h2>
                </div>
              </div>
              <p>
                These are not in the amount owed until they are posted. Check each one against the
                supplier&apos;s paper invoice, then post it.
              </p>
              <ul className="list-rows" aria-label="Supplier documents waiting to be posted">
                {pending.map((item) => (
                  <li key={item.id} className="list-row ledger-row">
                    {item.kind === 'PAYMENT' ? (
                      <>
                        <span className="list-cell ledger-movement" data-label="Payment">
                          Payment {item.referenceNumber}
                        </span>
                        <span className="list-cell" data-label="Dated">
                          {item.paymentDate}
                        </span>
                        <span className="list-cell list-amount" data-label="Amount">
                          {formatTileMoney(item.amount, item.currency)}
                        </span>
                        <span className="list-cell" data-label="">
                          <Button
                            variant="secondary"
                            loading={action === 'PostSupplierPayment'}
                            disabled={action !== null}
                            onClick={() =>
                              void submitCommand(
                                'PostSupplierPayment',
                                { paymentId: item.id, expectedVersion: item.version },
                                `${item.referenceNumber} was posted.`,
                              )
                            }
                          >
                            Post payment
                          </Button>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="list-cell ledger-movement" data-label="Document">
                          {item.documentType === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice'}{' '}
                          {item.referenceNumber}
                        </span>
                        <span className="list-cell" data-label="Dated">
                          {item.documentDate}
                          {item.dueDate ? `, due ${item.dueDate}` : ''}
                        </span>
                        <span className="list-cell list-amount" data-label="Amount">
                          {formatTileMoney(item.amount, item.currency)}
                        </span>
                        <span className="list-cell" data-label="">
                          <Button
                            variant="secondary"
                            loading={action === 'PostSupplierDocument'}
                            disabled={action !== null}
                            onClick={() =>
                              void submitCommand(
                                'PostSupplierDocument',
                                { documentId: item.id, expectedVersion: item.version },
                                `${item.referenceNumber} was posted.`,
                              )
                            }
                          >
                            Post
                          </Button>{' '}
                          <Button
                            variant="secondary"
                            disabled={action !== null}
                            onClick={() => {
                              setReturnReason('');
                              setReturning(item);
                            }}
                          >
                            Return
                          </Button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Modal
            open={returning !== null}
            onClose={() => (action === null ? setReturning(null) : undefined)}
            title="Return this document"
            size="sm"
          >
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                const target = returning;
                if (!target || !returnReason.trim()) return;
                void submitCommand(
                  'ReturnSupplierDocument',
                  {
                    documentId: target.id,
                    expectedVersion: target.version,
                    reason: returnReason.trim(),
                  },
                  `${target.referenceNumber} was returned. Enter it again once it is corrected.`,
                ).then((done) => {
                  if (done) setReturning(null);
                });
              }}
            >
              <p>
                {returning?.referenceNumber} will not be counted as owed. It stays in the history,
                and its reference number can be used again.
              </p>
              <Field id="supplier-return-reason" label="Why is it being returned?" required>
                <input
                  id="supplier-return-reason"
                  maxLength={500}
                  autoComplete="off"
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                />
              </Field>
              <div className="form-actions">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={action !== null}
                  onClick={() => setReturning(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={action === 'ReturnSupplierDocument'}
                  disabled={!returnReason.trim()}
                >
                  Return document
                </Button>
              </div>
            </form>
          </Modal>

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
                message="Submitted documents and payments waiting for posting appear here."
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
                        {line.paymentMethod ? (
                          <small>
                            {' · '}
                            {line.paymentMethod === 'BANK' && line.bankAccount
                              ? `${line.bankAccount.bankName} · ${line.bankAccount.accountReferenceMasked}`
                              : line.paymentMethod}
                          </small>
                        ) : null}
                      </span>
                      <span className="list-cell" data-label="Posted">
                        {formatPostedAt(line.postedAt, statementTimezone)}
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
              {choices.stations.length > 0 ? (
                <Field
                  id="document-station"
                  label="Station"
                  hint="Which station this invoice is for. Leave it blank if it covers the whole company."
                  optional
                >
                  <select
                    id="document-station"
                    value={documentForm.stationId ?? current?.stationId ?? ''}
                    onChange={(event) =>
                      setDocumentForm((form) => ({ ...form, stationId: event.target.value }))
                    }
                  >
                    <option value="">Not for one station</option>
                    {choices.stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
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
                <Field
                  id="document-due-date"
                  label="Due date"
                  optional={documentForm.paymentTerms !== 'CREDIT'}
                  required={documentForm.paymentTerms === 'CREDIT'}
                >
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
                  <Field id="document-payment-terms" label="How is this invoice paid?" required>
                    <select
                      id="document-payment-terms"
                      value={documentForm.paymentTerms}
                      onChange={(event) =>
                        setDocumentForm((form) => ({
                          ...form,
                          paymentTerms: event.target.value as DocumentForm['paymentTerms'],
                          ...(event.target.value === 'CREDIT'
                            ? {
                                // The supplier's usual credit period, unless one was already typed.
                                creditPeriodDays:
                                  form.creditPeriodDays ||
                                  (supplier?.defaultCreditDays?.toString() ?? ''),
                              }
                            : { creditPeriodDays: '', dueDate: '' }),
                        }))
                      }
                    >
                      <option value="">Choose one</option>
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
                    <Field id={`document-line-${index}-type`} label="What is it for?" required>
                      <select
                        id={`document-line-${index}-type`}
                        value={line.lineType}
                        onChange={(event) =>
                          setDocumentLine(index, {
                            lineType: event.target.value as LineType,
                            productId: '',
                          })
                        }
                      >
                        {(Object.keys(LINE_TYPE_LABELS) as LineType[]).map((type) => (
                          <option key={type} value={type}>
                            {LINE_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {line.lineType === 'FUEL' && choices.products.length > 0 ? (
                      <Field id={`document-line-${index}-product`} label="Fuel type" required>
                        <select
                          id={`document-line-${index}-product`}
                          value={line.productId}
                          onChange={(event) =>
                            setDocumentLine(index, { productId: event.target.value })
                          }
                        >
                          <option value="">Choose the fuel</option>
                          {choices.products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                    {line.lineType === 'FUEL' && (choices.deliveries ?? []).length > 0 ? (
                      <Field
                        id={`document-line-${index}-delivery`}
                        label="Delivery"
                        hint="Optional. Tie the fuel to the delivery it was for, so its litres received set the cost per litre."
                        optional
                      >
                        <select
                          id={`document-line-${index}-delivery`}
                          value={line.deliveryId}
                          onChange={(event) =>
                            setDocumentLine(index, { deliveryId: event.target.value })
                          }
                        >
                          <option value="">Not tied to a delivery</option>
                          {(choices.deliveries ?? [])
                            .filter(
                              (delivery) =>
                                (!line.productId || delivery.productId === line.productId) &&
                                (!(documentForm.stationId ?? current?.stationId) ||
                                  delivery.stationId ===
                                    (documentForm.stationId ?? current?.stationId)),
                            )
                            .map((delivery) => (
                              <option key={delivery.id} value={delivery.id}>
                                {delivery.deliveryNoteNumber} · {delivery.businessDate} ·{' '}
                                {delivery.receivedLitres} L received
                              </option>
                            ))}
                        </select>
                      </Field>
                    ) : null}
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
                {previewLandedCost(
                  documentForm.lines,
                  (choices.deliveries ?? []).map((delivery) => ({
                    id: delivery.id,
                    deliveryNoteNumber: delivery.deliveryNoteNumber,
                    receivedLitres: delivery.receivedLitres,
                  })),
                ).map((cost) => (
                  <p key={cost.deliveryId} className="muted-small" role="status">
                    Landed cost for delivery {cost.deliveryNoteNumber}: ({cost.purchaseCost} fuel +{' '}
                    {cost.directCosts} transport and other costs) ÷ {cost.receivedLitres} L actually
                    received = <strong>{cost.perLitre} a litre</strong>. After posting, record it on
                    the delivery with Record receipt cost so stock and cost of sales use it.
                  </p>
                ))}
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
            open={openForm === 'document-file'}
            onClose={() => {
              setOpenForm(null);
              setSavedDocumentId(null);
            }}
            title="Add the supplier's invoice"
            description="The invoice is saved and waiting to be posted. Add the supplier's paper or PDF so it can be checked."
            footer={
              <Button
                variant="primary"
                onClick={() => {
                  setOpenForm(null);
                  setSavedDocumentId(null);
                }}
              >
                Done
              </Button>
            }
          >
            {current?.stationId && savedDocumentId ? (
              <DocumentAttachments
                tenantId={current.organisationId}
                stationId={savedStationId || current.stationId}
                subjectType="SUPPLIER_DOCUMENT"
                subjectId={savedDocumentId}
                defaultKind="INVOICE"
                title="Supplier invoice file"
              />
            ) : (
              <p className="muted-small">
                Choose a station at the top of the page to attach the supplier&apos;s file to this
                invoice.
              </p>
            )}
          </Modal>

          <Modal
            open={openForm === 'payment'}
            onClose={closeSubmitForm}
            title="Submit payment"
            description="Enter the amount paid."
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
              <Field id="payment-amount" label="Amount" hint="Enter the amount paid." required>
                <input
                  id="payment-amount"
                  inputMode="decimal"
                  value={paymentForm.amount}
                  onChange={(event) =>
                    setPaymentForm((form) => ({ ...form, amount: event.target.value }))
                  }
                />
              </Field>
              <Field id="payment-method" label="Payment method" required>
                <select
                  id="payment-method"
                  value={paymentForm.paymentMethod}
                  onChange={(event) =>
                    setPaymentForm((form) => ({
                      ...form,
                      paymentMethod: event.target.value as ExpensePaymentMethod,
                      bankAccountId: event.target.value === 'BANK' ? form.bankAccountId : '',
                    }))
                  }
                >
                  {EXPENSE_PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {EXPENSE_PAYMENT_METHOD_LABELS[method]}
                    </option>
                  ))}
                </select>
              </Field>
              {paymentForm.paymentMethod === 'BANK' ? (
                <Field id="payment-bank-account" label="Bank account" required>
                  <select
                    id="payment-bank-account"
                    value={paymentForm.bankAccountId}
                    onChange={(event) =>
                      setPaymentForm((form) => ({ ...form, bankAccountId: event.target.value }))
                    }
                  >
                    <option value="">Choose…</option>
                    {choices.bankAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.bankName} · {account.accountReferenceMasked}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </form>
          </Modal>

          <StepUpDialog
            open={stepUpRetry !== null}
            tenantId={current.organisationId}
            description="Posting this supplier action needs a fresh identity check. Nothing is saved until you confirm."
            confirmLabel="Confirm and retry"
            onCancel={() => setStepUpRetry(null)}
            onVerified={() => {
              const retry = stepUpRetry;
              setStepUpRetry(null);
              if (retry) {
                void submitCommand(retry.commandType, retry.body, retry.successMessage, true);
              }
            }}
          />
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
