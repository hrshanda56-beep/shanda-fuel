'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ContextResolution, ContextSelection } from '@/modules/context';
import { Select } from '../../../design-system/forms';
import { formatBusinessDate, formatMoneyDisplay } from '../../../design-system/formatters';
import { Section } from '../../../design-system/layout';
import {
  ActionSheet,
  KpiGrid,
  KpiTile,
  RefreshButton,
  SkeletonCard,
  SkeletonTiles,
} from '../../../design-system/page-kit';
import {
  Button,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  Field,
  NumericInput,
  Skeleton,
  StatusBadge,
  SuccessState,
} from '../../../design-system/primitives';
import { TableScrollRegion } from '../../../design-system/table';

type CashCapabilities = {
  viewDeposits: boolean;
  recordCollection: boolean;
  receiveCollection: boolean;
  recordDeposit: boolean;
  confirmDeposit: boolean;
};

type CashSummary = {
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
type CashSheet = 'collect' | 'receive' | 'deposit' | 'confirm' | null;

const COMMAND_SUCCESS: Record<string, string> = {
  RecordCashCollection: 'Collection recorded.',
  ReceiveCashCollection: 'Collection received.',
  CreateBankDeposit: 'Deposit recorded.',
  ConfirmBankDeposit: 'Deposit confirmed.',
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
  return failure;
}

function displayState(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function optionLabel(value: string, fallback: string): string {
  return value || fallback;
}

export function CashWorkspace() {
  const pathname = usePathname() ?? '/stations/unknown/cash';
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const routeKey = `${pathname}?${search}`;
  const [context, setContext] = useState<ContextSelection | null>(null);
  const [contextStatus, setContextStatus] = useState<'loading' | 'ready' | 'required' | 'error'>(
    'loading',
  );
  const [contextError, setContextError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadedRouteKey, setLoadedRouteKey] = useState<string | null>(null);
  const [receiveCollectionId, setReceiveCollectionId] = useState('');
  const [depositRows, setDepositRows] = useState([{ collectionId: '', amount: '' }]);
  const [sheet, setSheet] = useState<CashSheet>(null);
  const intentKeys = useRef(new Map<string, string>());

  const loadContext = useCallback(
    async (signal?: AbortSignal): Promise<ContextSelection | null> => {
      const params = new URLSearchParams(search);
      params.set('pathname', pathname);
      const response = await fetch(`/api/context?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const result = (await response.json()) as { data?: ContextResolution; message?: string };
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) return null;
        throw requestFailure(response, result, 'The station could not be loaded');
      }
      const current = result.data?.current;
      if (!current?.stationId || current.allStations) return null;
      return current;
    },
    [pathname, search],
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
    if (!response.ok) throw requestFailure(response, result, 'Cash could not be loaded');
    setSummary(normalizeSummary(result as CashSummary));
    setReceiveCollectionId('');
  }, []);

  useEffect(() => {
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
        setContextError(cause instanceof Error ? cause.message : 'The station could not be loaded');
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
  }, [loadContext, loadSummary, routeKey]);

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

  async function postCommand(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    if (!context) return false;
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
      if (!response.ok) throw requestFailure(response, result, 'That could not be saved');
      intentKeys.current.delete(signature);
      setSuccess(COMMAND_SUCCESS[commandType] ?? 'Saved.');
      form.reset();
      if (commandType === 'CreateBankDeposit') setDepositRows([{ collectionId: '', amount: '' }]);
      await refresh();
      return true;
    } catch (cause) {
      const failure = cause as RequestFailure;
      if (failure.conflict)
        failure.message = `${failure.message} Reload to see the latest and try again.`;
      setError(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loadedRouteKey !== routeKey || contextStatus === 'loading') {
    return (
      <div className="cash-page" aria-busy="true">
        <SkeletonTiles count={3} label="Loading cash position" />
        <SkeletonCard label="Loading collections" lines={3} />
      </div>
    );
  }

  if (contextStatus === 'required') {
    return (
      <ContextRequiredState
        title="Choose a station"
        message="Pick one station at the top of the page to see its cash."
      />
    );
  }

  if (contextStatus === 'error') {
    return (
      <ErrorState
        title="Cash unavailable"
        message={contextError ?? 'The station could not be loaded.'}
        action={<Button onClick={() => window.location.reload()}>Try again</Button>}
      />
    );
  }

  const capabilities = summary?.capabilities ?? emptyCapabilities;
  const currency = summary?.currency ?? 'USD';
  const money = (value: string) => formatMoneyDisplay(value, currency);
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
    label: `${collection.collectionReference} · ${money(collection.availableAtStation)} available`,
  }));
  const tileState = loading && !summary ? 'loading' : summary ? 'ready' : 'error';
  const canConfirm = capabilities.confirmDeposit && confirmableDeposits.length > 0;
  const hasAnyAction =
    capabilities.recordCollection ||
    capabilities.receiveCollection ||
    capabilities.recordDeposit ||
    canConfirm;

  function openSheet(next: CashSheet) {
    setError(null);
    setSuccess(null);
    setSheet(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    if (await postCommand(event)) setSheet(null);
  }

  const sheetError = error ? <ErrorState message={error.message} title="That didn’t work" /> : null;

  return (
    <div className="cash-page">
      {sheet === null && error ? (
        <ErrorState
          message={error.message}
          action={<Button onClick={() => void refresh()}>Try again</Button>}
        />
      ) : null}
      {sheet === null && success ? <SuccessState title="Done" message={success} /> : null}

      <div className="kpi-section">
        <KpiGrid label="Cash position">
          <KpiTile
            label="At station"
            icon="wallet"
            state={tileState}
            value={summary ? money(summary.totals.availableAtStation) : null}
          />
          <KpiTile
            label="Collected, not banked"
            icon="inbox"
            state={tileState}
            value={summary ? money(summary.totals.collectedButUnbanked) : null}
          />
          <KpiTile
            label="Awaiting bank confirmation"
            icon="clock"
            state={tileState}
            value={summary ? money(summary.totals.pendingBankConfirmation) : null}
          />
        </KpiGrid>
      </div>

      {hasAnyAction ? (
        <div className="page-actions">
          {capabilities.recordCollection ? (
            <Button variant="primary" onClick={() => openSheet('collect')}>
              Record collection
            </Button>
          ) : null}
          {capabilities.receiveCollection ? (
            <Button variant="secondary" onClick={() => openSheet('receive')}>
              Receive collection
            </Button>
          ) : null}
          {capabilities.recordDeposit ? (
            <Button variant="secondary" onClick={() => openSheet('deposit')}>
              Record deposit
            </Button>
          ) : null}
          {canConfirm ? (
            <Button variant="secondary" onClick={() => openSheet('confirm')}>
              Confirm deposit
            </Button>
          ) : null}
        </div>
      ) : null}

      <Section
        title="Collections"
        headingId="cash-collections-title"
        action={<RefreshButton onClick={() => void refresh()} disabled={loading} />}
      >
        {!summary ? (
          <Skeleton lines={3} label="Loading collections" />
        ) : summary.collections.length === 0 ? (
          <EmptyState
            title="No collections yet"
            message="Collections you record from approved shift cash appear here."
          />
        ) : (
          <TableScrollRegion label="Station cash collections">
            <table className="data-table">
              <caption className="sr-only">Station cash collections</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Not banked</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.collections.map((collection) => (
                  <tr key={collection.collectionId}>
                    <th scope="row">{collection.collectionReference}</th>
                    <td data-label="Amount">{money(collection.amount)}</td>
                    <td data-label="Not banked">{money(collection.collectedButUnbanked)}</td>
                    <td data-label="Status">
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
      </Section>

      {capabilities.viewDeposits ? (
        <Section title="Bank deposits" headingId="deposit-list-title">
          {!summary ? (
            <Skeleton lines={2} label="Loading deposits" />
          ) : summary.deposits.length ? (
            <TableScrollRegion label="Station bank deposits">
              <table className="data-table">
                <caption className="sr-only">Station bank deposits</caption>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Account</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.deposits.map((deposit) => (
                    <tr key={deposit.depositId}>
                      <th scope="row">{deposit.depositReference}</th>
                      <td data-label="Account">{deposit.bankAccountName}</td>
                      <td data-label="Amount">{money(deposit.amount)}</td>
                      <td data-label="Status">
                        <StatusBadge tone={deposit.state === 'CONFIRMED' ? 'positive' : 'pending'}>
                          {displayState(deposit.state)}
                        </StatusBadge>
                      </td>
                      <td data-label="Difference">
                        {deposit.confirmationVariance ? money(deposit.confirmationVariance) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
          ) : (
            <EmptyState
              title="No deposits yet"
              message="Deposits you record appear here until the bank confirms them."
            />
          )}
        </Section>
      ) : null}

      {!hasAnyAction && summary ? (
        <EmptyState
          title="View only"
          message="Your access lets you see cash here but not record it."
        />
      ) : null}

      <ActionSheet
        title="Record collection"
        open={sheet === 'collect'}
        onOpenChange={(next) => setSheet(next ? 'collect' : null)}
        dismissible={!busy}
      >
        {() => (
          <form className="form-stack" onSubmit={(event) => void submit(event)}>
            <input type="hidden" name="commandType" value="RecordCashCollection" />
            {sheetError}
            <Field id="collection-reference" label="Collection reference" required>
              <input id="collection-reference" name="collectionReference" />
            </Field>
            <Field
              id="reconciliation-id"
              label="Approved cash from a shift"
              hint="Choose the approved shift cash this collection comes from."
              required
            >
              <Select
                id="reconciliation-id"
                name="reconciliationId"
                options={recordableSources.map((source) => ({
                  value: source.reconciliationId,
                  label: `${formatBusinessDate(source.businessDate)} · ${money(source.availableCash)} available`,
                }))}
                placeholder="Choose approved cash"
                disabled={recordableSources.length === 0}
              />
            </Field>
            <Field id="source-location-id" label="Cash location" required>
              <Select
                id="source-location-id"
                name="sourceLocationId"
                options={locationOptions}
                placeholder="Choose where the cash is"
                disabled={locationOptions.length === 0}
              />
            </Field>
            <NumericInput
              id="collection-amount"
              name="amount"
              label="Collected amount"
              unit={currency}
              required
            />
            <div className="sheet-actions">
              <Button type="submit" loading={busy} disabled={recordableSources.length === 0} block>
                Record collection
              </Button>
              <Button type="button" variant="secondary" onClick={() => setSheet(null)} block>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </ActionSheet>

      <ActionSheet
        title="Receive collection"
        open={sheet === 'receive'}
        onOpenChange={(next) => setSheet(next ? 'receive' : null)}
        dismissible={!busy}
      >
        {() => (
          <form className="form-stack" onSubmit={(event) => void submit(event)}>
            <input type="hidden" name="commandType" value="ReceiveCashCollection" />
            {sheetError}
            <Field id="receive-collection-id" label="Recorded collection" required>
              <Select
                id="receive-collection-id"
                name="collectionId"
                value={receiveCollectionId}
                onChange={(event) => setReceiveCollectionId(event.currentTarget.value)}
                options={receiveableCollections.map((collection) => ({
                  value: collection.collectionId,
                  label: `${collection.collectionReference} · ${money(collection.amount)}`,
                }))}
                placeholder="Choose a collection"
                disabled={receiveableCollections.length === 0}
              />
            </Field>
            <Field id="receive-location-id" label="Receiving location" required>
              <Select
                id="receive-location-id"
                name="targetLocationId"
                options={locationOptions}
                placeholder="Choose a different location"
                disabled={locationOptions.length < 2}
              />
            </Field>
            <div className="sheet-actions">
              <Button
                type="submit"
                loading={busy}
                disabled={receiveableCollections.length === 0}
                block
              >
                Receive collection
              </Button>
              <Button type="button" variant="secondary" onClick={() => setSheet(null)} block>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </ActionSheet>

      <ActionSheet
        title="Record deposit"
        open={sheet === 'deposit'}
        onOpenChange={(next) => setSheet(next ? 'deposit' : null)}
        dismissible={!busy}
      >
        {() => (
          <form className="form-stack" onSubmit={(event) => void submit(event)}>
            <input type="hidden" name="commandType" value="CreateBankDeposit" />
            {sheetError}
            <Field id="bank-account-id" label="Bank account" required>
              <Select
                id="bank-account-id"
                name="bankAccountId"
                options={
                  summary?.bankAccounts.map((account) => ({
                    value: account.bankAccountId,
                    label: `${account.name} · ${account.bankName} ${account.accountReferenceMasked}`,
                  })) ?? []
                }
                placeholder="Choose a bank account"
                disabled={!summary?.bankAccounts.length}
              />
            </Field>
            <Field id="deposit-location-id" label="Handed over from" required>
              <Select
                id="deposit-location-id"
                name="sourceLocationId"
                options={locationOptions}
                placeholder="Choose where the cash is"
                disabled={locationOptions.length === 0}
              />
            </Field>
            <Field id="deposit-reference" label="Deposit reference" required>
              <input id="deposit-reference" name="depositReference" />
            </Field>
            <div className="form-stack">
              <div className="panel-heading">
                <div>
                  <h3>Collections in this deposit</h3>
                  <p className="field-hint">Choose each collection and how much of it goes in.</p>
                </div>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() =>
                    setDepositRows((rows) => [...rows, { collectionId: '', amount: '' }])
                  }
                  disabled={depositableCollections.length === 0}
                >
                  Add another
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
                    unit={currency}
                    defaultValue={row.amount}
                    required
                  />
                  {depositRows.length > 1 ? (
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() =>
                        setDepositRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="sheet-actions">
              <Button
                type="submit"
                loading={busy}
                disabled={!summary?.bankAccounts.length || depositableCollections.length === 0}
                block
              >
                Record deposit
              </Button>
              <Button type="button" variant="secondary" onClick={() => setSheet(null)} block>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </ActionSheet>

      <ActionSheet
        title="Confirm deposit"
        description="Enter what the bank confirmed."
        open={sheet === 'confirm'}
        onOpenChange={(next) => setSheet(next ? 'confirm' : null)}
        dismissible={!busy}
      >
        {() => (
          <div className="form-stack">
            {sheetError}
            {confirmableDeposits.map((deposit) => (
              <form
                className="form-stack"
                key={deposit.depositId}
                onSubmit={(event) => void submit(event)}
              >
                <input type="hidden" name="commandType" value="ConfirmBankDeposit" />
                <input type="hidden" name="depositId" value={deposit.depositId} />
                <Field id={`confirm-deposit-${deposit.depositId}`} label={deposit.depositReference}>
                  <span className="field-hint">
                    {money(deposit.amount)} · {optionLabel(deposit.bankAccountName, 'Bank account')}{' '}
                    · {displayState(deposit.state)}
                  </span>
                </Field>
                <NumericInput
                  id={`confirmed-amount-${deposit.depositId}`}
                  name="confirmedAmount"
                  label="Confirmed amount"
                  unit={currency}
                  defaultValue={deposit.amount}
                  required
                />
                <Field id={`bank-reference-${deposit.depositId}`} label="Bank reference" required>
                  <input id={`bank-reference-${deposit.depositId}`} name="bankReference" />
                </Field>
                <div className="sheet-actions">
                  <Button type="submit" loading={busy} block>
                    Confirm deposit
                  </Button>
                </div>
              </form>
            ))}
            <Button type="button" variant="secondary" onClick={() => setSheet(null)} block>
              Close
            </Button>
          </div>
        )}
      </ActionSheet>
    </div>
  );
}
