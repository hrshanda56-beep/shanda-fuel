'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  buildContextHref,
  type ContextApiResponse,
  type ContextResolution,
  type ContextSelection,
} from '@/modules/context';
import { Notice } from '@/design-system/feedback';
import { PageHeader } from '@/design-system/layout';
import {
  Card,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { formatLitres, formatStatusLabel } from '@/design-system/formatters';
import { formatTileMoney } from '@/modules/reporting/format';
import type { CustomerAccount, CustomerAccountsResponse, CustomerSummary } from './types';

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
      return 'Credit';
    case 'PREPAID_VALUE':
      return 'Prepaid value';
    case 'PREPAID_LITRES':
      return 'Prepaid litres';
  }
}

/** Two-decimal money for display; a balance that is not recorded shows "—", never zero. */
function money(value: string | null, currency: string): string {
  return value === null ? '—' : formatTileMoney(value, currency);
}

function accountIndicator(account: CustomerAccount): string {
  if (account.accountType === 'CREDIT') {
    const outstanding =
      account.balance === null
        ? 'Balance not recorded'
        : `${money(account.balance, account.currency)} outstanding`;
    return account.availableCredit === null
      ? `${outstanding} · limit not set`
      : `${outstanding} · ${money(account.availableCredit, account.currency)} available`;
  }
  if (account.accountType === 'PREPAID_VALUE') {
    return account.availableBalance === null
      ? 'Balance not recorded'
      : `${money(account.availableBalance, account.currency)} available`;
  }
  if (account.productBalances.length === 0) return 'No product balance';
  return account.productBalances
    .map((product) => `${product.productCode} ${formatLitres(product.availableLitres)}`)
    .join(' · ');
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

export function CustomerWorkspace() {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [context, setContext] = useState<ContextResolution | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const current = context?.current ?? null;
  const hasRequiredContext = Boolean(current?.organisationId);
  const scopeLabel = contextLabel(context, current);

  async function loadContext(signal: AbortSignal) {
    setContextLoading(true);
    setContextError(null);
    try {
      const response = await fetch(contextRequestUrl('/customers', search), {
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

  async function loadCustomers(selection: ContextSelection, signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tenantId: selection.organisationId });
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
        throw new Error(getErrorMessage(result, 'Customer accounts could not be loaded'));
      }
      setCustomers((result as CustomerAccountsResponse).customers);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Customer accounts could not be loaded');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadContext(controller.signal));
    return () => controller.abort();
    // The URL is the server-validated context refresh trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!hasRequiredContext || !current) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadCustomers(current, controller.signal));
    return () => controller.abort();
    // Customer accounts are tenant-scoped; legal entity/station changes only
    // refresh the displayed shared context and revalidate the tenant read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.organisationId, current?.legalEntityId, current?.stationId, current?.allStations]);

  const filteredCustomers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((customer) => {
      const accountTypes = customer.accounts.map((account) =>
        accountTypeLabel(account.accountType),
      );
      return [customer.displayName, customer.accountReference, customer.status, ...accountTypes]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [customers, searchTerm]);

  const counts = useMemo(
    () => ({
      active: customers.filter((customer) => customer.status === 'ACTIVE').length,
      suspended: customers.filter((customer) => customer.status === 'SUSPENDED').length,
      credit: customers.filter((customer) =>
        customer.accounts.some((account) => account.accountType === 'CREDIT'),
      ).length,
    }),
    [customers],
  );

  const customerHref = (customer: CustomerSummary) =>
    current
      ? buildContextHref(`/customers/${encodeURIComponent(customer.customerId)}`, search, current)
      : `/customers/${encodeURIComponent(customer.customerId)}`;

  return (
    <div className="content-grid">
      <PageHeader
        eyebrow={scopeLabel ?? 'Commercial accounts'}
        title="Customer accounts"
        headingLevel="h2"
        titleId="customer-accounts-title"
        description="Balances and account status for each customer."
      />

      {contextLoading ? <LoadingState label="Loading authorised context" /> : null}
      {contextError ? <ErrorState message={contextError} /> : null}
      {!contextLoading && !contextError && !hasRequiredContext ? (
        <ContextRequiredState
          title="Select an organisation"
          message="Choose an authorised organisation before customer accounts can be loaded."
        />
      ) : null}

      {hasRequiredContext ? (
        <>
          <dl className="summary-strip content-span" aria-label="Customer summary">
            <div>
              <dt>Customers</dt>
              <dd>{loading && customers.length === 0 ? '—' : customers.length}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{loading && customers.length === 0 ? '—' : counts.active}</dd>
            </div>
            <div data-tone={counts.suspended > 0 ? 'warning' : undefined}>
              <dt>Suspended</dt>
              <dd>{loading && customers.length === 0 ? '—' : counts.suspended}</dd>
            </div>
            <div>
              <dt>Credit accounts</dt>
              <dd>{loading && customers.length === 0 ? '—' : counts.credit}</dd>
            </div>
          </dl>

          <Card as="section" className="panel content-span" aria-labelledby="customer-list-title">
            <div className="panel-heading">
              <div>
                <h2 id="customer-list-title">Customers</h2>
              </div>
              <StatusBadge tone="neutral">
                {filteredCustomers.length}{' '}
                {filteredCustomers.length === 1 ? 'customer' : 'customers'}
              </StatusBadge>
            </div>
            <Field
              id="customer-search"
              label="Search customers"
              hint="Name, account reference or account type."
            >
              <input
                id="customer-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Customer name or reference"
                autoComplete="off"
              />
            </Field>
            {loading ? <LoadingState label="Loading customer accounts" /> : null}
            {error ? (
              <ErrorState
                message={error}
                action={
                  <button
                    className="button button-secondary"
                    onClick={() => current && void loadCustomers(current)}
                  >
                    Retry
                  </button>
                }
              />
            ) : null}
            {!loading && !error && customers.length === 0 ? (
              <EmptyState
                title="No customer records"
                message="Customers appear here once they have been set up."
              />
            ) : null}
            {!loading && !error && customers.length > 0 && filteredCustomers.length === 0 ? (
              <EmptyState
                title="No matching customers"
                message="Try a different name, account reference or account type."
              />
            ) : null}
            {!loading && !error && filteredCustomers.length > 0 ? (
              <TableScrollRegion label="Customer accounts">
                <table className="responsive-table">
                  <caption className="visually-hidden">
                    Customer accounts and balance indicators
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Customer</th>
                      <th scope="col">Account type</th>
                      <th scope="col">Status</th>
                      <th scope="col">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map((customer) => (
                      <tr key={customer.customerId}>
                        <td data-label="Customer">
                          <Link className="row-link" href={customerHref(customer)}>
                            <strong>{customer.displayName}</strong>
                            <br />
                            <small>{customer.accountReference}</small>
                          </Link>
                        </td>
                        <td data-label="Account type">
                          {customer.accounts.length > 0
                            ? customer.accounts.map((account) => (
                                <span className="stack-sm" key={account.accountId}>
                                  {accountTypeLabel(account.accountType)}
                                </span>
                              ))
                            : 'No account opened'}
                        </td>
                        <td data-label="Status">
                          <StatusBadge tone={customer.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                            {formatStatusLabel(customer.status)}
                          </StatusBadge>
                        </td>
                        <td data-label="Balance">
                          {customer.accounts.length > 0 ? (
                            <div className="stack-sm">
                              {customer.accounts.map((account) => (
                                <div key={account.accountId}>{accountIndicator(account)}</div>
                              ))}
                            </div>
                          ) : (
                            'Not available'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScrollRegion>
            ) : null}
          </Card>

          <Notice tone="info" title="Not shown here yet">
            Overdue ageing, invoices and statements are not recorded for customers yet, so they are
            not shown.
          </Notice>
        </>
      ) : null}
    </div>
  );
}
