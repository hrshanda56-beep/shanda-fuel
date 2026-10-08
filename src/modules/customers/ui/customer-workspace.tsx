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
import { Section } from '@/design-system/layout';
import { SkeletonCard } from '@/design-system/page-kit';
import {
  ContextRequiredState,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
} from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import {
  formatLitresDisplay,
  formatMoneyDisplay,
  formatStatusSentence,
} from '@/design-system/formatters';
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

function accountIndicator(account: CustomerAccount): string {
  if (account.accountType === 'CREDIT') {
    return account.availableCredit === null
      ? `${formatMoneyDisplay(account.balance ?? '0', account.currency)} owed · no limit set`
      : `${formatMoneyDisplay(account.balance ?? '0', account.currency)} owed · ${formatMoneyDisplay(account.availableCredit, account.currency)} available`;
  }
  if (account.accountType === 'PREPAID_VALUE') {
    return `${formatMoneyDisplay(account.availableBalance ?? '0', account.currency)} available`;
  }
  if (account.productBalances.length === 0) return 'No fuel balance';
  return account.productBalances
    .map((product) => `${product.productCode} ${formatLitresDisplay(product.availableLitres)}`)
    .join(' · ');
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
        throw new Error(getErrorMessage(result, 'Customers could not be loaded'));
      }
      setContext(result.data);
    } catch (cause) {
      if (!signal.aborted) {
        setContext(null);
        setContextError(cause instanceof Error ? cause.message : 'Customers could not be loaded');
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
        throw new Error(getErrorMessage(result, 'Customers could not be loaded'));
      }
      setCustomers((result as CustomerAccountsResponse).customers);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Customers could not be loaded');
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

  const customerHref = (customer: CustomerSummary) =>
    current
      ? buildContextHref(`/customers/${encodeURIComponent(customer.customerId)}`, search, current)
      : `/customers/${encodeURIComponent(customer.customerId)}`;

  const count = filteredCustomers.length;
  const showList = !loading && !error;

  return (
    <div className="customers-page">
      {contextLoading ? <SkeletonCard label="Loading customers" lines={3} /> : null}
      {contextError ? <ErrorState message={contextError} /> : null}
      {!contextLoading && !contextError && !hasRequiredContext ? (
        <ContextRequiredState
          title="Choose an organisation"
          message="Pick an organisation at the top of the page to see its customers."
        />
      ) : null}

      {hasRequiredContext ? (
        <Section
          title="Customers"
          headingId="customer-list-title"
          action={
            showList && customers.length > 0 ? (
              <span className="section-count">
                {count} {count === 1 ? 'customer' : 'customers'}
              </span>
            ) : null
          }
        >
          {customers.length > 0 ? (
            <input
              id="customer-search"
              className="list-search"
              type="search"
              aria-label="Search customers"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by name or reference"
              autoComplete="off"
            />
          ) : null}
          {loading ? <Skeleton lines={3} label="Loading customers" /> : null}
          {error ? (
            <ErrorState
              message={error}
              action={
                <button
                  className="button button-secondary"
                  onClick={() => current && void loadCustomers(current)}
                >
                  Try again
                </button>
              }
            />
          ) : null}
          {showList && customers.length === 0 ? (
            <EmptyState title="No customers yet" message="Customers you add will be listed here." />
          ) : null}
          {showList && customers.length > 0 && count === 0 ? (
            <EmptyState
              title="No matching customers"
              message="Try a different name, reference or account type."
            />
          ) : null}
          {showList && count > 0 ? (
            <TableScrollRegion label="Customers">
              <table className="responsive-table">
                <caption className="visually-hidden">Customers and their balances</caption>
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
                          : 'No account yet'}
                      </td>
                      <td data-label="Status">
                        <StatusBadge tone={customer.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                          {formatStatusSentence(customer.status)}
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
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
