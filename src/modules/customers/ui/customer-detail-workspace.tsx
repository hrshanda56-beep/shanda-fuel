'use client';

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
import {
  Card,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import type {
  CustomerAccount,
  CustomerAccountsResponse,
  CustomerSummary,
  CustomerTransaction,
} from './types';

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
  if (transaction.amount !== null) return formatMoney(transaction.amount, transaction.currency);
  if (transaction.litres !== null) return formatLitres(transaction.litres);
  return '—';
}

function AccountPosition({ account }: { account: CustomerAccount }) {
  if (account.accountType === 'CREDIT') {
    return (
      <section className="metric-grid metric-list" aria-label="Credit account position">
        <MetricCard
          label="Outstanding balance"
          value={formatMoney(account.balance ?? '0', account.currency)}
          meta="Posted credit charges less payments"
        />
        <MetricCard
          label="Available credit"
          value={
            account.availableCredit === null
              ? 'Not set'
              : formatMoney(account.availableCredit, account.currency)
          }
          meta={
            account.creditLimit === null
              ? 'No credit limit is recorded'
              : `Limit ${formatMoney(account.creditLimit, account.currency)}`
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
          value={formatMoney(account.availableBalance ?? '0', account.currency)}
          meta="After active fuel reservations"
        />
        <MetricCard
          label="Posted balance"
          value={formatMoney(account.balance ?? '0', account.currency)}
          meta={
            account.reservedAmount === '0'
              ? 'No active reservation'
              : `${formatMoney(account.reservedAmount, account.currency)} reserved`
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
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [context, setContext] = useState<ContextResolution | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = context?.current ?? null;
  const hasRequiredContext = Boolean(current?.organisationId);
  const scopeLabel = contextLabel(context, current);
  const backHref = current ? buildContextHref('/customers', search, current) : '/customers';

  async function loadContext(signal: AbortSignal) {
    setContextLoading(true);
    setContextError(null);
    try {
      const response = await fetch(contextRequestUrl(`/customers/${customerId}`, search), {
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

  async function loadCustomer(selection: ContextSelection, signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
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
      setCustomer((result as CustomerAccountsResponse).customers[0] ?? null);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Customer detail could not be loaded');
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
  }, [search, customerId]);

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
          message="Choose an authorised organisation before customer detail can be loaded."
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
              <StatusBadge tone="informational">Read-only history</StatusBadge>
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

          <Notice tone="info" title="Phase 1 commercial gaps">
            Invoices, formal statements, staff or management benefits, vehicle and driver rules,
            customer-specific terms, and overdue ageing are not part of the currently modelled
            customer account data and are intentionally not inferred here.
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
