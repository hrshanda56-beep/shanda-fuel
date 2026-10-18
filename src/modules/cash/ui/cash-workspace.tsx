'use client';
import { useContextFetch } from '@/modules/context/client-context';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
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
import { Modal } from '../../../design-system/modal';
import { TableScrollRegion } from '../../../design-system/table';
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
  record: 'Record a cash collection',
  receive: 'Receive a Collection',
  deposit: 'Record a bank deposit',
  confirm: 'Confirm bank deposits',
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
    recordedAt?: string;
    receivedAt?: string | null;
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
  }>;
  capabilities: CashCapabilities;
};

type RequestFailure = Error & { status?: number; conflict?: boolean };

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
  return failure;
}

function displayState(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

type SummaryCollection = CashSummary['collections'][number];

/** The four cash positions, each drawn as a slice: blue at station, purple unbanked, yellow pending, green banked. */
const POSITIONS: ReadonlyArray<{
  key: string;
  label: string;
  tone: number;
  includes: (collection: SummaryCollection) => boolean;
}> = [
  {
    key: 'at-station',
    label: 'Cash at station',
    tone: 1,
    includes: (c) => isPositive(c.availableAtStation),
  },
  {
    key: 'unbanked',
    label: 'Collected, not banked',
    tone: 3,
    includes: (c) => isPositive(c.collectedButUnbanked),
  },
  {
    key: 'pending',
    label: 'Awaiting bank confirmation',
    tone: 2,
    includes: (c) => isPositive(c.pendingBankConfirmation),
  },
  { key: 'banked', label: 'Banked', tone: 0, includes: (c) => isPositive(c.confirmedAmount) },
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
  const [receiveCollectionId, setReceiveCollectionId] = useState('');
  const [depositRows, setDepositRows] = useState([{ collectionId: '', amount: '' }]);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [amountsHidden, setAmountsHidden] = useState(false);
  const [sheet, setSheet] = useState<CashSheet | null>(null);
  const [sheetDirty, setSheetDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
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
      setSuccess(`${displayState(commandType)} recorded.`);
      form.reset();
      if (commandType === 'CreateBankDeposit') setDepositRows([{ collectionId: '', amount: '' }]);
      setSheet(null);
      setSheetDirty(false);
      setConfirmDiscard(false);
      await refresh();
    } catch (cause) {
      const failure = cause as RequestFailure;
      if (failure.conflict)
        failure.message = `${failure.message} Refresh the station position before retrying.`;
      setError(failure);
    } finally {
      setBusy(false);
    }
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
    label: `${collection.collectionReference} · ${collection.availableAtStation} USD available`,
  }));

  const collectionsList = summary?.collections ?? [];
  const positionTotals: Record<string, string> = {
    'at-station': summary?.totals.availableAtStation ?? '0',
    unbanked: summary?.totals.collectedButUnbanked ?? '0',
    pending: summary?.totals.pendingBankConfirmation ?? '0',
    banked: sumDecimals(collectionsList.map((collection) => collection.confirmedAmount)),
  };
  const custodySlices: DonutSlice[] = POSITIONS.map((position) => ({
    key: position.key,
    label: position.label,
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
    setSheet(next);
  }

  function closeSheet() {
    setSheet(null);
    setSheetDirty(false);
    setConfirmDiscard(false);
    setDepositRows([{ collectionId: '', amount: '' }]);
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
      label: 'New Collection',
      shortLabel: 'New Collection',
      available: capabilities.recordCollection,
    },
    {
      key: 'receive',
      label: 'Receive a Collection',
      shortLabel: 'Receive Collection',
      available: capabilities.receiveCollection,
    },
    {
      key: 'deposit',
      label: 'New Bank Deposit',
      shortLabel: 'New Deposit',
      available: capabilities.recordDeposit,
    },
    {
      key: 'confirm',
      label: `Confirm Deposits (${confirmableDeposits.length})`,
      shortLabel: `Confirm Deposits (${confirmableDeposits.length})`,
      available: capabilities.confirmDeposit && confirmableDeposits.length > 0,
    },
  ];

  const plain = (value: string) => (amountsHidden ? `${MASK} USD` : `${value} USD`);

  return (
    <div className="content-grid cash-workspace">
      <Card as="section" className="panel cash-panel" aria-labelledby="cash-actions-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Cash custody</p>
            <h2 id="cash-actions-title">Move/ Bank Cash</h2>
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
                variant={action.key === 'record' ? 'primary' : 'secondary'}
                aria-haspopup="dialog"
                onClick={() => openSheet(action.key)}
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
              message={error.message}
              action={<Button onClick={() => void refresh()}>Refresh</Button>}
            />
          ) : null}
          <div
            className="cash-sheet-forms"
            onInput={() => setSheetDirty(true)}
            onChange={() => setSheetDirty(true)}
          >
            {sheet === 'record' && capabilities.recordCollection ? (
              <form className="form-stack" onSubmit={(event) => void postCommand(event)}>
                <input type="hidden" name="commandType" value="RecordCashCollection" />
                <Field id="collection-reference" label="Collection reference" required>
                  <input id="collection-reference" name="collectionReference" />
                </Field>
                <Field
                  id="reconciliation-id"
                  label="Approved reconciliation cash evidence"
                  hint="Only cash from approved reconciliations can be collected."
                  required
                >
                  <Select
                    id="reconciliation-id"
                    name="reconciliationId"
                    options={recordableSources.map((source) => ({
                      value: source.reconciliationId,
                      label: `${source.businessDate} · ${source.availableCash} USD available`,
                    }))}
                    placeholder="Choose approved cash evidence"
                    disabled={recordableSources.length === 0}
                  />
                </Field>
                <Field id="source-location-id" label="Source cash location" required>
                  <Select
                    id="source-location-id"
                    name="sourceLocationId"
                    options={locationOptions}
                    placeholder="Choose a station location"
                    disabled={locationOptions.length === 0}
                  />
                </Field>
                <NumericInput
                  id="collection-amount"
                  name="amount"
                  label="Collected amount"
                  unit="USD"
                  required
                />
                <Button type="submit" loading={busy} disabled={recordableSources.length === 0}>
                  Record collection
                </Button>
              </form>
            ) : null}

            {sheet === 'receive' && capabilities.receiveCollection ? (
              <form
                className="form-stack form-section"
                onSubmit={(event) => void postCommand(event)}
              >
                <input type="hidden" name="commandType" value="ReceiveCashCollection" />
                <Field
                  id="receive-collection-id"
                  label="Recorded collection"
                  hint="Choose the collection that has arrived at this location."
                  required
                >
                  <Select
                    id="receive-collection-id"
                    name="collectionId"
                    value={receiveCollectionId}
                    onChange={(event) => setReceiveCollectionId(event.currentTarget.value)}
                    options={receiveableCollections.map((collection) => ({
                      value: collection.collectionId,
                      label: `${collection.collectionReference} · ${collection.amount} USD`,
                    }))}
                    placeholder="Choose a recorded collection"
                    disabled={receiveableCollections.length === 0}
                  />
                </Field>
                <Field id="receive-location-id" label="Receiving cash location" required>
                  <Select
                    id="receive-location-id"
                    name="targetLocationId"
                    options={locationOptions}
                    placeholder="Choose a different location"
                    disabled={locationOptions.length < 2}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="secondary"
                  loading={busy}
                  disabled={receiveableCollections.length === 0}
                >
                  Receive collection
                </Button>
              </form>
            ) : null}

            {sheet === 'deposit' && capabilities.recordDeposit ? (
              <form
                className="form-stack form-section"
                onSubmit={(event) => void postCommand(event)}
              >
                <input type="hidden" name="commandType" value="CreateBankDeposit" />
                <Field id="bank-account-id" label="USD bank account" required>
                  <Select
                    id="bank-account-id"
                    name="bankAccountId"
                    options={
                      summary?.bankAccounts.map((account) => ({
                        value: account.bankAccountId,
                        label: `${account.name} · ${account.bankName} ${account.accountReferenceMasked}`,
                      })) ?? []
                    }
                    placeholder="Choose an active legal-entity account"
                    disabled={!summary?.bankAccounts.length}
                  />
                </Field>
                <Field id="deposit-location-id" label="Deposit source location" required>
                  <Select
                    id="deposit-location-id"
                    name="sourceLocationId"
                    options={locationOptions}
                    placeholder="Choose the location handing over cash"
                    disabled={locationOptions.length === 0}
                  />
                </Field>
                <Field id="deposit-reference" label="Deposit reference" required>
                  <input id="deposit-reference" name="depositReference" />
                </Field>
                <div className="form-stack">
                  <div className="panel-heading">
                    <div>
                      <h3>Collection allocations</h3>
                      <p className="field-hint">
                        Allocate exact decimal amounts from collections available at the source
                        location.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() =>
                        setDepositRows((rows) => [...rows, { collectionId: '', amount: '' }])
                      }
                      disabled={depositableCollections.length === 0}
                    >
                      Add allocation
                    </Button>
                  </div>
                  {depositRows.map((row, index) => (
                    <div className="form-grid" key={`${index}-${row.collectionId}`}>
                      <Field
                        id={`allocation-collection-${index}`}
                        label={`Collection ${index + 1}`}
                        required
                      >
                        <Select
                          id={`allocation-collection-${index}`}
                          name="allocationCollectionId"
                          options={collectionOptions}
                          placeholder="Choose a collection"
                          defaultValue={row.collectionId}
                          disabled={depositableCollections.length === 0}
                        />
                      </Field>
                      <NumericInput
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
                              rows.filter((_, rowIndex) => rowIndex !== index),
                            )
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  loading={busy}
                  disabled={!summary?.bankAccounts.length || depositableCollections.length === 0}
                >
                  Record bank deposit
                </Button>
              </form>
            ) : null}

            {sheet === 'confirm' &&
            capabilities.confirmDeposit &&
            confirmableDeposits.length > 0 ? (
              <div className="form-section">
                <div className="panel-heading">
                  <div>
                    <h3>Confirm bank deposit</h3>
                    <p className="field-hint">
                      Confirm each deposit against the bank statement. You may be asked to sign in
                      again.
                    </p>
                  </div>
                </div>
                {confirmableDeposits.map((deposit) => (
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
                        {optionLabel(deposit.bankAccountName, 'Bank account')} ·{' '}
                        {displayState(deposit.state)}
                      </span>
                    </Field>
                    <NumericInput
                      id={`confirmed-amount-${deposit.depositId}`}
                      name="confirmedAmount"
                      label="Confirmed amount"
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
            ) : null}
          </div>
        </Modal>

        {!capabilities.recordCollection &&
        !capabilities.receiveCollection &&
        !capabilities.recordDeposit &&
        !capabilities.confirmDeposit ? (
          <EmptyState
            title="No cash actions available"
            message="You can view this station’s cash position but cannot record collections or deposits."
          />
        ) : null}
      </Card>

      <Card as="section" className="panel cash-panel" aria-labelledby="cash-split-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Overview</p>
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
          title={historyGroup ? `${historyGroup.label} history` : 'History'}
          presentation="side"
        >
          <ul className="cash-history-list">
            {historyItems.map((collection) => (
              <li key={collection.collectionId}>
                <div>
                  <strong>{collection.collectionReference}</strong>
                  <StatusBadge tone={collection.custodyState === 'BANKED' ? 'positive' : 'pending'}>
                    {displayState(collection.custodyState)}
                  </StatusBadge>
                </div>
                <span>{plain(collection.amount)}</span>
                <small>Unbanked {plain(collection.collectedButUnbanked)}</small>
              </li>
            ))}
          </ul>
        </Modal>
      </Card>

      <Card as="section" className="panel content-span" aria-labelledby="cash-position-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Cash custody</p>
            <h2 id="cash-position-title">Collections</h2>
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
                message="Approved collections show up here."
                action={
                  capabilities.recordCollection ? (
                    <Button
                      variant="secondary"
                      aria-haspopup="dialog"
                      onClick={() => openSheet('record')}
                    >
                      New Collection
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <TableScrollRegion label="Station cash collections">
                <table className="data-table">
                  <caption className="sr-only">Station cash collections</caption>
                  <thead>
                    <tr>
                      <th scope="col">Reference</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Unbanked</th>
                      <th scope="col">Custody</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.collections.map((collection) => (
                      <tr key={collection.collectionId}>
                        <th scope="row">{collection.collectionReference}</th>
                        <td data-label="Amount">{plain(collection.amount)}</td>
                        <td data-label="Unbanked">{plain(collection.collectedButUnbanked)}</td>
                        <td data-label="Custody">
                          <StatusBadge
                            tone={collection.custodyState === 'BANKED' ? 'positive' : 'pending'}
                          >
                            {displayState(collection.custodyState)}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
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
            <div>
              <p className="eyebrow">Banking</p>
              <h2 id="deposit-list-title">Bank Deposits</h2>
            </div>
          </div>
          {summary?.deposits.length ? (
            <TableScrollRegion label="Station bank deposits">
              <table className="data-table">
                <caption className="sr-only">Station bank deposits</caption>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Account</th>
                    <th scope="col">Amount</th>
                    <th scope="col">State</th>
                    <th scope="col">Confirmation variance</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.deposits.map((deposit) => (
                    <tr key={deposit.depositId}>
                      <th scope="row">{deposit.depositReference}</th>
                      <td data-label="Account">{deposit.bankAccountName}</td>
                      <td data-label="Amount">{plain(deposit.amount)}</td>
                      <td data-label="State">
                        <StatusBadge tone={deposit.state === 'CONFIRMED' ? 'positive' : 'pending'}>
                          {displayState(deposit.state)}
                        </StatusBadge>
                      </td>
                      <td data-label="Confirmation variance">
                        {deposit.confirmationVariance
                          ? plain(deposit.confirmationVariance)
                          : 'Pending'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
          ) : (
            <EmptyState
              title="No bank deposits yet"
              message="Deposits show up here once recorded."
              action={
                capabilities.recordDeposit ? (
                  <Button
                    variant="secondary"
                    aria-haspopup="dialog"
                    onClick={() => openSheet('deposit')}
                  >
                    New Bank Deposit
                  </Button>
                ) : undefined
              }
            />
          )}
        </Card>
      ) : null}
    </div>
  );
}
