'use client';
import { useContextFetch } from '@/modules/context/client-context';

import { usePathname, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { type ContextResolution, type ContextSelection } from '@/modules/context';
import {
  Button,
  Card,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  SuccessState,
} from '../../../design-system/primitives';
import { Icon } from '../../../design-system/icons';
import { Modal } from '../../../design-system/modal';
import { Pagination, usePagination } from '../../../design-system/pagination';
import { TableScrollRegion } from '../../../design-system/table';
import { formatMoney } from '../../../design-system/formatters';
import { formatTileMoney } from '../../reporting/format';
import { clientErrorMessage } from '../../../platform/errors/client';
import { DocumentAttachments } from '../../documents/ui/document-attachments';
import { bankingStatusForDeposit, cashStatusLabelForCustody } from '../status';
import { CashHandoverSheet, type HandoverSummary } from './cash-handover-panel';
import {
  BankCashWizard,
  CollectCashWizard,
  ConfirmDepositWizard,
  ReceiveCashWizard,
} from './cash-sheet-wizards';
import { CashDonut, CashWallet, MASK, sumDecimals, type DonutSlice } from './cash-visuals';
import { TabbedCard } from '@/design-system/tabbed-card';
import { InfoTip } from '@/design-system/info-tip';

type CashCapabilities = {
  viewDeposits: boolean;
  recordCollection: boolean;
  receiveCollection: boolean;
  recordDeposit: boolean;
  confirmDeposit: boolean;
  submitHandover: boolean;
  acceptHandover: boolean;
  resolveHandover: boolean;
};

type CashSheet = 'record' | 'receive' | 'deposit' | 'confirm';

const SHEET_TITLES: Readonly<Record<CashSheet, string>> = {
  record: 'Collect cash',
  receive: 'Receive cash',
  deposit: 'Bank cash',
  confirm: 'Confirm bank deposits',
};

const COMMAND_DONE: Readonly<Record<string, string>> = {
  RecordCashCollection: 'Cash collected.',
  ReceiveCashCollection: 'Cash received.',
  CreateBankDeposit: 'Bank deposit recorded.',
  ConfirmBankDeposit: 'Deposit confirmed.',
};

/** Where a collection is, in plain words (the shared names in ../status). */
function custodyLabel(custodyState: string): string {
  const label = cashStatusLabelForCustody(custodyState);
  return label === custodyState ? displayState(custodyState) : label;
}

/** A bank deposit's status, in the same plain words as collections. */
function depositLabel(deposit: {
  state: string;
  amount: string;
  confirmedAmount?: string | null;
}): string {
  // A collection's own deposit list does not carry the confirmed amount; a confirmed deposit
  // there counts as banked in full.
  const confirmedAmount =
    deposit.confirmedAmount === undefined
      ? deposit.state === 'CONFIRMED'
        ? deposit.amount
        : null
      : deposit.confirmedAmount;
  return bankingStatusForDeposit({ ...deposit, confirmedAmount }) ?? displayState(deposit.state);
}

export type CashSummary = {
  stationId: string;
  stationTimezone?: string;
  currency: string;
  /** Cash open to collect, less cash paid out of the station's own cash since the last collection. */
  cashPosition?: { openToCollect: string; paidOut: string; cashToCollect: string };
  totals: {
    availableAtStation: string;
    heldByManagement?: string;
    collectedButUnbanked: string;
    pendingBankConfirmation: string;
  };
  collections: Array<{
    collectionId: string;
    collectionReference: string;
    amount: string;
    allocatedAmount: string;
    confirmedAmount: string;
    availableAtStation: string;
    collectedButUnbanked: string;
    pendingBankConfirmation: string;
    state: string;
    custodyState: string;
    sourceLocationId: string;
    currentLocationId: string;
    locationType?: string;
    version: number;
    businessDate?: string;
    recordedAt?: string;
    receivedAt?: string | null;
    /** Every bank deposit this cash went into. */
    deposits?: Array<{
      depositId: string;
      depositReference: string;
      amount: string;
      state: string;
      depositedAt: string;
    }>;
    /** The shift reports this cash was counted in. */
    shiftReports?: Array<{ reconciliationId: string; businessDate: string; amount: string }>;
  }>;
  locations: Array<{
    locationId: string;
    code: string;
    name: string;
    locationType: string;
  }>;
  reconciliationSources: Array<{
    reconciliationId: string;
    businessDate: string;
    countedCash: string;
    allocatedCash: string;
    availableCash: string;
  }>;
  bankAccounts: Array<{
    bankAccountId: string;
    name: string;
    bankName: string;
    accountReferenceMasked: string;
  }>;
  deposits: Array<{
    depositId: string;
    depositReference: string;
    amount: string;
    state: string;
    version: number;
    sourceLocationId: string;
    bankAccountId: string;
    bankAccountName: string;
    confirmedAmount: string | null;
    confirmationVariance: string | null;
    bankReference: string | null;
    depositedAt?: string;
    expectedConfirmationAt?: string | null;
    confirmedAt?: string | null;
    /** The cash this deposit holds. */
    collections?: Array<{ collectionId: string; collectionReference: string; amount: string }>;
  }>;
  handovers: HandoverSummary[];
  currentMembershipId: string;
  capabilities: CashCapabilities;
};

type RequestFailure = Error & {
  status?: number;
  code?: string;
  conflict?: boolean;
  /** Names of the form fields the server rejected, when it says which. */
  fields?: string[];
};

/** Which form control (by name) and plain label each rejected server field maps to. */
const FIELD_TARGETS: Record<string, { name: string; label: string }> = {
  bankAccountId: { name: 'bankAccountId', label: 'Bank account' },
  sourceLocationId: { name: 'sourceLocationId', label: 'where the cash is' },
  targetLocationId: { name: 'targetLocationId', label: 'Receiving location' },
  collectionId: { name: 'collectionId', label: 'Cash to receive' },
  reconciliationId: { name: 'reconciliationId', label: 'Shift cash' },
  sources: { name: 'amount', label: 'Amount' },
  amount: { name: 'amount', label: 'Amount' },
  allocations: { name: 'allocationAmount', label: 'Amount' },
  collectionReference: { name: 'collectionReference', label: 'Reference' },
  depositReference: { name: 'depositReference', label: 'Deposit reference' },
  confirmedAmount: { name: 'confirmedAmount', label: 'Amount the bank shows' },
  bankReference: { name: 'bankReference', label: 'Bank reference' },
};

const emptyCapabilities: CashCapabilities = {
  viewDeposits: false,
  recordCollection: false,
  receiveCollection: false,
  recordDeposit: false,
  confirmDeposit: false,
  submitHandover: false,
  acceptHandover: false,
  resolveHandover: false,
};

function normalizeSummary(value: CashSummary): CashSummary {
  return {
    ...value,
    locations: value.locations ?? [],
    reconciliationSources: value.reconciliationSources ?? [],
    bankAccounts: value.bankAccounts ?? [],
    deposits: value.deposits ?? [],
    handovers: value.handovers ?? [],
    currentMembershipId: value.currentMembershipId ?? '',
    capabilities: value.capabilities ?? emptyCapabilities,
  };
}

function requestFailure(response: Response, result: unknown, fallback: string): RequestFailure {
  const body =
    typeof result === 'object' && result !== null
      ? (result as { message?: unknown; error?: unknown })
      : {};
  const message = clientErrorMessage({
    status: response.status,
    code: typeof body.error === 'string' ? body.error : undefined,
    message: typeof body.message === 'string' ? body.message : undefined,
    fallback,
  });
  const failure = new Error(message) as RequestFailure;
  failure.status = response.status;
  if (typeof body.error === 'string') failure.code = body.error;
  failure.conflict = response.status === 409;
  const issues =
    typeof result === 'object' && result !== null && 'issues' in result
      ? (result as { issues?: unknown }).issues
      : undefined;
  if (Array.isArray(issues)) {
    failure.fields = issues
      .map((issue) =>
        (issue as { path?: unknown[] }).path?.find((part) => typeof part === 'string'),
      )
      .filter((field): field is string => typeof field === 'string' && field in FIELD_TARGETS);
  }
  return failure;
}

// The server supplies the station timezone; never use the viewer's browser timezone.
function formatWhen(value: string | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  if (!timeZone) return value;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T12:00:00Z`),
  );
}

function DetailList({
  id,
  items,
}: {
  id: string;
  items: Array<{ label: string; value: ReactNode; wide?: boolean }>;
}) {
  return (
    <dl className="cash-details" id={id}>
      {items.map((item) => (
        <div key={item.label} data-wide={item.wide || undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function displayState(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

type SummaryCollection = CashSummary['collections'][number];

/**
 * Where the collected cash is. The parts never overlap, so they add up to everything collected:
 * station, management-held, waiting for the bank, and banked.
 */
const POSITIONS: ReadonlyArray<{
  key: string;
  label: string;
  detail: string;
  tone: number;
  includes: (collection: SummaryCollection) => boolean;
}> = [
  {
    key: 'management',
    label: 'Held by management',
    detail: 'Received by management, not yet banked',
    tone: 3,
    includes: (c) =>
      (c.locationType ? c.locationType === 'COLLECTOR' : c.state === 'RECEIVED') &&
      isPositive(c.collectedButUnbanked),
  },
  {
    key: 'at-station',
    label: 'At the station',
    detail: 'Not in a bank deposit yet',
    tone: 1,
    includes: (c) => isPositive(c.availableAtStation),
  },
  {
    key: 'pending',
    label: 'Waiting for the bank',
    detail: 'Deposited, not yet confirmed',
    tone: 2,
    includes: (c) => isPositive(c.pendingBankConfirmation),
  },
  {
    key: 'banked',
    label: 'Banked',
    detail: 'Confirmed by the bank',
    tone: 0,
    includes: (c) => isPositive(c.confirmedAmount),
  },
];

function isPositive(value: string): boolean {
  return sumDecimals([value]) !== '0.00' && !value.trim().startsWith('-');
}

function optionLabel(value: string, fallback: string): string {
  return value || fallback;
}

export function CashWorkspace({
  initial,
}: {
  initial?: { selection: ContextSelection; summary: CashSummary };
}) {
  const contextFetch = useContextFetch();
  const pathname = usePathname() ?? '/stations/unknown/cash';
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const routeKey = `${pathname}?${search}`;
  const [context, setContext] = useState<ContextSelection | null>(initial?.selection ?? null);
  const [contextStatus, setContextStatus] = useState<'loading' | 'ready' | 'required' | 'error'>(
    initial ? 'ready' : 'loading',
  );
  const [contextError, setContextError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CashSummary | null>(
    initial ? normalizeSummary(initial.summary) : null,
  );
  const [loading, setLoading] = useState(!initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadedRouteKey, setLoadedRouteKey] = useState<string | null>(initial ? routeKey : null);
  const [confirmOnly, setConfirmOnly] = useState<string | null>(null);
  /** The cash a row's own "Bank" button chose, so the bank flow starts with it picked. */
  const [bankStart, setBankStart] = useState<string | undefined>(undefined);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [amountsHidden, setAmountsHidden] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<CashSheet | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const collectionPage = usePagination(summary?.collections ?? []);
  const depositPage = usePagination(summary?.deposits ?? []);
  const intentKeys = useRef(new Map<string, string>());

  const loadContext = useCallback(
    async (signal?: AbortSignal): Promise<ContextSelection | null> => {
      const params = new URLSearchParams(search);
      params.set('pathname', pathname);
      const response = await contextFetch(`/api/context?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const result = (await response.json()) as { data?: ContextResolution; message?: string };
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) return null;
        throw requestFailure(response, result, 'Work context could not be loaded');
      }
      const current = result.data?.current;
      if (!current?.stationId || current.allStations) return null;
      return current;
    },
    [pathname, search, contextFetch],
  );

  const loadSummary = useCallback(async (selection: ContextSelection, signal?: AbortSignal) => {
    if (!selection.stationId || selection.allStations) return;
    const params = new URLSearchParams({
      tenantId: selection.organisationId,
      stationId: selection.stationId,
      allStations: 'false',
    });
    if (selection.legalEntityId) params.set('legalEntityId', selection.legalEntityId);
    const response = await fetch(`/api/cash/summary?${params.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
    const result = await response.json();
    if (!response.ok) throw requestFailure(response, result, 'Cash summary could not be loaded');
    setSummary(normalizeSummary(result as CashSummary));
  }, []);

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();

    void loadContext(controller.signal)
      .then((selection) => {
        if (controller.signal.aborted) return;
        if (!selection) {
          setContext(null);
          setSummary(null);
          setContextStatus('required');
          setLoadedRouteKey(routeKey);
          setLoading(false);
          return;
        }
        setContext(selection);
        setContextStatus('ready');
        return loadSummary(selection, controller.signal);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setContextStatus('error');
        setContextError(
          cause instanceof Error ? cause.message : 'Work context could not be loaded',
        );
        setLoadedRouteKey(routeKey);
        setLoading(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadedRouteKey(routeKey);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [loadContext, loadSummary, routeKey, initial]);

  async function refresh() {
    if (!context) return;
    setLoading(true);
    setError(null);
    try {
      await loadSummary(context);
    } catch (cause) {
      setError(cause as RequestFailure);
    } finally {
      setLoading(false);
    }
  }

  /** Sends one cash command. Empty optional answers are left out rather than sent empty. */
  async function sendCommand(commandType: string, fields: Record<string, unknown>) {
    if (!context) return;
    const payload: Record<string, unknown> = { commandType, context };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== '' && value !== undefined) payload[key] = value;
    }
    if (commandType === 'ReceiveCashCollection') {
      const collection = summary?.collections.find(
        (candidate) => candidate.collectionId === fields.collectionId,
      );
      payload.expectedVersion = collection?.version ?? -1;
    }
    if (commandType === 'ConfirmBankDeposit') {
      const deposit = summary?.deposits.find(
        (candidate) => candidate.depositId === fields.depositId,
      );
      payload.expectedVersion = deposit?.version ?? -1;
    }

    const signature = JSON.stringify(payload);
    const idempotencyKey = intentKeys.current.get(signature) ?? crypto.randomUUID();
    intentKeys.current.set(signature, idempotencyKey);
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/cash/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw requestFailure(response, result, 'Cash command failed');
      intentKeys.current.delete(signature);
      setSuccess(COMMAND_DONE[commandType] ?? 'Saved.');
      closeSheet();
      await refresh();
    } catch (cause) {
      setError(cause as RequestFailure);
    } finally {
      setBusy(false);
    }
  }

  /** Turns a failed save into a plain message plus the button that gets the person unstuck. */
  function failureHelp(failure: RequestFailure): { message: string; action?: ReactNode } {
    const status = failure.status ?? 0;
    const target = failure.fields?.map((field) => FIELD_TARGETS[field]).find(Boolean);
    if (target) {
      return {
        message: `Please press Back and check “${target.label}”. Nothing was saved.`,
      };
    }
    if (status === 409) {
      return {
        message: /[.!?]$/.test(failure.message) ? failure.message : `${failure.message}.`,
        action: <Button onClick={() => void refresh()}>Update and keep my details</Button>,
      };
    }
    if (status === 404) {
      return {
        message: 'Something you picked is no longer available.',
        action: <Button onClick={() => void refresh()}>Update the lists</Button>,
      };
    }
    if (status === 401 || status === 403) {
      return {
        message: 'You do not have permission to do this, or your sign-in has expired.',
        action: <Button onClick={() => window.location.reload()}>Reload the page</Button>,
      };
    }
    if (status === 400) {
      // The server's reason is written for people ("Attach the deposit slip before confirming…"), and
      // a step-by-step guide has no single field to point at, so say it rather than something vague.
      const reason = failure.message?.trim();
      if (reason && !/^cash command failed$/i.test(reason)) {
        return { message: /[.!?]$/.test(reason) ? reason : `${reason}.` };
      }
      return { message: 'Some of the details are not right. Please check the form and try again.' };
    }
    return {
      message:
        'We could not save this. Nothing was changed, and what you typed is still here. Press the button again to try again.',
    };
  }

  if (loadedRouteKey !== routeKey || contextStatus === 'loading') {
    return (
      <Card as="section" className="panel" aria-labelledby="cash-context-loading-title">
        <h2 id="cash-context-loading-title" className="sr-only">
          Cash context
        </h2>
        <LoadingState label="Loading" />
      </Card>
    );
  }

  if (contextStatus === 'required') {
    return (
      <Card as="section" className="panel" aria-labelledby="cash-context-required-title">
        <ContextRequiredState
          title="Select a station to load cash"
          message="Use the station selector above to choose a station. Cash is shown for one station at a time."
        />
      </Card>
    );
  }

  if (contextStatus === 'error') {
    return (
      <Card as="section" className="panel" aria-labelledby="cash-context-error-title">
        <h2 id="cash-context-error-title">Cash context unavailable</h2>
        <ErrorState
          message={contextError ?? 'The station could not be loaded.'}
          action={<Button onClick={() => window.location.reload()}>Retry</Button>}
        />
      </Card>
    );
  }

  const capabilities = summary?.capabilities ?? emptyCapabilities;
  const recordableSources = summary?.reconciliationSources ?? [];
  const receiveableCollections =
    summary?.collections.filter((collection) => collection.state === 'RECORDED') ?? [];
  const depositableCollections =
    summary?.collections.filter((collection) => Number(collection.availableAtStation) > 0) ?? [];
  const confirmableDeposits =
    summary?.deposits.filter(
      (deposit) => deposit.state === 'RECORDED' || deposit.state === 'SUBMITTED',
    ) ?? [];
  const locationOptions =
    summary?.locations.map((location) => ({
      value: location.locationId,
      label: `${location.name} (${location.code})`,
    })) ?? [];
  const collectionOptions = depositableCollections.map((collection) => ({
    value: collection.collectionId,
    label: `${collection.collectionReference} · USD ${collection.availableAtStation}`,
  }));

  const collectionsList = summary?.collections ?? [];
  const positionTotals: Record<string, string> = {
    'at-station': summary?.totals.availableAtStation ?? '0',
    management: summary?.totals.heldByManagement ?? '0',
    pending: summary?.totals.pendingBankConfirmation ?? '0',
    banked: sumDecimals(collectionsList.map((collection) => collection.confirmedAmount)),
  };
  const custodySlices: DonutSlice[] = POSITIONS.map((position) => ({
    key: position.key,
    label: position.label,
    detail: position.detail,
    tone: position.tone,
    total: positionTotals[position.key] ?? '0',
    count: collectionsList.filter(position.includes).length,
  }));
  const historyGroup = POSITIONS.find((position) => position.key === historyKey) ?? null;
  const historyItems = historyGroup ? collectionsList.filter(historyGroup.includes) : [];

  function openSheet(next: CashSheet) {
    setError(null);
    setSuccess(null);
    setConfirmOnly(null);
    setBankStart(undefined);
    setSheet(next);
  }

  /** Opens the bank flow with this collection chosen and its full amount filled in. */
  function openDepositFor(collection?: SummaryCollection) {
    openSheet('deposit');
    setBankStart(collection?.collectionId);
  }

  /** Bank cash with the only bankable collection already chosen, when there is just one. */
  function openDepositSheet() {
    openDepositFor(depositableCollections.length === 1 ? depositableCollections[0] : undefined);
  }

  function openConfirmFor(depositId: string) {
    openSheet('confirm');
    setConfirmOnly(depositId);
  }

  function closeSheet() {
    setSheet(null);
    setConfirmOnly(null);
    setBankStart(undefined);
  }

  function requestCloseSheet() {
    if (!busy) closeSheet();
  }

  const sheetActions: Array<{
    key: CashSheet;
    label: string;
    shortLabel: string;
    available: boolean;
  }> = [
    {
      key: 'record',
      label: 'Collect cash',
      shortLabel: 'Collect cash',
      available: capabilities.recordCollection,
    },
    {
      key: 'receive',
      label: 'Receive cash',
      shortLabel: 'Receive cash',
      available: capabilities.receiveCollection,
    },
    {
      key: 'deposit',
      label: 'Bank cash',
      shortLabel: 'Bank cash',
      available: capabilities.recordDeposit,
    },
    {
      key: 'confirm',
      label: `Confirm deposits (${confirmableDeposits.length})`,
      shortLabel: `Confirm deposits (${confirmableDeposits.length})`,
      available: capabilities.confirmDeposit && confirmableDeposits.length > 0,
    },
  ];

  const toggleRow = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const locationName = (locationId: string) =>
    summary?.locations.find((location) => location.locationId === locationId)?.name ??
    'Unknown location';
  const plain = (value: string) => (amountsHidden ? `${MASK} USD` : formatMoney(value));

  const canBank =
    capabilities.recordDeposit &&
    depositableCollections.length > 0 &&
    !!summary?.bankAccounts.length;
  const canConfirm = capabilities.confirmDeposit && confirmableDeposits.length > 0;
  /** Cash can change hands here for anyone who may hand it over, or who has some waiting. */
  const showHandover =
    !!summary && (summary.capabilities.submitHandover || summary.handovers.length > 0);
  const waitingHandovers =
    summary?.handovers.filter((h) => h.state === 'SUBMITTED' || h.state === 'DISPUTED').length ?? 0;
  const canCollect = capabilities.recordCollection && recordableSources.length > 0;
  const hasAnyAction =
    capabilities.recordCollection ||
    capabilities.receiveCollection ||
    capabilities.recordDeposit ||
    capabilities.confirmDeposit;

  /**
   * Said only when there is nothing to do. When there is, the buttons in Cash on hand already
   * offer it, so no second card repeats them.
   */
  const idleNote: string | null =
    !summary || !hasAnyAction || canConfirm || canBank || canCollect
      ? null
      : !capabilities.viewDeposits && Number(summary.totals.availableAtStation) > 0
        ? `${amountsHidden ? `${summary.currency} ${MASK}` : formatTileMoney(summary.totals.availableAtStation, summary.currency)} is at the station. Your role cannot see bank deposits, so this page cannot show whether it has been banked.`
        : summary.collections.length === 0
          ? 'Nothing to do yet. Cash shows up here once a shift report is approved.'
          : 'All caught up. Nothing needs doing right now.';

  // Approved shift cash nobody has collected yet. It is not in any bucket below until someone records
  // the collection, so say so here instead of leaving every figure at zero.
  const awaitingCollection = summary?.cashPosition?.cashToCollect ?? '0';
  const hasAwaitingCollection = !!summary && isPositive(awaitingCollection);

  return (
    <div className="content-grid cash-workspace">
      {hasAwaitingCollection && summary ? (
        <div className="content-span cash-next" role="status">
          <p>
            <strong>{plain(awaitingCollection)}</strong> from approved shift reports is waiting to
            be collected. It shows in the figures below once you record the collection.
          </p>
          {canCollect ? (
            <Button variant="primary" onClick={() => openSheet('record')}>
              Collect cash
            </Button>
          ) : null}
        </div>
      ) : null}
      {idleNote && !hasAwaitingCollection ? (
        <div className="content-span cash-next" role="status">
          <p>{idleNote}</p>
        </div>
      ) : null}
      <Card
        as="section"
        className="panel cash-panel cash-panel-fill"
        aria-labelledby="cash-actions-title"
      >
        <div className="panel-heading">
          <div>
            <h2 id="cash-actions-title">Cash on hand</h2>
          </div>
        </div>
        {summary ? (
          <CashWallet
            accounts={summary.bankAccounts}
            deposits={summary.deposits}
            amount={summary.totals.availableAtStation}
            currency={summary.currency}
            hidden={amountsHidden}
            onToggleHidden={() => setAmountsHidden((value) => !value)}
            accountsHidden={!capabilities.viewDeposits}
          />
        ) : null}
        <div className="cash-action-bar">
          {sheetActions
            .filter((action) => action.available)
            .map((action) => (
              <Button
                key={action.key}
                variant="secondary"
                aria-haspopup="dialog"
                onClick={() =>
                  action.key === 'deposit' ? openDepositSheet() : openSheet(action.key)
                }
              >
                <span className="cash-action-full">{action.label}</span>
                <span className="cash-action-short">{action.shortLabel}</span>
              </Button>
            ))}
          {showHandover ? (
            <Button aria-haspopup="dialog" onClick={() => setHandoverOpen(true)}>
              {summary?.capabilities.submitHandover ? 'Hand over cash' : 'Cash handovers'}
              {waitingHandovers > 0 ? ` (${waitingHandovers})` : ''}
            </Button>
          ) : null}
        </div>

        <Modal
          open={sheet !== null}
          onClose={requestCloseSheet}
          title={sheet ? SHEET_TITLES[sheet] : 'Cash action'}
          presentation="page"
          backLabel="Cash & banking"
          size="md"
          dismissible={!busy}
        >
          {error ? (
            <ErrorState
              title="This could not be saved"
              message={failureHelp(error).message}
              action={failureHelp(error).action}
            />
          ) : null}
          {sheet === 'record' && capabilities.recordCollection ? (
            recordableSources.length === 0 || locationOptions.length === 0 ? (
              <p className="cash-sheet-note">
                {recordableSources.length === 0
                  ? 'There is no approved shift cash to collect yet. It shows up here once a shift report is approved.'
                  : 'This station has no cash locations set up yet. Ask an administrator to add one.'}
              </p>
            ) : (
              <CollectCashWizard
                sources={recordableSources}
                locations={locationOptions}
                paidOutNote={
                  summary?.cashPosition && Number(summary.cashPosition.paidOut) > 0
                    ? `${formatMoney(summary.cashPosition.paidOut)} was paid out of station cash for expenses since the last collection, so only ${formatMoney(summary.cashPosition.cashToCollect)} can be collected now.`
                    : null
                }
                money={formatMoney}
                busy={busy}
                error={null}
                onCancel={closeSheet}
                onSubmit={(value) =>
                  void sendCommand('RecordCashCollection', {
                    sourceLocationId: value.sourceLocationId,
                    collectionReference: value.collectionReference,
                    sources: [{ reconciliationId: value.reconciliationId, amount: value.amount }],
                  })
                }
              />
            )
          ) : null}

          {sheet === 'receive' && capabilities.receiveCollection ? (
            receiveableCollections.length === 0 || locationOptions.length < 2 ? (
              <p className="cash-sheet-note">
                {receiveableCollections.length === 0
                  ? 'No cash is waiting to be received.'
                  : 'Receiving needs at least two cash locations, and this station has one.'}
              </p>
            ) : (
              <ReceiveCashWizard
                collections={receiveableCollections}
                locations={locationOptions}
                money={formatMoney}
                busy={busy}
                error={null}
                onCancel={closeSheet}
                onSubmit={(value) => void sendCommand('ReceiveCashCollection', { ...value })}
              />
            )
          ) : null}

          {sheet === 'deposit' && capabilities.recordDeposit ? (
            !summary?.bankAccounts.length || depositableCollections.length === 0 ? (
              <p className="cash-sheet-note">
                {depositableCollections.length === 0
                  ? 'There is no cash at the station to bank right now.'
                  : 'This station has no bank account set up yet. Ask an administrator to add one.'}
              </p>
            ) : (
              <BankCashWizard
                accounts={summary.bankAccounts.map((account) => ({
                  value: account.bankAccountId,
                  label: `${account.name} · ${account.bankName} ${account.accountReferenceMasked}`,
                }))}
                collections={depositableCollections}
                locations={locationOptions}
                {...(bankStart ? { initialCollectionId: bankStart } : {})}
                money={formatMoney}
                busy={busy}
                error={null}
                onCancel={closeSheet}
                onSubmit={(value) => void sendCommand('CreateBankDeposit', { ...value })}
              />
            )
          ) : null}

          {sheet === 'confirm' && capabilities.confirmDeposit ? (
            confirmableDeposits.length === 0 ? (
              <p className="cash-sheet-note">No bank deposits are waiting to be confirmed.</p>
            ) : (
              <ConfirmDepositWizard
                deposits={confirmableDeposits}
                {...(confirmOnly ? { initialDepositId: confirmOnly } : {})}
                today={new Date().toISOString().slice(0, 10)}
                money={formatMoney}
                busy={busy}
                error={null}
                onCancel={closeSheet}
                onSubmit={(value) => void sendCommand('ConfirmBankDeposit', { ...value })}
              />
            )
          ) : null}
        </Modal>

        {!hasAnyAction ? (
          <EmptyState
            title="No cash actions available"
            message="You can view this station’s cash position but cannot record collections or deposits."
          />
        ) : null}
      </Card>

      {summary && context && showHandover ? (
        <CashHandoverSheet
          open={handoverOpen}
          onClose={() => setHandoverOpen(false)}
          context={context}
          handovers={summary.handovers}
          locations={summary.locations}
          currentMembershipId={summary.currentMembershipId}
          canSubmit={summary.capabilities.submitHandover}
          canAccept={summary.capabilities.acceptHandover}
          canResolve={summary.capabilities.resolveHandover}
          hidden={amountsHidden}
          onChanged={refresh}
        />
      ) : null}

      <Card as="section" className="panel cash-panel" aria-labelledby="cash-split-title">
        <div className="panel-heading">
          <div>
            <h2 id="cash-split-title">Cash Position</h2>
          </div>
        </div>
        {summary ? (
          <CashDonut
            slices={custodySlices}
            currency={summary.currency}
            hidden={amountsHidden}
            onSelect={setHistoryKey}
            centreValue={String(summary.collections.length)}
            centreLabel={summary.collections.length === 1 ? 'collection' : 'collections'}
          />
        ) : (
          <LoadingState label="Loading cash position" />
        )}
        <Modal
          open={historyGroup !== null}
          onClose={() => setHistoryKey(null)}
          title={historyGroup ? historyGroup.label : 'Cash'}
          presentation="page"
          backLabel="Cash & banking"
          size="md"
        >
          {historyItems.length === 0 ? (
            <EmptyState
              title="Nothing here"
              message={`No cash is under “${historyGroup?.label ?? 'this heading'}” right now.`}
            />
          ) : (
            <ul className="cash-history-list">
              {historyItems.map((collection) => (
                <li key={collection.collectionId}>
                  <div>
                    <strong>{collection.collectionReference}</strong>
                    <StatusBadge
                      tone={collection.custodyState === 'BANKED' ? 'positive' : 'pending'}
                    >
                      {custodyLabel(collection.custodyState)}
                    </StatusBadge>
                  </div>
                  <span>{plain(collection.amount)}</span>
                  <small>Still to bank {plain(collection.collectedButUnbanked)}</small>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      </Card>

      <TabbedCard
        title="Collections & Deposits"
        className="content-span"
        tabs={[
          {
            id: 'collections',
            label: 'Collections',
            aside: canBank ? <InfoTip>Select cash to bank it</InfoTip> : null,
            content: (
              <>
                {loading ? <LoadingState label="Loading cash position" /> : null}
                {error && sheet === null ? (
                  <ErrorState
                    message={error.message}
                    action={<Button onClick={() => void refresh()}>Retry</Button>}
                  />
                ) : null}
                {success ? <SuccessState message={success} /> : null}
                {summary ? (
                  <>
                    {summary.collections.length === 0 ? (
                      <EmptyState
                        title="No collections yet"
                        message={
                          hasAwaitingCollection
                            ? 'Approved cash is waiting to be collected. Collect it to see it here.'
                            : 'Cash from approved shift reports shows here once it is collected.'
                        }
                      />
                    ) : (
                      <>
                        <TableScrollRegion label="Station cash collections">
                          <table className="data-table">
                            <caption className="sr-only">Station cash collections</caption>
                            <thead>
                              <tr>
                                <th scope="col">Reference</th>
                                <th scope="col">Collected</th>
                                <th scope="col">Amount</th>
                                <th scope="col">Still to bank</th>
                                <th scope="col">Where it is</th>
                                <th scope="col">
                                  <span className="sr-only">Actions and details</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {collectionPage.rows.map((collection) => {
                                const bankable =
                                  canBank && Number(collection.availableAtStation) > 0;
                                const key = `collection-${collection.collectionId}`;
                                const open = expanded.has(key);
                                return (
                                  <Fragment key={collection.collectionId}>
                                    <tr
                                      className="row-action"
                                      data-open={open || undefined}
                                      onClick={() => toggleRow(key)}
                                    >
                                      <th scope="row">{collection.collectionReference}</th>
                                      <td data-label="Collected">
                                        {formatWhen(
                                          collection.recordedAt,
                                          summary?.stationTimezone,
                                        )}
                                      </td>
                                      <td data-label="Amount">{plain(collection.amount)}</td>
                                      <td data-label="Still to bank">
                                        {plain(collection.collectedButUnbanked)}
                                      </td>
                                      <td data-label="Where it is">
                                        <StatusBadge
                                          tone={
                                            collection.custodyState === 'BANKED'
                                              ? 'positive'
                                              : 'pending'
                                          }
                                        >
                                          {custodyLabel(collection.custodyState)}
                                        </StatusBadge>
                                      </td>
                                      <td className="cash-row-actions">
                                        {bankable ? (
                                          <Button
                                            variant="quiet"
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              openDepositFor(collection);
                                            }}
                                          >
                                            Bank it
                                          </Button>
                                        ) : null}
                                        <button
                                          type="button"
                                          className="cash-toggle"
                                          aria-expanded={open}
                                          aria-controls={`${key}-details`}
                                          aria-label={`${open ? 'Hide' : 'Show'} details for ${collection.collectionReference}`}
                                        >
                                          <Icon name="chevron-down" />
                                        </button>
                                      </td>
                                    </tr>
                                    {open ? (
                                      <tr className="row-detail">
                                        <td colSpan={6}>
                                          <DetailList
                                            id={`${key}-details`}
                                            items={[
                                              {
                                                label: 'Business date',
                                                value: formatDay(collection.businessDate),
                                              },
                                              {
                                                label: 'Collected on',
                                                value: formatWhen(
                                                  collection.recordedAt,
                                                  summary?.stationTimezone,
                                                ),
                                              },
                                              {
                                                label: 'Received at the station',
                                                value: collection.receivedAt
                                                  ? formatWhen(
                                                      collection.receivedAt,
                                                      summary?.stationTimezone,
                                                    )
                                                  : 'Not marked as received',
                                              },
                                              {
                                                label: 'Collected from',
                                                value: locationName(collection.sourceLocationId),
                                              },
                                              {
                                                label: 'Now at',
                                                value: locationName(collection.currentLocationId),
                                              },
                                              {
                                                label: 'Total collected',
                                                value: plain(collection.amount),
                                              },
                                              {
                                                label: 'Still at the station',
                                                value: plain(collection.availableAtStation),
                                              },
                                              {
                                                label: 'Waiting for the bank',
                                                value: plain(collection.pendingBankConfirmation),
                                              },
                                              {
                                                label: 'Banked (bank confirmed)',
                                                value: plain(collection.confirmedAmount),
                                              },
                                              {
                                                label: 'Counted in shift report',
                                                wide: true,
                                                value: collection.shiftReports?.length
                                                  ? collection.shiftReports.map((report) => (
                                                      <div key={report.reconciliationId}>
                                                        {formatDay(report.businessDate)} ·{' '}
                                                        {plain(report.amount)}
                                                      </div>
                                                    ))
                                                  : 'No shift report linked',
                                              },
                                              {
                                                label: 'Bank deposits',
                                                wide: true,
                                                value: collection.deposits?.length
                                                  ? collection.deposits.map((deposit) => (
                                                      <div key={deposit.depositId}>
                                                        {deposit.depositReference} ·{' '}
                                                        {plain(deposit.amount)} ·{' '}
                                                        {depositLabel(deposit)} ·{' '}
                                                        {formatWhen(
                                                          deposit.depositedAt,
                                                          summary?.stationTimezone,
                                                        )}
                                                      </div>
                                                    ))
                                                  : 'Not sent to the bank yet',
                                              },
                                            ]}
                                          />
                                        </td>
                                      </tr>
                                    ) : null}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </TableScrollRegion>
                        <Pagination
                          slice={collectionPage}
                          label="Collections pages"
                          noun="collections"
                        />
                      </>
                    )}
                  </>
                ) : null}
              </>
            ),
          },
          ...(capabilities.viewDeposits
            ? [
                {
                  id: 'deposits',
                  label: 'Bank Deposits',
                  aside: canConfirm ? <InfoTip>Select a deposit to confirm it</InfoTip> : null,
                  content: (
                    <>
                      {summary?.deposits.length ? (
                        <>
                          <TableScrollRegion label="Station bank deposits">
                            <table className="data-table">
                              <caption className="sr-only">Station bank deposits</caption>
                              <thead>
                                <tr>
                                  <th scope="col">Reference</th>
                                  <th scope="col">Deposited</th>
                                  <th scope="col">Account</th>
                                  <th scope="col">Amount</th>
                                  <th scope="col">Status</th>
                                  <th scope="col">Bank difference</th>
                                  <th scope="col">
                                    <span className="sr-only">Actions and details</span>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {depositPage.rows.map((deposit) => {
                                  const confirmable =
                                    canConfirm &&
                                    confirmableDeposits.some(
                                      (candidate) => candidate.depositId === deposit.depositId,
                                    );
                                  const key = `deposit-${deposit.depositId}`;
                                  const open = expanded.has(key);
                                  const account = summary.bankAccounts.find(
                                    (candidate) =>
                                      candidate.bankAccountId === deposit.bankAccountId,
                                  );
                                  const difference = deposit.confirmationVariance
                                    ? sumDecimals([deposit.confirmationVariance]) === '0.00'
                                      ? 'None'
                                      : plain(deposit.confirmationVariance)
                                    : '—';
                                  return (
                                    <Fragment key={deposit.depositId}>
                                      <tr
                                        className="row-action"
                                        data-open={open || undefined}
                                        onClick={() => toggleRow(key)}
                                      >
                                        <th scope="row">{deposit.depositReference}</th>
                                        <td data-label="Deposited">
                                          {formatWhen(
                                            deposit.depositedAt,
                                            summary?.stationTimezone,
                                          )}
                                        </td>
                                        <td data-label="Account">{deposit.bankAccountName}</td>
                                        <td data-label="Amount">{plain(deposit.amount)}</td>
                                        <td data-label="Status">
                                          <StatusBadge
                                            tone={
                                              deposit.state === 'CONFIRMED' ? 'positive' : 'pending'
                                            }
                                          >
                                            {depositLabel(deposit)}
                                          </StatusBadge>
                                        </td>
                                        <td data-label="Bank difference">{difference}</td>
                                        <td className="cash-row-actions">
                                          {confirmable ? (
                                            <Button
                                              variant="quiet"
                                              type="button"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                openConfirmFor(deposit.depositId);
                                              }}
                                            >
                                              Confirm
                                            </Button>
                                          ) : null}
                                          <button
                                            type="button"
                                            className="cash-toggle"
                                            aria-expanded={open}
                                            aria-controls={`${key}-details`}
                                            aria-label={`${open ? 'Hide' : 'Show'} details for ${deposit.depositReference}`}
                                          >
                                            <Icon name="chevron-down" />
                                          </button>
                                        </td>
                                      </tr>
                                      {open ? (
                                        <tr className="row-detail">
                                          <td colSpan={7}>
                                            <DetailList
                                              id={`${key}-details`}
                                              items={[
                                                {
                                                  label: 'Deposited on',
                                                  value: formatWhen(
                                                    deposit.depositedAt,
                                                    summary?.stationTimezone,
                                                  ),
                                                },
                                                {
                                                  label: 'Cash taken from',
                                                  value: locationName(deposit.sourceLocationId),
                                                },
                                                {
                                                  label: 'Bank account',
                                                  value: account
                                                    ? `${account.name} · ${account.bankName} · ${account.accountReferenceMasked}`
                                                    : deposit.bankAccountName,
                                                },
                                                {
                                                  label: 'Bank reference',
                                                  value: deposit.bankReference ?? 'Not given yet',
                                                },
                                                {
                                                  label: 'Bank expected to confirm by',
                                                  value: formatWhen(
                                                    deposit.expectedConfirmationAt,
                                                    summary?.stationTimezone,
                                                  ),
                                                },
                                                {
                                                  label: 'Confirmed on',
                                                  value: deposit.confirmedAt
                                                    ? formatWhen(
                                                        deposit.confirmedAt,
                                                        summary?.stationTimezone,
                                                      )
                                                    : 'Not confirmed yet',
                                                },
                                                {
                                                  label: 'Amount deposited',
                                                  value: plain(deposit.amount),
                                                },
                                                {
                                                  label: 'Amount the bank shows',
                                                  value: deposit.confirmedAmount
                                                    ? plain(deposit.confirmedAmount)
                                                    : 'Not confirmed yet',
                                                },
                                                { label: 'Bank difference', value: difference },
                                                {
                                                  label: 'Cash in this deposit',
                                                  wide: true,
                                                  value: deposit.collections?.length
                                                    ? deposit.collections.map((item) => (
                                                        <div key={item.collectionId}>
                                                          {item.collectionReference} ·{' '}
                                                          {plain(item.amount)}
                                                        </div>
                                                      ))
                                                    : '—',
                                                },
                                              ]}
                                            />
                                            {context?.stationId ? (
                                              <DocumentAttachments
                                                tenantId={context.organisationId}
                                                stationId={context.stationId}
                                                subjectType="BANK_DEPOSIT"
                                                subjectId={deposit.depositId}
                                                defaultKind="DEPOSIT_SLIP"
                                                title="Deposit slip and bank documents"
                                              />
                                            ) : null}
                                          </td>
                                        </tr>
                                      ) : null}
                                    </Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </TableScrollRegion>
                          <Pagination slice={depositPage} label="Deposits pages" noun="deposits" />
                        </>
                      ) : (
                        <EmptyState
                          title="No bank deposits yet"
                          message="Deposits show up here once you bank some cash."
                        />
                      )}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
