'use client';
import { useContextFetch } from '@/modules/context/client-context';

import { usePathname, useSearchParams } from 'next/navigation';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { type ContextResolution, type ContextSelection } from '@/modules/context';
import { Select } from '../../../design-system/forms';
import {
  Button,
  Card,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  NumericInput,
  StatusBadge,
  SuccessState,
} from '../../../design-system/primitives';
import { Icon } from '../../../design-system/icons';
import { Modal } from '../../../design-system/modal';
import { TableScrollRegion } from '../../../design-system/table';
import { formatTileMoney } from '../../reporting/format';
import { CashDonut, CashWallet, MASK, sumDecimals, type DonutSlice } from './cash-visuals';

type CashCapabilities = {
  viewDeposits: boolean;
  recordCollection: boolean;
  receiveCollection: boolean;
  recordDeposit: boolean;
  confirmDeposit: boolean;
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

/** Where a collection is, in plain words. */
const CUSTODY_LABELS: Readonly<Record<string, string>> = {
  AT_STATION: 'At the station',
  RECEIVED: 'At the station',
  PARTIALLY_DEPOSITED: 'Part sent to bank',
  IN_TRANSIT: 'Sent to bank',
  BANKED: 'Banked',
};

/** A bank deposit's status, in plain words. */
const DEPOSIT_LABELS: Readonly<Record<string, string>> = {
  RECORDED: 'Waiting for bank',
  SUBMITTED: 'Waiting for bank',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
  REVERSED: 'Reversed',
};

export type CashSummary = {
  stationId: string;
  currency: string;
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
    confirmedAmount: string;
    availableAtStation: string;
    collectedButUnbanked: string;
    pendingBankConfirmation: string;
    state: string;
    custodyState: string;
    sourceLocationId: string;
    currentLocationId: string;
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
  capabilities: CashCapabilities;
};

type RequestFailure = Error & {
  status?: number;
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
};

function normalizeSummary(value: CashSummary): CashSummary {
  return {
    ...value,
    locations: value.locations ?? [],
    reconciliationSources: value.reconciliationSources ?? [],
    bankAccounts: value.bankAccounts ?? [],
    deposits: value.deposits ?? [],
    capabilities: value.capabilities ?? emptyCapabilities,
  };
}

function requestFailure(response: Response, result: unknown, fallback: string): RequestFailure {
  const message =
    typeof result === 'object' && result !== null && 'message' in result
      ? String((result as { message?: unknown }).message ?? fallback)
      : fallback;
  const failure = new Error(message) as RequestFailure;
  failure.status = response.status;
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

// Fixed to the station's timezone so the server and browser always print the same text.
const STATION_TIME_ZONE = 'Africa/Harare';

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: STATION_TIME_ZONE,
  }).format(new Date(value));
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
 * Where the collected cash is. The three parts never overlap, so they add up to
 * everything collected: blue at the station, yellow waiting for the bank, green banked.
 */
const POSITIONS: ReadonlyArray<{
  key: string;
  label: string;
  detail: string;
  tone: number;
  includes: (collection: SummaryCollection) => boolean;
}> = [
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

const FIRST_ROW_ID = 0;

function freshRows(collectionId = '', amount = '') {
  return [{ id: FIRST_ROW_ID, collectionId, amount }];
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
  const [receiveCollectionId, setReceiveCollectionId] = useState('');
  const [depositRows, setDepositRows] = useState([{ id: 0, collectionId: '', amount: '' }]);
  const [recordPick, setRecordPick] = useState({ id: '', amount: '' });
  const [confirmOnly, setConfirmOnly] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [amountsHidden, setAmountsHidden] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<CashSheet | null>(null);
  const [sheetDirty, setSheetDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const intentKeys = useRef(new Map<string, string>());
  /** Where the cash being banked is; it follows the cash picked, so it is never a silent default. */
  const [depositFrom, setDepositFrom] = useState('');
  const [lastForm, setLastForm] = useState<HTMLFormElement | null>(null);

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
    setReceiveCollectionId('');
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

  async function postCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context) return;
    const form = event.currentTarget;
    setLastForm(form);
    const data = new FormData(form);
    const commandType = String(data.get('commandType'));
    const payload: Record<string, unknown> = { commandType, context };
    for (const [key, value] of data.entries()) {
      if (key === 'commandType' || key === 'allocationCollectionId' || key === 'allocationAmount') {
        continue;
      }
      if (value !== '') payload[key] = String(value);
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
    if (commandType === 'ReceiveCashCollection') {
      const collection = summary?.collections.find(
        (candidate) => candidate.collectionId === String(data.get('collectionId')),
      );
      payload.expectedVersion = collection?.version ?? -1;
    }
    if (commandType === 'CreateBankDeposit') {
      const collectionIds = data.getAll('allocationCollectionId').map(String);
      const amounts = data.getAll('allocationAmount').map(String);
      payload.allocations = collectionIds
        .map((collectionId, index) => ({ collectionId, amount: amounts[index] ?? '' }))
        .filter((allocation) => allocation.collectionId && allocation.amount);
    }
    if (commandType === 'ConfirmBankDeposit') {
      const deposit = summary?.deposits.find(
        (candidate) => candidate.depositId === String(data.get('depositId')),
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
      form.reset();
      if (commandType === 'CreateBankDeposit') setDepositRows(freshRows());
      setSheet(null);
      setSheetDirty(false);
      setConfirmDiscard(false);
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
        message: `Please check “${target.label}”.`,
        action: (
          <Button
            onClick={() => {
              const control = lastForm?.elements.namedItem(target.name);
              if (control instanceof HTMLElement) {
                control.scrollIntoView({ block: 'center' });
                control.focus();
              }
            }}
          >
            Go to {target.label}
          </Button>
        ),
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
      return { message: 'Some of the details are not right. Please check the form and try again.' };
    }
    return {
      message: 'We could not save this. Nothing was changed, and what you typed is still here.',
      action: <Button onClick={() => lastForm?.requestSubmit()}>Try again</Button>,
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
    setSheetDirty(false);
    setConfirmDiscard(false);
    setConfirmOnly(null);
    setRecordPick({ id: '', amount: '' });
    setDepositRows(freshRows());
    setDepositFrom('');
    setSheet(next);
  }

  /** Opens the bank sheet with this collection chosen and its full amount filled in. */
  function openDepositFor(collection?: SummaryCollection) {
    openSheet('deposit');
    if (collection) {
      setDepositRows(freshRows(collection.collectionId, collection.availableAtStation));
      setDepositFrom(collection.currentLocationId);
    }
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
    setSheetDirty(false);
    setConfirmDiscard(false);
    setConfirmOnly(null);
    setDepositRows(freshRows());
  }

  function requestCloseSheet() {
    if (busy) return;
    if (sheetDirty) setConfirmDiscard(true);
    else closeSheet();
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
  const plain = (value: string) => (amountsHidden ? `${MASK} USD` : `${value} USD`);

  const canBank =
    capabilities.recordDeposit &&
    depositableCollections.length > 0 &&
    !!summary?.bankAccounts.length;
  const canConfirm = capabilities.confirmDeposit && confirmableDeposits.length > 0;
  const canCollect = capabilities.recordCollection && recordableSources.length > 0;
  const hasAnyAction =
    capabilities.recordCollection ||
    capabilities.receiveCollection ||
    capabilities.recordDeposit ||
    capabilities.confirmDeposit;

  /** One plain sentence saying what to do next, with a button that starts it. */
  const nextStep: { text: string; label?: string; run?: () => void } | null =
    !summary || !hasAnyAction
      ? null
      : canConfirm
        ? {
            text:
              confirmableDeposits.length === 1
                ? '1 bank deposit is waiting. Check it against your bank statement.'
                : `${confirmableDeposits.length} bank deposits are waiting. Check them against your bank statement.`,
            label: 'Confirm deposits',
            run: () => openSheet('confirm'),
          }
        : canBank
          ? {
              text: `${amountsHidden ? `${summary.currency} ${MASK}` : formatTileMoney(summary.totals.availableAtStation, summary.currency)} is at the station and not banked yet.`,
              label: 'Bank cash',
              run: openDepositSheet,
            }
          : canCollect
            ? {
                text: 'Approved shift cash is ready to collect.',
                label: 'Collect cash',
                run: () => openSheet('record'),
              }
            : {
                text:
                  summary.collections.length === 0
                    ? 'Nothing to do yet. Cash shows up here once a shift report is approved.'
                    : 'All caught up. Nothing needs doing right now.',
              };

  return (
    <div className="content-grid cash-workspace">
      {nextStep ? (
        <div className="content-span cash-next" role="status">
          <p>{nextStep.text}</p>
          {nextStep.run ? (
            <Button aria-haspopup="dialog" onClick={nextStep.run}>
              {nextStep.label}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Card as="section" className="panel cash-panel" aria-labelledby="cash-actions-title">
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
        </div>

        <Modal
          open={sheet !== null}
          onClose={requestCloseSheet}
          title={sheet ? SHEET_TITLES[sheet] : 'Cash action'}
          presentation="side"
          dismissible={!busy}
          className="cash-sheet"
        >
          {confirmDiscard ? (
            <div className="cash-discard" role="alert">
              <p>Discard what you have entered?</p>
              <div className="form-actions">
                <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </Button>
                <Button variant="danger" onClick={closeSheet}>
                  Discard
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <ErrorState
              title="This could not be saved"
              message={failureHelp(error).message}
              action={failureHelp(error).action}
            />
          ) : null}
          <div
            className="cash-sheet-forms"
            onInput={() => setSheetDirty(true)}
            onChange={() => setSheetDirty(true)}
          >
            {sheet === 'record' && capabilities.recordCollection ? (
              recordableSources.length === 0 || locationOptions.length === 0 ? (
                <p className="cash-sheet-note">
                  {recordableSources.length === 0
                    ? 'There is no approved shift cash to collect yet. It shows up here once a shift report is approved.'
                    : 'This station has no cash locations set up yet. Ask an administrator to add one.'}
                </p>
              ) : (
                <form className="form-stack" onSubmit={(event) => void postCommand(event)}>
                  <input type="hidden" name="commandType" value="RecordCashCollection" />
                  <p className="cash-sheet-intro">
                    Record the cash you collected from an approved shift.
                  </p>
                  <Field id="reconciliation-id" label="Shift cash" required>
                    <Select
                      id="reconciliation-id"
                      name="reconciliationId"
                      options={recordableSources.map((source) => ({
                        value: source.reconciliationId,
                        label: `${source.businessDate} · USD ${source.availableCash} available`,
                      }))}
                      placeholder="Choose a shift"
                      onChange={(event) => {
                        const source = recordableSources.find(
                          (candidate) => candidate.reconciliationId === event.currentTarget.value,
                        );
                        setRecordPick({
                          id: event.currentTarget.value,
                          amount: source?.availableCash ?? '',
                        });
                      }}
                    />
                  </Field>
                  <Field id="source-location-id" label="Where the cash is" required>
                    <Select
                      id="source-location-id"
                      name="sourceLocationId"
                      options={locationOptions}
                      placeholder="Choose a location"
                    />
                  </Field>
                  <NumericInput
                    key={recordPick.id}
                    id="collection-amount"
                    name="amount"
                    label="Amount"
                    unit="USD"
                    defaultValue={recordPick.amount}
                    required
                  />
                  <Field id="collection-reference" label="Reference" required>
                    <input id="collection-reference" name="collectionReference" />
                  </Field>
                  <Button type="submit" loading={busy}>
                    Collect cash
                  </Button>
                </form>
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
                <form
                  className="form-stack form-section"
                  onSubmit={(event) => void postCommand(event)}
                >
                  <input type="hidden" name="commandType" value="ReceiveCashCollection" />
                  <p className="cash-sheet-intro">
                    Confirm that cash handed over from another location has arrived.
                  </p>
                  <Field id="receive-collection-id" label="Cash to receive" required>
                    <Select
                      id="receive-collection-id"
                      name="collectionId"
                      value={receiveCollectionId}
                      onChange={(event) => setReceiveCollectionId(event.currentTarget.value)}
                      options={receiveableCollections.map((collection) => ({
                        value: collection.collectionId,
                        label: `${collection.collectionReference} · USD ${collection.amount}`,
                      }))}
                      placeholder="Choose cash"
                    />
                  </Field>
                  <Field id="receive-location-id" label="Receiving location" required>
                    <Select
                      id="receive-location-id"
                      name="targetLocationId"
                      options={locationOptions}
                      placeholder="Choose where it arrived"
                    />
                  </Field>
                  <Button type="submit" variant="secondary" loading={busy}>
                    Receive cash
                  </Button>
                </form>
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
                <form
                  className="form-stack form-section"
                  onSubmit={(event) => void postCommand(event)}
                >
                  <input type="hidden" name="commandType" value="CreateBankDeposit" />
                  <p className="cash-sheet-intro">Record the cash you are taking to the bank.</p>
                  <Field id="bank-account-id" label="Bank account" required>
                    <Select
                      id="bank-account-id"
                      name="bankAccountId"
                      options={summary.bankAccounts.map((account) => ({
                        value: account.bankAccountId,
                        label: `${account.name} · ${account.bankName} ${account.accountReferenceMasked}`,
                      }))}
                      placeholder="Choose an account"
                    />
                  </Field>
                  <Field id="deposit-location-id" label="Taking the cash from" required>
                    <Select
                      key={`deposit-from-${depositFrom}`}
                      id="deposit-location-id"
                      name="sourceLocationId"
                      options={locationOptions}
                      placeholder="Choose a location"
                      defaultValue={depositFrom}
                      onChange={(event) => setDepositFrom(event.currentTarget.value)}
                    />
                  </Field>
                  <div className="form-stack">
                    <div className="cash-allocations-head">
                      <h3>Cash to bank</h3>
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() =>
                          setDepositRows((rows) => [
                            ...rows,
                            {
                              id: Math.max(...rows.map((row) => row.id)) + 1,
                              collectionId: '',
                              amount: '',
                            },
                          ])
                        }
                      >
                        Add more cash
                      </Button>
                    </div>
                    {depositRows.map((row, index) => (
                      <div className="form-grid" key={row.id}>
                        <Field
                          id={`allocation-collection-${index}`}
                          label={depositRows.length > 1 ? `Cash ${index + 1}` : 'Cash'}
                          required
                        >
                          <Select
                            id={`allocation-collection-${index}`}
                            name="allocationCollectionId"
                            options={collectionOptions}
                            placeholder="Choose cash"
                            defaultValue={row.collectionId}
                            onChange={(event) => {
                              const picked = depositableCollections.find(
                                (collection) =>
                                  collection.collectionId === event.currentTarget.value,
                              );
                              if (index === 0 && picked) setDepositFrom(picked.currentLocationId);
                              setDepositRows((rows) =>
                                rows.map((candidate) =>
                                  candidate.id === row.id
                                    ? {
                                        ...candidate,
                                        collectionId: event.currentTarget.value,
                                        amount: picked?.availableAtStation ?? '',
                                      }
                                    : candidate,
                                ),
                              );
                            }}
                          />
                        </Field>
                        <NumericInput
                          key={`${row.id}-${row.collectionId}`}
                          id={`allocation-amount-${index}`}
                          name="allocationAmount"
                          label="Amount"
                          unit="USD"
                          defaultValue={row.amount}
                          required
                        />
                        {depositRows.length > 1 ? (
                          <Button
                            type="button"
                            variant="quiet"
                            onClick={() =>
                              setDepositRows((rows) =>
                                rows.filter((candidate) => candidate.id !== row.id),
                              )
                            }
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <Field
                    id="deposit-reference"
                    label="Deposit reference"
                    hint="The bank or deposit reference, for example from the deposit slip."
                    required
                  >
                    <input id="deposit-reference" name="depositReference" />
                  </Field>
                  <Button type="submit" variant="secondary" loading={busy}>
                    Bank cash
                  </Button>
                </form>
              )
            ) : null}

            {sheet === 'confirm' && capabilities.confirmDeposit ? (
              confirmableDeposits.length === 0 ? (
                <p className="cash-sheet-note">No bank deposits are waiting to be confirmed.</p>
              ) : (
                <div className="form-section">
                  <p className="cash-sheet-intro">Match each deposit to your bank statement.</p>
                  {confirmableDeposits
                    .filter((deposit) => !confirmOnly || deposit.depositId === confirmOnly)
                    .map((deposit) => (
                      <form
                        className="form-stack"
                        key={deposit.depositId}
                        onSubmit={(event) => void postCommand(event)}
                      >
                        <input type="hidden" name="commandType" value="ConfirmBankDeposit" />
                        <input type="hidden" name="depositId" value={deposit.depositId} />
                        <Field
                          id={`confirm-deposit-${deposit.depositId}`}
                          label={deposit.depositReference}
                        >
                          <span className="field-hint">
                            {deposit.amount} USD ·{' '}
                            {optionLabel(deposit.bankAccountName, 'Bank account')}
                          </span>
                        </Field>
                        <NumericInput
                          id={`confirmed-amount-${deposit.depositId}`}
                          name="confirmedAmount"
                          label="Amount the bank shows"
                          unit="USD"
                          defaultValue={deposit.amount}
                          required
                        />
                        <Field
                          id={`bank-reference-${deposit.depositId}`}
                          label="Bank reference"
                          required
                        >
                          <input id={`bank-reference-${deposit.depositId}`} name="bankReference" />
                        </Field>
                        <Button type="submit" variant="secondary" loading={busy}>
                          Confirm deposit
                        </Button>
                      </form>
                    ))}
                </div>
              )
            ) : null}
          </div>
        </Modal>

        {!hasAnyAction ? (
          <EmptyState
            title="No cash actions available"
            message="You can view this station’s cash position but cannot record collections or deposits."
          />
        ) : null}
      </Card>

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
          presentation="side"
        >
          <ul className="cash-history-list">
            {historyItems.map((collection) => (
              <li key={collection.collectionId}>
                <div>
                  <strong>{collection.collectionReference}</strong>
                  <StatusBadge tone={collection.custodyState === 'BANKED' ? 'positive' : 'pending'}>
                    {CUSTODY_LABELS[collection.custodyState] ??
                      displayState(collection.custodyState)}
                  </StatusBadge>
                </div>
                <span>{plain(collection.amount)}</span>
                <small>Still to bank {plain(collection.collectedButUnbanked)}</small>
              </li>
            ))}
          </ul>
        </Modal>
      </Card>

      <Card as="section" className="panel content-span" aria-labelledby="cash-position-title">
        <div className="panel-heading">
          <div className="heading-inline">
            <h2 id="cash-position-title">Collections</h2>
            {canBank ? <span className="heading-hint">Select cash to bank it</span> : null}
          </div>
        </div>
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
                message="Cash from approved shift reports shows here."
              />
            ) : (
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
                    {summary.collections.map((collection) => {
                      const bankable = canBank && Number(collection.availableAtStation) > 0;
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
                            <td data-label="Collected">{formatWhen(collection.recordedAt)}</td>
                            <td data-label="Amount">{plain(collection.amount)}</td>
                            <td data-label="Still to bank">
                              {plain(collection.collectedButUnbanked)}
                            </td>
                            <td data-label="Where it is">
                              <StatusBadge
                                tone={collection.custodyState === 'BANKED' ? 'positive' : 'pending'}
                              >
                                {CUSTODY_LABELS[collection.custodyState] ??
                                  displayState(collection.custodyState)}
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
                                      value: formatWhen(collection.recordedAt),
                                    },
                                    {
                                      label: 'Received at the station',
                                      value: collection.receivedAt
                                        ? formatWhen(collection.receivedAt)
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
                                    { label: 'Total collected', value: plain(collection.amount) },
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
                                              {deposit.depositReference} · {plain(deposit.amount)} ·{' '}
                                              {DEPOSIT_LABELS[deposit.state] ??
                                                displayState(deposit.state)}{' '}
                                              · {formatWhen(deposit.depositedAt)}
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
            )}
          </>
        ) : null}
      </Card>

      {capabilities.viewDeposits ? (
        <Card as="section" className="panel content-span" aria-labelledby="deposit-list-title">
          <div className="panel-heading">
            <div className="heading-inline">
              <h2 id="deposit-list-title">Bank Deposits</h2>
              {canConfirm ? (
                <span className="heading-hint">Select a deposit to confirm it</span>
              ) : null}
            </div>
          </div>
          {summary?.deposits.length ? (
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
                  {summary.deposits.map((deposit) => {
                    const confirmable =
                      canConfirm &&
                      confirmableDeposits.some(
                        (candidate) => candidate.depositId === deposit.depositId,
                      );
                    const key = `deposit-${deposit.depositId}`;
                    const open = expanded.has(key);
                    const account = summary.bankAccounts.find(
                      (candidate) => candidate.bankAccountId === deposit.bankAccountId,
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
                          <td data-label="Deposited">{formatWhen(deposit.depositedAt)}</td>
                          <td data-label="Account">{deposit.bankAccountName}</td>
                          <td data-label="Amount">{plain(deposit.amount)}</td>
                          <td data-label="Status">
                            <StatusBadge
                              tone={deposit.state === 'CONFIRMED' ? 'positive' : 'pending'}
                            >
                              {DEPOSIT_LABELS[deposit.state] ?? displayState(deposit.state)}
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
                                  { label: 'Deposited on', value: formatWhen(deposit.depositedAt) },
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
                                    value: formatWhen(deposit.expectedConfirmationAt),
                                  },
                                  {
                                    label: 'Confirmed on',
                                    value: deposit.confirmedAt
                                      ? formatWhen(deposit.confirmedAt)
                                      : 'Not confirmed yet',
                                  },
                                  { label: 'Amount deposited', value: plain(deposit.amount) },
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
                                            {item.collectionReference} · {plain(item.amount)}
                                          </div>
                                        ))
                                      : '—',
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
          ) : (
            <EmptyState
              title="No bank deposits yet"
              message="Deposits show up here once you bank some cash."
            />
          )}
        </Card>
      ) : null}
    </div>
  );
}
