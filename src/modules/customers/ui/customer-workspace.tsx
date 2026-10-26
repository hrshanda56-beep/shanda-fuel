'use client';
import { useContextFetch } from '@/modules/context/client-context';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  buildContextHref,
  type ContextApiResponse,
  type ContextResolution,
  type ContextSelection,
} from '@/modules/context';
import { Icon } from '@/design-system/icons';
import {
  Card,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import { formatLitres, formatStatusLabel } from '@/design-system/formatters';
import { formatTileMoney } from '@/modules/reporting/format';
import { AddCustomer } from './add-customer';
import type {
  CustomerAccount,
  CustomerAccountsResponse,
  CustomerCapabilities,
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
        : account.balance.trim().startsWith('-')
          ? `${money(account.balance.replace('-', ''), account.currency)} paid ahead`
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

// Fixed to the station's timezone so the server and browser always print the same text.
const DISPLAY_TIME_ZONE = 'Africa/Harare';

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
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

function stationScopeLabel(account: CustomerAccount): string {
  if (!account.stationScopeConfigured) return 'Stations not chosen yet';
  if (account.stationScope === 'ALL') return 'All stations';
  const count = account.allowedStationIds.length;
  return `${count} selected ${count === 1 ? 'station' : 'stations'}`;
}

/** The figures that matter for one account, in plain words. */
function accountFigures(account: CustomerAccount): Array<{ label: string; value: string }> {
  if (account.accountType === 'CREDIT') {
    return [
      { label: 'Owes us', value: money(account.balance, account.currency) },
      {
        label: 'Credit limit',
        value:
          account.creditLimit === null ? 'Not set' : money(account.creditLimit, account.currency),
      },
      {
        label: 'Can still take on credit',
        value:
          account.availableCredit === null
            ? 'Not set'
            : money(account.availableCredit, account.currency),
      },
    ];
  }
  if (account.accountType === 'PREPAID_VALUE') {
    return [
      { label: 'Balance', value: money(account.balance, account.currency) },
      { label: 'Available to spend', value: money(account.availableBalance, account.currency) },
      { label: 'Held for pending fuel', value: money(account.reservedAmount, account.currency) },
    ];
  }
  return account.productBalances.length === 0
    ? [{ label: 'Fuel prepaid', value: 'No product balance' }]
    : account.productBalances.map((product) => ({
        label: `${product.productName} prepaid`,
        value: `${formatLitres(product.availableLitres)} available`,
      }));
}

function DetailList({
  id,
  items,
}: {
  id: string;
  items: Array<{ label: string; value: ReactNode; wide?: boolean }>;
}) {
  return (
    <dl className="customer-details" id={id}>
      {items.map((item) => (
        <div key={item.label} data-wide={item.wide || undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type CustomerFilter = 'all' | 'active' | 'suspended' | 'credit';

const FILTERS: ReadonlyArray<{ value: CustomerFilter; label: string }> = [
  { value: 'all', label: 'All Customers' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'credit', label: 'Credit Accounts' },
];

function matchesFilter(customer: CustomerSummary, filter: CustomerFilter): boolean {
  if (filter === 'active') return customer.status === 'ACTIVE';
  if (filter === 'suspended') return customer.status === 'SUSPENDED';
  if (filter === 'credit') return customer.accounts.some((a) => a.accountType === 'CREDIT');
  return true;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

export function CustomerWorkspace({
  initial,
}: {
  initial?: {
    resolution: ContextResolution;
    customers: CustomerSummary[];
    capabilities?: CustomerCapabilities;
  };
}) {
  const contextFetch = useContextFetch();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [context, setContext] = useState<ContextResolution | null>(initial?.resolution ?? null);
  const [contextLoading, setContextLoading] = useState(!initial);
  const [contextError, setContextError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerSummary[]>(initial?.customers ?? []);
  const [capabilities, setCapabilities] = useState<CustomerCapabilities | null>(
    initial?.capabilities ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [hasLoaded, setHasLoaded] = useState(Boolean(initial));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleRow = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const current = context?.current ?? null;
  const hasRequiredContext = Boolean(current?.organisationId);

  async function loadContext(signal: AbortSignal) {
    setContextLoading(true);
    setContextError(null);
    try {
      const response = await contextFetch(contextRequestUrl('/customers', search), {
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
      setCapabilities((result as CustomerAccountsResponse).capabilities ?? null);
      setHasLoaded(true);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Customer accounts could not be loaded');
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
    // The URL is the server-validated context refresh trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, contextFetch]);

  useEffect(() => {
    if (initial || !hasRequiredContext || !current) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadCustomers(current, controller.signal));
    return () => controller.abort();
    // Customer accounts are tenant-scoped; legal entity/station changes only
    // refresh the displayed shared context and revalidate the tenant read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.organisationId, current?.legalEntityId, current?.stationId, current?.allStations]);

  const filteredCustomers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return customers.filter((customer) => {
      if (!matchesFilter(customer, filter)) return false;
      if (!query) return true;
      const accountTypes = customer.accounts.map((account) =>
        accountTypeLabel(account.accountType),
      );
      return [customer.displayName, customer.accountReference, customer.status, ...accountTypes]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [customers, searchTerm, filter]);

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

  // Counts only once the list has loaded; a failed load is not "0 customers".
  const countsReady = !loading && !error && hasLoaded;

  const customerHref = (customer: CustomerSummary) =>
    current
      ? buildContextHref(`/customers/${encodeURIComponent(customer.customerId)}`, search, current)
      : `/customers/${encodeURIComponent(customer.customerId)}`;

  const filterCount = (value: CustomerFilter) =>
    !countsReady ? '—' : customers.filter((customer) => matchesFilter(customer, value)).length;

  return (
    <div className="content-grid wide-workspace customer-workspace">
      {contextLoading ? <LoadingState label="Loading authorised context" /> : null}
      {contextError ? <ErrorState message={contextError} /> : null}
      {!contextLoading && !contextError && !hasRequiredContext ? (
        <ContextRequiredState
          title="Select an organisation"
          message="Use the work context selector above to choose an organisation."
        />
      ) : null}

      {hasRequiredContext && current ? (
        <div className="content-span customer-toolbar">
          <AddCustomer
            tenantId={current.organisationId}
            legalEntityId={
              current.legalEntityId ??
              // With one company in this organisation there is nothing to choose.
              (() => {
                const companies =
                  context?.available?.organisations.find((o) => o.id === current.organisationId)
                    ?.legalEntities ?? [];
                return companies.length === 1 ? (companies[0]?.id ?? null) : null;
              })()
            }
            canAdd={capabilities?.manageCustomer ?? false}
            canOpenAccount={capabilities?.openAccount ?? false}
          />
          <Link
            className="button button-secondary"
            href={buildContextHref('/customers/account-controls', search, current)}
          >
            Customer controls
          </Link>
        </div>
      ) : null}

      {hasRequiredContext ? (
        <Card as="section" className="panel content-span" aria-labelledby="customer-list-title">
          <h2 id="customer-list-title" className="visually-hidden">
            Customer accounts
          </h2>

          {customers.length > 0 ? (
            <div className="list-toolbar">
              <label className="list-search">
                <Icon name="search" />
                <input
                  id="customer-search"
                  type="search"
                  aria-label="Search customers"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search customers…"
                  autoComplete="off"
                />
              </label>
              <div className="list-filters" role="group" aria-label="Filter customers">
                {FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="list-filter"
                    aria-pressed={filter === item.value}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label}
                    <span>{filterCount(item.value)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

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
              layout="block"
              icon="users"
              title="No customers yet"
              message="Use Add customer above to set up the first one."
            />
          ) : null}
          {!loading && !error && customers.length > 0 && filteredCustomers.length === 0 ? (
            <EmptyState
              layout="block"
              icon="search"
              title="No matching customers"
              message="Try a different name or reference."
            />
          ) : null}
          {!loading && !error && filteredCustomers.length > 0 ? (
            <div className="list-table customer-table">
              <div className="list-head" aria-hidden="true">
                <span>Customer</span>
                <span>Account Type</span>
                <span>Status</span>
                <span>Balance</span>
              </div>
              <ul className="list-rows" aria-label="Customer accounts">
                {filteredCustomers.map((customer) => {
                  const open = expanded.has(customer.customerId);
                  const detailsId = `customer-details-${customer.customerId}`;
                  const contacts = Object.entries(customer.contactMetadata);
                  return (
                    <li
                      key={customer.customerId}
                      className="customer-item"
                      data-open={open || undefined}
                    >
                      <div
                        className="list-row customer-row"
                        onClick={() => toggleRow(customer.customerId)}
                      >
                        <span className="list-name">
                          <span className="list-avatar" aria-hidden="true">
                            {initials(customer.displayName)}
                          </span>
                          <span>
                            <strong>{customer.displayName}</strong>
                            <small>{customer.accountReference}</small>
                          </span>
                        </span>
                        <span className="list-cell" data-label="Account type">
                          {customer.accounts.length > 0
                            ? customer.accounts.map((account) => (
                                <span key={account.accountId}>
                                  {accountTypeLabel(account.accountType)}
                                </span>
                              ))
                            : 'No account opened'}
                        </span>
                        <span className="list-cell" data-label="Status">
                          <StatusBadge tone={customer.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                            {formatStatusLabel(customer.status)}
                          </StatusBadge>
                        </span>
                        <span className="list-cell" data-label="Balance">
                          {customer.accounts.length > 0
                            ? customer.accounts.map((account) => (
                                <span key={account.accountId}>{accountIndicator(account)}</span>
                              ))
                            : 'No account yet'}
                        </span>
                        <button
                          type="button"
                          className="customer-toggle"
                          aria-expanded={open}
                          aria-controls={detailsId}
                          aria-label={`${open ? 'Hide' : 'Show'} details for ${customer.displayName}`}
                        >
                          <Icon name="chevron-down" />
                        </button>
                      </div>
                      {open ? (
                        <div className="customer-expanded" id={detailsId}>
                          <DetailList
                            id={`${detailsId}-about`}
                            items={[
                              { label: 'Account reference', value: customer.accountReference },
                              {
                                label: 'Legal entity',
                                value: customer.legalEntityName ?? 'Not set',
                              },
                              {
                                label: 'Status',
                                value: formatStatusLabel(customer.status),
                              },
                              {
                                label: 'Accounts opened',
                                value: customer.accounts.length || 'None yet',
                              },
                              ...contacts.map(([key, value]) => ({
                                label: formatStatusLabel(key),
                                value,
                              })),
                            ]}
                          />
                          {customer.accounts.map((account) => (
                            <section
                              key={account.accountId}
                              className="customer-account"
                              aria-label={`${accountTypeLabel(account.accountType)} account`}
                            >
                              <h3>
                                {accountTypeLabel(account.accountType)} account
                                <StatusBadge
                                  tone={account.status === 'ACTIVE' ? 'positive' : 'neutral'}
                                >
                                  {formatStatusLabel(account.status)}
                                </StatusBadge>
                              </h3>
                              <DetailList
                                id={`${detailsId}-${account.accountId}`}
                                items={[
                                  ...accountFigures(account),
                                  { label: 'Works at', value: stationScopeLabel(account) },
                                  {
                                    label: 'Ready for fuel sales',
                                    value: account.ready ? 'Yes' : 'Not yet',
                                  },
                                ]}
                              />
                            </section>
                          ))}
                          <section className="customer-account" aria-label="Latest activity">
                            <h3>Latest activity</h3>
                            {customer.recentTransactions.length > 0 ? (
                              <ul className="customer-activity">
                                {customer.recentTransactions.slice(0, 3).map((transaction) => (
                                  <li key={transaction.id}>
                                    <span>{transactionLabel(transaction)}</span>
                                    <span>{formatWhen(transaction.occurredAt)}</span>
                                    <strong>{transactionValue(transaction)}</strong>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="customer-activity-empty">Nothing recorded yet.</p>
                            )}
                          </section>
                          <Link
                            className="button button-primary customer-open"
                            href={customerHref(customer)}
                          >
                            Open full account
                            <Icon name="arrow-right" />
                          </Link>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
