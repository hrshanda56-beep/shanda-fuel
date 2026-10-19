'use client';
import { useContextFetch } from '@/modules/context/client-context';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  buildContextHref,
  type ContextApiResponse,
  type ContextResolution,
  type ContextSelection,
} from '@/modules/context';
import { Notice } from '@/design-system/feedback';
import { formatLitres, formatMoney, formatStatusLabel } from '@/design-system/formatters';
import { Icon } from '@/design-system/icons';
import { PageHeader, MetricCard } from '@/design-system/layout';
import { formatTileMoney } from '@/modules/reporting/format';
import {
  Card,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
  SuccessState,
} from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { CustomerActions, type ActionProduct } from './customer-actions';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import type {
  CustomerAccount,
  CustomerAccountsResponse,
  CustomerSummary,
  CustomerTransaction,
} from './types';

type StationScope = '' | 'ALL' | 'SELECTED';

type ScopeForm = {
  stationScope: StationScope;
  stationIds: string[];
};

type ScopeForms = Record<string, ScopeForm>;

/** Two-decimal money for display; a balance that is not recorded shows "—", never zero. */
function money(value: string | null | undefined, currency: string): string {
  return value === null || value === undefined ? '—' : formatTileMoney(value, currency);
}

function scopeFormsForCustomer(customer: CustomerSummary): ScopeForms {
  return Object.fromEntries(
    customer.accounts.map((account) => [
      account.accountId,
      {
        stationScope: account.stationScopeConfigured ? account.stationScope : '',
        stationIds: [...account.allowedStationIds],
      },
    ]),
  );
}

function getErrorMessage(result: unknown, fallback: string): string {
  if (typeof result === 'object' && result !== null && 'message' in result) {
    const message = (result as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function contextRequestUrl(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set('pathname', pathname);
  return `/api/context?${params.toString()}`;
}

function accountTypeLabel(type: CustomerAccount['accountType']): string {
  switch (type) {
    case 'CREDIT':
      return 'Credit account';
    case 'PREPAID_VALUE':
      return 'Prepaid value account';
    case 'PREPAID_LITRES':
      return 'Prepaid litres account';
  }
}

function contextLabel(context: ContextResolution | null, current: ContextSelection | null) {
  if (!context || !current) return null;
  const organisation = context.available.organisations.find(
    (candidate) => candidate.id === current.organisationId,
  );
  const legalEntity = current.legalEntityId
    ? organisation?.legalEntities.find((candidate) => candidate.id === current.legalEntityId)
    : undefined;
  return legalEntity
    ? `${organisation?.name ?? 'Organisation'} · ${legalEntity.name}`
    : organisation?.name;
}

function transactionLabel(transaction: CustomerTransaction): string {
  switch (transaction.entryType) {
    case 'CREDIT_FUEL_CHARGE':
      return 'Fuel charged';
    case 'CUSTOMER_PAYMENT':
      return 'Payment';
    case 'PREPAID_TOPUP':
      return 'Prepaid top-up';
    case 'PREPAID_FUEL_USAGE':
      return 'Fuel usage';
    case 'ADJUSTMENT':
      return 'Balance correction';
    case 'REVERSAL':
      return 'Entry cancelled';
  }
}

function transactionValue(transaction: CustomerTransaction): string {
  if (transaction.amount !== null) return money(transaction.amount, transaction.currency);
  if (transaction.litres !== null) return formatLitres(transaction.litres);
  return '—';
}

const NOTHING_HELD = /^[0.]*$/;

function AccountPosition({ account }: { account: CustomerAccount }) {
  if (account.accountType === 'CREDIT') {
    return (
      <section className="metric-grid metric-list" aria-label="Credit account position">
        {account.balance !== null && account.balance.trim().startsWith('-') ? (
          <MetricCard
            label="Paid more than they owe"
            value={money(account.balance.replace('-', ''), account.currency)}
            meta="This will be used against their next fuel on credit"
          />
        ) : (
          <MetricCard
            label="Owes us"
            value={money(account.balance, account.currency)}
            meta="Fuel taken on credit, less payments received"
          />
        )}
        <MetricCard
          label="Can still buy on credit"
          value={
            account.availableCredit === null
              ? 'Not set'
              : money(account.availableCredit, account.currency)
          }
          meta={
            account.creditLimit === null
              ? 'No credit limit has been set'
              : `Credit limit ${money(account.creditLimit, account.currency)}`
          }
        />
      </section>
    );
  }

  if (account.accountType === 'PREPAID_VALUE') {
    return (
      <section className="metric-grid metric-list" aria-label="Prepaid value account position">
        <MetricCard
          label="Available to spend"
          value={money(account.availableBalance, account.currency)}
          meta={
            NOTHING_HELD.test(account.reservedAmount)
              ? 'Nothing is held for pending fuel'
              : 'Balance, less fuel being held'
          }
        />
        {NOTHING_HELD.test(account.reservedAmount) ? null : (
          <MetricCard
            label="Balance"
            value={money(account.balance, account.currency)}
            meta={`${money(account.reservedAmount, account.currency)} held for pending fuel`}
          />
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby={`product-balances-${account.accountId}`}>
      <h3 id={`product-balances-${account.accountId}`}>Prepaid fuel</h3>
      {account.productBalances.length === 0 ? (
        <EmptyState
          title="No prepaid fuel yet"
          message="Litres will show here once a top-up has been recorded."
        />
      ) : (
        <TableScrollRegion label="Prepaid litres by fuel">
          <table className="responsive-table">
            <caption className="visually-hidden">Prepaid litres by fuel</caption>
            <thead>
              <tr>
                <th scope="col">Fuel</th>
                <th scope="col">Litres paid for</th>
                <th scope="col">Litres left to use</th>
              </tr>
            </thead>
            <tbody>
              {account.productBalances.map((product) => (
                <tr key={product.productId}>
                  <th scope="row" data-label="Fuel">
                    {product.productName}
                    <br />
                    <small>{product.productCode}</small>
                  </th>
                  <td data-label="Litres paid for" className="numeric">
                    {formatLitres(product.balanceLitres)}
                  </td>
                  <td data-label="Litres left to use" className="numeric">
                    {formatLitres(product.availableLitres)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      )}
    </section>
  );
}

// Fixed to the station's timezone so the server and browser always print the same text.
function formatWhen(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Harare',
  }).format(new Date(value));
}

/** Why the customer cannot buy fuel yet, in plain words; null when they can. */
function notReadyReason(customer: CustomerSummary): string | null {
  if (customer.accounts.length === 0) return 'No account has been opened yet';
  if (!customer.legalEntityId) return 'The company they buy from has not been chosen';
  if (customer.accounts.some((account) => !account.stationScopeConfigured))
    return 'The stations they can buy at have not been chosen';
  return customer.accounts.every((account) => account.ready) ? null : 'Setup is not finished';
}

export function CustomerDetailWorkspace({
  customerId,
  initial,
}: {
  customerId: string;
  initial?: { resolution: ContextResolution; customer: CustomerSummary | null };
}) {
  const contextFetch = useContextFetch();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [context, setContext] = useState<ContextResolution | null>(initial?.resolution ?? null);
  const [contextLoading, setContextLoading] = useState(!initial);
  const [contextError, setContextError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerSummary | null>(initial?.customer ?? null);
  const [fuelProducts, setFuelProducts] = useState<ActionProduct[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeLegalEntityId, setScopeLegalEntityId] = useState(
    initial?.customer?.legalEntityId ?? '',
  );
  const [scopeForms, setScopeForms] = useState<ScopeForms>(
    initial?.customer ? scopeFormsForCustomer(initial.customer) : {},
  );
  const [scopeSave, setScopeSave] = useState<{
    status: 'idle' | 'saving' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });

  const [scopeStepUp, setScopeStepUp] = useState(false);
  const current = context?.current ?? null;
  const hasRequiredContext = Boolean(current?.organisationId);
  const scopeLabel = contextLabel(context, current);
  const backHref = current ? buildContextHref('/customers', search, current) : '/customers';

  async function loadContext(signal: AbortSignal) {
    setContextLoading(true);
    setContextError(null);
    try {
      const response = await contextFetch(contextRequestUrl(`/customers/${customerId}`, search), {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
      const result = (await response.json()) as Partial<ContextApiResponse> & { message?: string };
      if (!response.ok || !result.data) {
        throw new Error(
          getErrorMessage(result, 'This page could not be loaded. Please try again.'),
        );
      }
      setContext(result.data);
    } catch (cause) {
      if (!signal.aborted) {
        setContext(null);
        setContextError(
          cause instanceof Error
            ? cause.message
            : 'This page could not be loaded. Please try again.',
        );
      }
    } finally {
      if (!signal.aborted) setContextLoading(false);
    }
  }

  async function fetchCustomerSummary(
    selection: ContextSelection,
    signal?: AbortSignal,
  ): Promise<CustomerSummary | null> {
    const params = new URLSearchParams({
      tenantId: selection.organisationId,
      customerId,
    });
    const response = await fetch(`/api/customers/summary?${params.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
    const result: unknown = await response.json();
    if (
      !response.ok ||
      !result ||
      typeof result !== 'object' ||
      !('customers' in result) ||
      !Array.isArray((result as { customers?: unknown }).customers)
    ) {
      throw new Error(
        getErrorMessage(result, 'This customer could not be loaded. Please try again.'),
      );
    }
    setFuelProducts((result as CustomerAccountsResponse).fuelProducts ?? []);
    return (result as CustomerAccountsResponse).customers[0] ?? null;
  }

  async function loadCustomer(selection: ContextSelection, signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const loaded = await fetchCustomerSummary(selection, signal);
      setCustomer(loaded);
      if (loaded) {
        setScopeLegalEntityId(loaded.legalEntityId ?? '');
        setScopeForms(scopeFormsForCustomer(loaded));
      }
    } catch (cause) {
      if (!signal?.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'This customer could not be loaded. Please try again.',
        );
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  async function postCustomerCommand(
    input: Record<string, unknown>,
    idempotencyKey: string = crypto.randomUUID(),
  ) {
    const response = await fetch('/api/customers/commands', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(input),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      throw new Error(getErrorMessage(result, 'This could not be saved'));
    }
    return result;
  }

  async function saveCustomerScope(alreadyConfirmed = false) {
    if (!current || !customer || !customer.canManageConfiguration) return;
    const legalEntityId = scopeLegalEntityId.trim();
    if (!legalEntityId) {
      setScopeSave({
        status: 'error',
        message: 'Choose the company before saving.',
      });
      return;
    }
    for (const account of customer.accounts) {
      const form = scopeForms[account.accountId];
      if (!form?.stationScope) {
        setScopeSave({
          status: 'error',
          message: 'Choose where each account can buy fuel before saving.',
        });
        return;
      }
      if (form.stationScope === 'SELECTED' && form.stationIds.length === 0) {
        setScopeSave({
          status: 'error',
          message: 'Tick at least one station for each account.',
        });
        return;
      }
    }

    setScopeSave({ status: 'saving' });
    try {
      let workingCustomer = customer;
      if (!customer.legalEntityId) {
        await postCustomerCommand({
          commandType: 'SetCustomerLegalEntity',
          tenantId: current.organisationId,
          customerId: customer.customerId,
          legalEntityId,
          expectedVersion: customer.version,
        });
        workingCustomer = (await fetchCustomerSummary(current)) ?? customer;
      }

      for (const account of workingCustomer.accounts) {
        const form = scopeForms[account.accountId];
        if (!form) continue;
        const unchanged =
          account.stationScopeConfigured &&
          account.stationScope === form.stationScope &&
          account.allowedStationIds.length === form.stationIds.length &&
          account.allowedStationIds.every((stationId) => form.stationIds.includes(stationId));
        if (unchanged) continue;
        await postCustomerCommand({
          commandType: 'SetCustomerAccountStations',
          tenantId: current.organisationId,
          accountId: account.accountId,
          expectedVersion: account.version,
          stationScope: form.stationScope,
          ...(form.stationScope === 'SELECTED' ? { stationIds: form.stationIds } : {}),
        });
      }

      const saved = (await fetchCustomerSummary(current)) ?? workingCustomer;
      setCustomer(saved);
      setScopeLegalEntityId(saved.legalEntityId ?? '');
      setScopeForms(scopeFormsForCustomer(saved));
      setScopeSave({
        status: 'success',
        message: 'Saved. This customer’s fuel-buying settings are up to date.',
      });
    } catch (cause) {
      if (
        !alreadyConfirmed &&
        cause instanceof Error &&
        /not authorized|step-up/i.test(cause.message)
      ) {
        setScopeSave({ status: 'idle' });
        setScopeStepUp(true);
        return;
      }
      setScopeSave({
        status: 'error',
        message:
          cause instanceof Error ? cause.message : 'This could not be saved. Please try again.',
      });
    }
  }

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadContext(controller.signal));
    return () => controller.abort();
    // URL changes trigger a fresh server-validated context resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, customerId, contextFetch]);

  useEffect(() => {
    if (initial || !hasRequiredContext || !current) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadCustomer(current, controller.signal));
    return () => controller.abort();
    // Customer accounts are tenant-scoped; context changes refresh the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.organisationId, current?.legalEntityId, current?.stationId, current?.allStations]);

  const availableLegalEntities = current
    ? (context?.available.organisations.find(
        (organisation) => organisation.id === current.organisationId,
      )?.legalEntities ?? [])
    : [];
  const selectedLegalEntity = availableLegalEntities.find(
    (legalEntity) => legalEntity.id === scopeLegalEntityId,
  );
  const stationName = (stationId: string) =>
    availableLegalEntities
      .flatMap((legalEntity) => legalEntity.stations)
      .find((station) => station.id === stationId)?.name ?? 'A station';
  const readOnlyScope = (account: CustomerAccount) =>
    !account.stationScopeConfigured
      ? 'Not chosen yet'
      : account.stationScope === 'ALL'
        ? 'All stations'
        : account.allowedStationIds.map(stationName).join(', ') || 'No stations chosen';
  const actionStations = (
    customer?.legalEntityId
      ? availableLegalEntities.filter((legalEntity) => legalEntity.id === customer.legalEntityId)
      : availableLegalEntities
  ).flatMap((legalEntity) => legalEntity.stations);
  const [refreshState, setRefreshState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  async function refreshNow() {
    if (!current) return;
    setRefreshState('busy');
    try {
      const refreshed = await fetchCustomerSummary(current);
      if (refreshed) {
        setCustomer(refreshed);
        setScopeLegalEntityId(refreshed.legalEntityId ?? '');
        setScopeForms(scopeFormsForCustomer(refreshed));
      }
      setRefreshState('done');
    } catch {
      setRefreshState('failed');
    }
  }
  async function actionDone(message: string) {
    setActionMessage(message);
    if (!current) return;
    try {
      const refreshed = await fetchCustomerSummary(current);
      if (refreshed) {
        setCustomer(refreshed);
        setScopeLegalEntityId(refreshed.legalEntityId ?? '');
        setScopeForms(scopeFormsForCustomer(refreshed));
      }
    } catch {
      setActionMessage(`${message} Refresh the page to see the new figures.`);
    }
  }
  const reason = customer ? notReadyReason(customer) : null;
  // Open by itself while setup is unfinished, and then stay as the person left it, so the
  // "saved" message does not vanish when the customer becomes ready.
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);
  if (setupOpen === null && reason !== null && customer?.canManageConfiguration) setSetupOpen(true);
  const showProduct = customer?.recentTransactions.some((t) => t.productId !== null) ?? false;

  const backLink = (
    <Link className="button button-quiet" href={backHref}>
      Back to customers
    </Link>
  );

  return (
    <div className="content-grid customer-workspace">
      <PageHeader
        eyebrow={scopeLabel ?? 'Customers'}
        title={customer?.displayName ?? 'Customer detail'}
        headingLevel="h2"
        titleId="customer-detail-title"
        description={
          customer
            ? `Account reference ${customer.accountReference}`
            : 'What this customer owes or has paid in, and what they can do.'
        }
        actions={
          customer && current ? (
            <CustomerActions
              customer={customer}
              tenantId={current.organisationId}
              currentStationId={current.stationId ?? null}
              stations={actionStations}
              fuelProducts={fuelProducts}
              post={postCustomerCommand}
              onDone={(message) => void actionDone(message)}
              trailing={backLink}
            />
          ) : (
            backLink
          )
        }
      />

      {contextLoading ? <LoadingState label="Loading" /> : null}
      {contextError ? <ErrorState message={contextError} /> : null}
      {!contextLoading && !contextError && !hasRequiredContext ? (
        <ContextRequiredState
          title="Choose a business first"
          message="Use the selector at the top of the page to choose which business you are working in."
        />
      ) : null}
      {error ? (
        <ErrorState
          message={error}
          action={
            current ? (
              <button
                className="button button-secondary"
                onClick={() => void loadCustomer(current)}
              >
                Retry
              </button>
            ) : undefined
          }
        />
      ) : null}
      {loading ? <LoadingState label="Loading this customer" /> : null}
      {!loading && !error && hasRequiredContext && !customer ? (
        <EmptyState
          title="We could not find this customer"
          message="They may belong to a different business than the one you have chosen at the top of the page."
          action={
            <Link className="button button-secondary" href={backHref}>
              Back to customers
            </Link>
          }
        />
      ) : null}

      {customer && hasRequiredContext ? (
        <>
          {actionMessage ? (
            <div className="content-span">
              <SuccessState message={actionMessage} />
            </div>
          ) : null}
          {customer.accounts.length === 0 ? (
            <Card
              as="section"
              className="panel content-span"
              aria-labelledby="customer-accounts-title"
            >
              <EmptyState
                title="No account opened yet"
                message="This customer is on file but has no credit or prepaid account, so they cannot buy on account yet."
              />
            </Card>
          ) : (
            <Card as="section" className="panel" aria-labelledby="customer-accounts-title">
              <div className="panel-heading">
                <div>
                  <h2 id="customer-accounts-title">Accounts</h2>
                </div>
              </div>
              <div className="customer-account-list">
                {customer.accounts.map((account) => (
                  <section
                    className="customer-account"
                    key={account.accountId}
                    aria-labelledby={`account-${account.accountId}`}
                  >
                    <div className="panel-heading">
                      <h3 id={`account-${account.accountId}`}>
                        {accountTypeLabel(account.accountType)}
                      </h3>
                      {account.status === 'ACTIVE' ? null : (
                        <StatusBadge tone="neutral">
                          {formatStatusLabel(account.status)}
                        </StatusBadge>
                      )}
                    </div>
                    <AccountPosition account={account} />
                  </section>
                ))}
              </div>
            </Card>
          )}

          <Card as="section" className="panel customer-side" aria-labelledby="customer-scope-title">
            <div className="panel-heading">
              <div>
                <h2 id="customer-identity-title">Customer details</h2>
              </div>
            </div>
            <dl className="detail-list">
              <dt>Company</dt>
              <dd>{customer.legalEntityName ?? scopeLabel ?? 'Not chosen yet'}</dd>
              {Object.entries(customer.contactMetadata).map(([key, value]) => (
                <Fragment key={key}>
                  <dt>{formatStatusLabel(key)}</dt>
                  <dd>{value}</dd>
                </Fragment>
              ))}
            </dl>

            <details
              open={setupOpen ?? false}
              onToggle={(event) => setSetupOpen(event.currentTarget.open)}
              className="fold"
            >
              <summary>
                <span>
                  <h2 id="customer-scope-title">Where this customer can buy fuel</h2>
                  {reason !== null ? <small>{reason}. Tap to fix.</small> : null}
                </span>
                <StatusBadge tone={reason === null ? 'positive' : 'warning'}>
                  {reason === null ? 'Ready' : 'Needs setup'}
                </StatusBadge>
                <Icon name="chevron-down" />
              </summary>

              {reason !== null ? (
                <Notice tone="warning" title="This customer cannot buy fuel yet">
                  {reason}. Choose the company and the stations this customer may buy at, then press
                  Save changes.
                </Notice>
              ) : null}

              {!customer.canManageConfiguration ? (
                <>
                  <dl className="detail-list">
                    {customer.accounts.map((account) => (
                      <Fragment key={account.accountId}>
                        <dt>{accountTypeLabel(account.accountType)}</dt>
                        <dd>{readOnlyScope(account)}</dd>
                      </Fragment>
                    ))}
                  </dl>
                  <Notice tone="info" title="Only an owner or administrator can change this">
                    You can look at these settings and the account activity, but not change them.
                  </Notice>
                </>
              ) : (
                <div className="form-stack">
                  <Field
                    id="customer-legal-entity"
                    label="Company the customer buys from"
                    hint={
                      customer.legalEntityId
                        ? 'Already chosen. It cannot be changed here because the customer’s balance belongs to it.'
                        : 'Choose the company that this customer pays.'
                    }
                    required
                  >
                    <select
                      id="customer-legal-entity"
                      value={scopeLegalEntityId}
                      disabled={Boolean(customer.legalEntityId) || scopeSave.status === 'saving'}
                      onChange={(event) => {
                        const nextLegalEntityId = event.target.value;
                        setScopeLegalEntityId(nextLegalEntityId);
                        setScopeForms((currentForms) =>
                          Object.fromEntries(
                            Object.keys(currentForms).map((accountId) => [
                              accountId,
                              { stationScope: '', stationIds: [] },
                            ]),
                          ),
                        );
                        setScopeSave({ status: 'idle' });
                      }}
                    >
                      <option value="">Choose a company</option>
                      {availableLegalEntities.map((legalEntity) => (
                        <option key={legalEntity.id} value={legalEntity.id}>
                          {legalEntity.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {customer.accounts.map((account) => {
                    const form = scopeForms[account.accountId] ?? {
                      stationScope: '',
                      stationIds: [],
                    };
                    const stations = selectedLegalEntity?.stations ?? [];
                    return (
                      <div className="card" key={account.accountId}>
                        <div className="panel-heading">
                          <div>
                            <p className="eyebrow">{accountTypeLabel(account.accountType)}</p>
                            <h3>Stations</h3>
                          </div>
                          <StatusBadge tone={account.ready ? 'positive' : 'warning'}>
                            {account.ready ? 'Ready' : 'Not ready'}
                          </StatusBadge>
                        </div>
                        <Field
                          id={`customer-station-scope-${account.accountId}`}
                          label="Where can they buy fuel?"
                          hint="Please choose one."
                          required
                        >
                          <select
                            id={`customer-station-scope-${account.accountId}`}
                            value={form.stationScope}
                            disabled={!scopeLegalEntityId || scopeSave.status === 'saving'}
                            onChange={(event) => {
                              const stationScope = event.target.value as StationScope;
                              setScopeForms((currentForms) => ({
                                ...currentForms,
                                [account.accountId]: {
                                  stationScope,
                                  stationIds: stationScope === 'SELECTED' ? form.stationIds : [],
                                },
                              }));
                              setScopeSave({ status: 'idle' });
                            }}
                          >
                            <option value="">Choose…</option>
                            <option value="ALL">Every station of this company</option>
                            <option value="SELECTED">Only the stations I choose</option>
                          </select>
                        </Field>

                        {form.stationScope === 'SELECTED' ? (
                          <fieldset disabled={scopeSave.status === 'saving'}>
                            <legend>Stations they can buy at</legend>
                            {stations.length === 0 ? (
                              <p className="field-hint">This company has no active stations.</p>
                            ) : (
                              <div className="stack-sm">
                                {stations.map((station) => (
                                  <label key={station.id}>
                                    <input
                                      type="checkbox"
                                      checked={form.stationIds.includes(station.id)}
                                      onChange={(event) => {
                                        const stationIds = event.target.checked
                                          ? [...form.stationIds, station.id]
                                          : form.stationIds.filter(
                                              (stationId) => stationId !== station.id,
                                            );
                                        setScopeForms((currentForms) => ({
                                          ...currentForms,
                                          [account.accountId]: { ...form, stationIds },
                                        }));
                                        setScopeSave({ status: 'idle' });
                                      }}
                                    />{' '}
                                    {station.name} ({station.code})
                                  </label>
                                ))}
                              </div>
                            )}
                          </fieldset>
                        ) : null}
                      </div>
                    );
                  })}

                  <div className="button-row">
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={scopeSave.status === 'saving'}
                      onClick={() => void saveCustomerScope()}
                    >
                      {scopeSave.status === 'saving' ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                  {scopeSave.status === 'success' && scopeSave.message ? (
                    <SuccessState message={scopeSave.message} />
                  ) : null}
                  {scopeSave.status === 'error' && scopeSave.message ? (
                    <ErrorState message={scopeSave.message} />
                  ) : null}
                </div>
              )}
            </details>
          </Card>

          <Card
            as="section"
            className="panel content-span"
            aria-labelledby="customer-transactions-title"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Latest first</p>
                <h2 id="customer-transactions-title">Recent activity</h2>
              </div>
            </div>
            {customer.recentTransactions.length === 0 ? (
              <EmptyState
                title="Nothing recorded yet"
                message="Payments, top-ups and fuel bought will show here once they are recorded."
              />
            ) : (
              <TableScrollRegion label="Recent customer activity">
                <table className="responsive-table">
                  <caption className="visually-hidden">Recent customer activity</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      {customer.accounts.length > 1 ? <th scope="col">Account</th> : null}
                      <th scope="col">What happened</th>
                      {showProduct ? <th scope="col">Fuel</th> : null}
                      <th scope="col">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.recentTransactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td data-label="When">{formatWhen(transaction.occurredAt)}</td>
                        {customer.accounts.length > 1 ? (
                          <td data-label="Account">{accountTypeLabel(transaction.accountType)}</td>
                        ) : null}
                        <td data-label="What happened">
                          {transactionLabel(transaction)}
                          {transaction.note ? (
                            <>
                              <br />
                              <small>{transaction.note}</small>
                            </>
                          ) : null}
                        </td>
                        {showProduct ? (
                          <td data-label="Fuel">
                            {transaction.productName ?? transaction.productCode ?? '—'}
                          </td>
                        ) : null}
                        <td data-label="Amount" className="numeric">
                          {transactionValue(transaction)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScrollRegion>
            )}
          </Card>
        </>
      ) : null}
      {current ? (
        <StepUpDialog
          open={scopeStepUp}
          tenantId={current.organisationId}
          description="This change needs a fresh identity check first. Nothing is saved until you confirm."
          confirmLabel="Confirm and continue"
          cancelledMessage="The check was cancelled or did not pass. Nothing was saved."
          onVerified={() => {
            setScopeStepUp(false);
            void saveCustomerScope(true);
          }}
          onCancel={() => {
            setScopeStepUp(false);
            setScopeSave({
              status: 'error',
              message: 'The identity check was cancelled, so nothing was saved.',
            });
          }}
        />
      ) : null}
      {customer ? (
        <p className="field-hint" role="status">
          <button
            type="button"
            className="button button-quiet"
            disabled={refreshState === 'busy'}
            onClick={() => void refreshNow()}
          >
            {refreshState === 'busy' ? 'Refreshing…' : 'Refresh this page'}
          </button>{' '}
          {refreshState === 'done' ? 'Up to date.' : null}
          {refreshState === 'failed' ? 'Could not refresh. Try again.' : null}
        </p>
      ) : null}
    </div>
  );
}
