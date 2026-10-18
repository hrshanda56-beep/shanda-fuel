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
import {
  formatDate,
  formatLitres,
  formatMoney,
  formatStatusLabel,
} from '@/design-system/formatters';
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
      return 'Adjustment';
    case 'REVERSAL':
      return 'Reversal';
  }
}

function transactionValue(transaction: CustomerTransaction): string {
  if (transaction.amount !== null) return money(transaction.amount, transaction.currency);
  if (transaction.litres !== null) return formatLitres(transaction.litres);
  return '—';
}

function AccountPosition({ account }: { account: CustomerAccount }) {
  if (account.accountType === 'CREDIT') {
    return (
      <section className="metric-grid metric-list" aria-label="Credit account position">
        <MetricCard
          label="Outstanding balance"
          value={money(account.balance, account.currency)}
          meta="Posted credit charges less payments"
        />
        <MetricCard
          label="Available credit"
          value={
            account.availableCredit === null
              ? 'Not set'
              : money(account.availableCredit, account.currency)
          }
          meta={
            account.creditLimit === null
              ? 'No credit limit is recorded'
              : `Limit ${money(account.creditLimit, account.currency)}`
          }
        />
      </section>
    );
  }

  if (account.accountType === 'PREPAID_VALUE') {
    return (
      <section className="metric-grid metric-list" aria-label="Prepaid value account position">
        <MetricCard
          label="Available prepaid value"
          value={money(account.availableBalance, account.currency)}
          meta="After active fuel reservations"
        />
        <MetricCard
          label="Posted balance"
          value={money(account.balance, account.currency)}
          meta={
            account.reservedAmount === '0'
              ? 'No active reservation'
              : `${money(account.reservedAmount, account.currency)} reserved`
          }
        />
      </section>
    );
  }

  return (
    <section aria-labelledby={`product-balances-${account.accountId}`}>
      <h3 id={`product-balances-${account.accountId}`}>Product balances</h3>
      {account.productBalances.length === 0 ? (
        <EmptyState
          title="No posted litre balance"
          message="Product-specific prepaid litres will appear after an authorised top-up is posted."
        />
      ) : (
        <TableScrollRegion label="Product-specific prepaid litre balances">
          <table className="responsive-table">
            <caption className="visually-hidden">Product-specific prepaid litre balances</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Posted balance</th>
                <th scope="col">Available</th>
              </tr>
            </thead>
            <tbody>
              {account.productBalances.map((product) => (
                <tr key={product.productId}>
                  <th scope="row" data-label="Product">
                    {product.productCode}
                    <br />
                    <small>{product.productName}</small>
                  </th>
                  <td data-label="Posted balance" className="numeric">
                    {formatLitres(product.balanceLitres)}
                  </td>
                  <td data-label="Available" className="numeric">
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

export function CustomerDetailWorkspace({ customerId }: { customerId: string }) {
  const contextFetch = useContextFetch();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [context, setContext] = useState<ContextResolution | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeLegalEntityId, setScopeLegalEntityId] = useState('');
  const [scopeForms, setScopeForms] = useState<ScopeForms>({});
  const [scopeSave, setScopeSave] = useState<{
    status: 'idle' | 'saving' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });

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
        throw new Error(getErrorMessage(result, 'Authorised customer context could not be loaded'));
      }
      setContext(result.data);
    } catch (cause) {
      if (!signal.aborted) {
        setContext(null);
        setContextError(
          cause instanceof Error
            ? cause.message
            : 'Authorised customer context could not be loaded',
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
      throw new Error(getErrorMessage(result, 'Customer detail could not be loaded'));
    }
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
        setError(cause instanceof Error ? cause.message : 'Customer detail could not be loaded');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  async function postCustomerCommand(input: Record<string, unknown>) {
    const response = await fetch('/api/customers/commands', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(input),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      throw new Error(getErrorMessage(result, 'Customer configuration could not be saved'));
    }
    return result;
  }

  async function saveCustomerScope() {
    if (!current || !customer || !customer.canManageConfiguration) return;
    const legalEntityId = scopeLegalEntityId.trim();
    if (!legalEntityId) {
      setScopeSave({
        status: 'error',
        message: 'Confirm a legal entity before saving the account scope.',
      });
      return;
    }
    for (const account of customer.accounts) {
      const form = scopeForms[account.accountId];
      if (!form?.stationScope) {
        setScopeSave({
          status: 'error',
          message: 'Choose ALL or SELECTED stations for every customer account before saving.',
        });
        return;
      }
      if (form.stationScope === 'SELECTED' && form.stationIds.length === 0) {
        setScopeSave({
          status: 'error',
          message: 'Choose at least one station for each SELECTED account scope.',
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
      setScopeSave({ status: 'success', message: 'Customer access scope saved and confirmed.' });
    } catch (cause) {
      setScopeSave({
        status: 'error',
        message:
          cause instanceof Error ? cause.message : 'Customer configuration could not be saved',
      });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadContext(controller.signal));
    return () => controller.abort();
    // URL changes trigger a fresh server-validated context resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, customerId, contextFetch]);

  useEffect(() => {
    if (!hasRequiredContext || !current) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadCustomer(current, controller.signal));
    return () => controller.abort();
    // Customer accounts are tenant-scoped; context changes refresh the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.organisationId, current?.legalEntityId, current?.stationId, current?.allStations]);

  const customerHref = useMemo(
    () =>
      current
        ? buildContextHref(`/customers/${encodeURIComponent(customerId)}`, search, current)
        : `/customers/${encodeURIComponent(customerId)}`,
    [current, customerId, search],
  );

  const availableLegalEntities = current
    ? (context?.available.organisations.find(
        (organisation) => organisation.id === current.organisationId,
      )?.legalEntities ?? [])
    : [];
  const selectedLegalEntity = availableLegalEntities.find(
    (legalEntity) => legalEntity.id === scopeLegalEntityId,
  );

  return (
    <div className="content-grid">
      <PageHeader
        eyebrow={scopeLabel ?? 'Commercial accounts'}
        title={customer?.displayName ?? 'Customer detail'}
        headingLevel="h2"
        titleId="customer-detail-title"
        description={
          customer
            ? `Account reference ${customer.accountReference}`
            : 'Review the authorised customer identity and account position.'
        }
        actions={
          <Link className="button button-secondary" href={backHref}>
            Back to customers
          </Link>
        }
      />

      {contextLoading ? <LoadingState label="Loading authorised context" /> : null}
      {contextError ? <ErrorState message={contextError} /> : null}
      {!contextLoading && !contextError && !hasRequiredContext ? (
        <ContextRequiredState
          title="Select an organisation"
          message="Use the work context selector above to choose an organisation."
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
      {loading ? <LoadingState label="Loading customer detail" /> : null}
      {!loading && !error && hasRequiredContext && !customer ? (
        <EmptyState
          title="Customer not found in this organisation"
          message="The customer may not belong to the selected organisation, or the record is not available to this authorised view."
          action={
            <Link className="button button-secondary" href={backHref}>
              Return to customers
            </Link>
          }
        />
      ) : null}

      {customer && hasRequiredContext ? (
        <>
          <Card as="section" className="panel" aria-labelledby="customer-identity-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Customer identity</p>
                <h2 id="customer-identity-title">Basic details</h2>
              </div>
              <StatusBadge tone={customer.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                {formatStatusLabel(customer.status)}
              </StatusBadge>
            </div>
            <dl className="detail-list">
              <dt>Account reference</dt>
              <dd>{customer.accountReference}</dd>
              <dt>Organisation</dt>
              <dd>{scopeLabel ?? 'Authorised organisation'}</dd>
              <dt>Account scope</dt>
              <dd>Tenant-wide customer account</dd>
              {Object.entries(customer.contactMetadata).map(([key, value]) => (
                <Fragment key={key}>
                  <dt>{formatStatusLabel(key)}</dt>
                  <dd>{value}</dd>
                </Fragment>
              ))}
            </dl>
          </Card>

          <Card as="section" className="panel content-span" aria-labelledby="customer-scope-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Customer credit readiness</p>
                <h2 id="customer-scope-title">Legal entity and station scope</h2>
              </div>
              <StatusBadge
                tone={
                  customer.accounts.length > 0 &&
                  customer.accounts.every((account) => account.ready)
                    ? 'positive'
                    : 'warning'
                }
              >
                {customer.accounts.length > 0 && customer.accounts.every((account) => account.ready)
                  ? 'Ready'
                  : 'Not ready'}
              </StatusBadge>
            </div>

            {!customer.accounts.every((account) => account.ready) ? (
              <Notice tone="warning" title="Customer account is not ready">
                Confirm the legal entity and explicitly choose ALL or SELECTED stations before this
                account can be used. The product will not assume a default station scope.
              </Notice>
            ) : null}

            {!customer.canManageConfiguration ? (
              <Notice tone="info" title="Configuration is restricted">
                Only an OWNER or ADMINISTRATOR can manage this customer scope. Finance access
                remains read-only, including historical account activity.
              </Notice>
            ) : (
              <div className="form-stack">
                <Field
                  id="customer-legal-entity"
                  label="Customer legal entity"
                  hint={
                    customer.legalEntityId
                      ? 'The confirmed legal entity cannot be moved here because it anchors the customer receivable.'
                      : 'Choose the legal entity that owns this customer credit relationship.'
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
                    <option value="">Choose a legal entity</option>
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
                          <h3>Station access</h3>
                        </div>
                        <StatusBadge tone={account.ready ? 'positive' : 'warning'}>
                          {account.ready ? 'Ready' : 'Not ready'}
                        </StatusBadge>
                      </div>
                      <Field
                        id={`customer-station-scope-${account.accountId}`}
                        label="Station scope"
                        hint="This must be explicitly confirmed; ALL is not assumed for existing accounts."
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
                          <option value="">Choose a station scope</option>
                          <option value="ALL">ALL — every station in the legal entity</option>
                          <option value="SELECTED">SELECTED — choose stations</option>
                        </select>
                      </Field>

                      {form.stationScope === 'SELECTED' ? (
                        <fieldset disabled={scopeSave.status === 'saving'}>
                          <legend>Selected stations</legend>
                          {stations.length === 0 ? (
                            <p className="field-hint">
                              No active stations are available for this legal entity.
                            </p>
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
                    {scopeSave.status === 'saving' ? 'Saving scope…' : 'Save customer scope'}
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
          </Card>

          {customer.accounts.length === 0 ? (
            <Card as="section" className="panel" aria-labelledby="customer-accounts-title">
              <EmptyState
                title="No account is opened"
                message="This customer identity exists, but no credit or prepaid account is currently modelled for it."
              />
            </Card>
          ) : (
            customer.accounts.map((account) => (
              <Card
                as="section"
                className="panel content-span"
                key={account.accountId}
                aria-labelledby={`account-${account.accountId}`}
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Customer account</p>
                    <h2 id={`account-${account.accountId}`}>
                      {accountTypeLabel(account.accountType)}
                    </h2>
                  </div>
                  <StatusBadge tone={account.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                    {formatStatusLabel(account.status)}
                  </StatusBadge>
                </div>
                <AccountPosition account={account} />
              </Card>
            ))
          )}

          <Card
            as="section"
            className="panel content-span"
            aria-labelledby="customer-transactions-title"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Posted ledger activity</p>
                <h2 id="customer-transactions-title">Recent account transactions</h2>
              </div>
            </div>
            {customer.recentTransactions.length === 0 ? (
              <EmptyState
                title="No posted account activity"
                message="Authorised payments, top-ups and fuel usage will appear here after they are posted."
              />
            ) : (
              <TableScrollRegion label="Recent customer account transactions">
                <table className="responsive-table">
                  <caption className="visually-hidden">
                    Recent customer account transactions
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Account</th>
                      <th scope="col">Activity</th>
                      <th scope="col">Product</th>
                      <th scope="col">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.recentTransactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td data-label="Date">
                          {formatDate(transaction.occurredAt)}
                          <br />
                          <small>{transaction.businessDate}</small>
                        </td>
                        <td data-label="Account">{accountTypeLabel(transaction.accountType)}</td>
                        <td data-label="Activity">
                          {transactionLabel(transaction)}
                          {transaction.note ? (
                            <>
                              <br />
                              <small>{transaction.note}</small>
                            </>
                          ) : null}
                        </td>
                        <td data-label="Product">
                          {transaction.productName ?? transaction.productCode ?? '—'}
                        </td>
                        <td data-label="Value" className="numeric">
                          {transactionValue(transaction)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScrollRegion>
            )}
          </Card>

          <Notice tone="info" title="Not shown here yet">
            Invoices, statements, overdue ageing, customer terms, and vehicle or driver rules are
            not recorded for customers yet, so they are not shown.
          </Notice>
        </>
      ) : null}
      {customer ? (
        <Link className="field-hint" href={customerHref}>
          Refresh this customer view
        </Link>
      ) : null}
    </div>
  );
}
