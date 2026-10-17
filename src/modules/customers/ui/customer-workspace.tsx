'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '../../../design-system/primitives';
import {
  formatBusinessDate,
  formatDate,
  formatLitres,
  formatMoney,
} from '../../../design-system/formatters';
import { TableScrollRegion } from '../../../design-system/table';
import type {
  CustomerAccountsResponse,
  CustomerSummary,
  CustomerTransactionSummary,
} from '../queries';
import {
  customerStatementUrl,
  localDateTimeToInstant,
  type SerializedCustomerStatement,
  type SerializedCustomerStatementBalance,
} from './customer-statement';

function statusTone(status: string): 'positive' | 'warning' | 'neutral' | 'critical' {
  if (status === 'ACTIVE') return 'positive';
  if (status === 'SUSPENDED') return 'warning';
  if (status === 'CLOSED') return 'critical';
  return 'neutral';
}

function transactionLabel(transaction: CustomerTransactionSummary): string {
  return entryTypeLabel(transaction.entryType);
}

function entryTypeLabel(entryType: string): string {
  return entryType
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function CustomerWorkspace({ tenantId }: { tenantId: string }) {
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/summary?tenantId=${tenantId}`, {
        cache: 'no-store',
        signal,
      });
      const body = (await response.json()) as CustomerAccountsResponse & { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Customer accounts could not be loaded');
      setCustomers(body.customers);
      setSelectedId((current) =>
        current && body.customers.some((customer) => customer.customerId === current)
          ? current
          : (body.customers[0]?.customerId ?? null),
      );
    } catch (cause) {
      if (!signal?.aborted)
        setError(cause instanceof Error ? cause.message : 'Customer accounts could not be loaded');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await refresh(controller.signal);
    })();
    return () => controller.abort();
    // Refreshes are explicit; tenantId is the only load dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.customerId === selectedId) ?? null,
    [customers, selectedId],
  );

  return (
    <div className="content-grid">
      <Card as="section" className="panel" aria-labelledby="customer-workspace-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Customer accounts</p>
            <h1 id="customer-workspace-title">Credit and prepaid position</h1>
          </div>
          <StatusBadge tone="informational">Read-only control view</StatusBadge>
        </div>
        <p>
          Review customer balances, active fuel reservations, and recent ledger evidence. Commercial
          policy, invoices, benefits, and vehicle controls remain separate onboarding decisions.
        </p>
        {loading ? <LoadingState label="Loading customer accounts" /> : null}
        {error ? (
          <ErrorState
            title="Customers unavailable"
            message={error}
            action={<Button onClick={() => void refresh()}>Retry</Button>}
          />
        ) : null}
        {!loading && !error && customers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            message="Customer master data will appear after onboarding."
          />
        ) : null}
        {!loading && !error && customers.length > 0 ? (
          <TableScrollRegion label="Customer account positions">
            <table className="responsive-table">
              <caption className="visually-hidden">Customer account positions</caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Status</th>
                  <th scope="col">Accounts</th>
                  <th scope="col">Exposure</th>
                  <th scope="col">
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => {
                  return (
                    <tr
                      key={customer.customerId}
                      aria-selected={selectedId === customer.customerId}
                    >
                      <td data-label="Customer">
                        <strong>{customer.accountReference}</strong>
                        <br />
                        {customer.displayName}
                      </td>
                      <td data-label="Status">
                        <StatusBadge tone={statusTone(customer.status)}>
                          {customer.status}
                        </StatusBadge>
                      </td>
                      <td data-label="Accounts" className="numeric">
                        {customer.accounts.length}
                      </td>
                      <td data-label="Exposure" className="numeric">
                        {formatMoney(customer.monetaryExposure)}
                      </td>
                      <td data-label="Action">
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => setSelectedId(customer.customerId)}
                        >
                          View details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : null}
      </Card>

      {selectedCustomer ? (
        <CustomerDetail
          key={selectedCustomer.customerId}
          customer={selectedCustomer}
          tenantId={tenantId}
        />
      ) : null}
    </div>
  );
}

function CustomerDetail({ customer, tenantId }: { customer: CustomerSummary; tenantId: string }) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    customer.accounts[0]?.accountId ?? null,
  );
  const [asOfDraft, setAsOfDraft] = useState('');
  const [asOf, setAsOf] = useState<string | undefined>();
  const [asOfError, setAsOfError] = useState<string | null>(null);
  const [loadedStatement, setLoadedStatement] = useState<{
    requestKey: string;
    data: SerializedCustomerStatement;
  } | null>(null);
  const [statementFailure, setStatementFailure] = useState<{
    requestKey: string;
    message: string;
  } | null>(null);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [loadMoreFailure, setLoadMoreFailure] = useState<{
    requestKey: string;
    message: string;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const selectedAccount =
    customer.accounts.find((account) => account.accountId === selectedAccountId) ??
    customer.accounts[0] ??
    null;

  const statementRequestKey = `${selectedAccount?.accountId ?? 'none'}:${asOf ?? 'current'}:${reloadKey}`;
  const statement =
    loadedStatement?.requestKey === statementRequestKey ? loadedStatement.data : null;
  const statementError =
    statementFailure?.requestKey === statementRequestKey ? statementFailure.message : null;
  const loadMoreError =
    loadMoreFailure?.requestKey === statementRequestKey ? loadMoreFailure.message : null;
  const statementLoading = Boolean(selectedAccount) && !statement && !statementError;

  useEffect(() => {
    if (!selectedAccount) return;
    const controller = new AbortController();
    let active = true;
    void fetchCustomerStatement({
      tenantId,
      accountId: selectedAccount.accountId,
      asOf,
      signal: controller.signal,
    })
      .then((result) => {
        if (active) setLoadedStatement({ requestKey: statementRequestKey, data: result });
      })
      .catch((cause) => {
        if (active && !controller.signal.aborted) {
          setStatementFailure({
            requestKey: statementRequestKey,
            message:
              cause instanceof Error ? cause.message : 'The customer statement could not be loaded',
          });
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [asOf, reloadKey, selectedAccount, statementRequestKey, tenantId]);

  function applyAsOf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!asOfDraft) {
      setAsOfError(null);
      setAsOf(undefined);
      return;
    }
    const nextAsOf = localDateTimeToInstant(asOfDraft);
    if (!nextAsOf) {
      setAsOfError('Enter a valid date and time.');
      return;
    }
    setAsOfError(null);
    setAsOf(nextAsOf);
  }

  async function loadMore() {
    if (!statement?.nextCursor || !selectedAccount || loadMoreLoading) return;
    setLoadMoreLoading(true);
    setLoadMoreFailure(null);
    try {
      const nextPage = await fetchCustomerStatement({
        tenantId,
        accountId: selectedAccount.accountId,
        asOf,
        cursor: statement.nextCursor,
      });
      setLoadedStatement((current) =>
        current?.requestKey === statementRequestKey
          ? {
              requestKey: statementRequestKey,
              data: { ...nextPage, lines: [...current.data.lines, ...nextPage.lines] },
            }
          : current,
      );
    } catch (cause) {
      setLoadMoreFailure({
        requestKey: statementRequestKey,
        message:
          cause instanceof Error ? cause.message : 'The next statement page could not be loaded',
      });
    } finally {
      setLoadMoreLoading(false);
    }
  }

  return (
    <>
      <Card as="section" className="panel" aria-labelledby="customer-detail-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Customer detail</p>
            <h2 id="customer-detail-title">{customer.displayName}</h2>
          </div>
          <StatusBadge tone={statusTone(customer.status)}>{customer.status}</StatusBadge>
        </div>
        <div className="metric-grid">
          {customer.accounts.map((account) => (
            <Card className="metric-card" key={account.accountId}>
              <span className="metric-label">{account.accountType.replaceAll('_', ' ')}</span>
              {account.accountType === 'PREPAID_LITRES' ? (
                account.productBalances.length > 0 ? (
                  <ul className="metric-list">
                    {account.productBalances.map((product) => (
                      <li key={product.productId}>
                        <strong className="metric-value numeric">
                          {product.productCode}: {formatLitres(product.balanceLitres)}
                        </strong>
                        <span className="metric-meta">
                          Reserved {formatLitres(product.reservedLitres)} · Available{' '}
                          {formatLitres(product.availableLitres)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <strong className="metric-value numeric">0.000 L</strong>
                )
              ) : (
                <>
                  <strong className="metric-value numeric">
                    {formatMoney(account.balance ?? '0', account.currency)}
                  </strong>
                  <span className="metric-meta">
                    Reserved {formatMoney(account.reservedAmount, account.currency)}
                  </span>
                </>
              )}
            </Card>
          ))}
        </div>
        <h3>Recent ledger evidence</h3>
        {customer.recentTransactions.length === 0 ? (
          <p className="metric-meta">No ledger entries have been posted for this customer.</p>
        ) : (
          <TableScrollRegion label="Recent customer ledger evidence">
            <table className="responsive-table">
              <caption className="visually-hidden">Recent customer ledger evidence</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Entry</th>
                  <th scope="col">Value</th>
                  <th scope="col">Source note</th>
                </tr>
              </thead>
              <tbody>
                {customer.recentTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td data-label="Date">
                      {formatDate(transaction.occurredAt)}
                      <br />
                      <span className="metric-meta">
                        {formatBusinessDate(transaction.businessDate)}
                      </span>
                    </td>
                    <td data-label="Entry">{transactionLabel(transaction)}</td>
                    <td data-label="Value" className="numeric">
                      {transaction.amount
                        ? formatMoney(transaction.amount, transaction.currency)
                        : formatLitres(transaction.litres ?? '0')}
                    </td>
                    <td data-label="Source note">{transaction.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        )}
      </Card>

      <Card as="section" className="panel" aria-labelledby="customer-statement-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Customer statement</p>
            <h2 id="customer-statement-title">Account ledger</h2>
          </div>
          <StatusBadge tone="informational">Server-confirmed values</StatusBadge>
        </div>
        {customer.accounts.length === 0 ? (
          <EmptyState
            title="No statement account"
            message="This customer has no account available for statement review."
          />
        ) : (
          <>
            <form className="demo-form" onSubmit={applyAsOf}>
              <div className="form-grid">
                <Field
                  id="customer-statement-account"
                  label="Account"
                  hint="Choose which customer ledger to review."
                  required
                >
                  <select
                    id="customer-statement-account"
                    value={selectedAccount?.accountId ?? ''}
                    onChange={(event) => {
                      setSelectedAccountId(event.target.value);
                      setLoadMoreFailure(null);
                    }}
                  >
                    {customer.accounts.map((account) => (
                      <option key={account.accountId} value={account.accountId}>
                        {account.accountType.replaceAll('_', ' ')} · {account.currency}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id="customer-statement-as-of"
                  label="As of date and time"
                  hint="Leave blank for the current posted balance."
                  error={asOfError ?? undefined}
                  optional
                >
                  <input
                    id="customer-statement-as-of"
                    type="datetime-local"
                    value={asOfDraft}
                    onChange={(event) => {
                      setAsOfDraft(event.target.value);
                      setAsOfError(null);
                    }}
                  />
                </Field>
              </div>
              <div className="form-actions">
                <Button type="submit" disabled={statementLoading}>
                  Apply as-of filter
                </Button>
                {asOf ? (
                  <Button
                    variant="quiet"
                    type="button"
                    disabled={statementLoading}
                    onClick={() => {
                      setAsOfDraft('');
                      setAsOf(undefined);
                    }}
                  >
                    Clear as-of filter
                  </Button>
                ) : null}
              </div>
            </form>
            {statementLoading ? <LoadingState label="Loading customer statement" /> : null}
            {statementError ? (
              <ErrorState
                title="Statement unavailable"
                message={statementError}
                action={
                  <Button onClick={() => setReloadKey((current) => current + 1)}>Retry</Button>
                }
              />
            ) : null}
            {!statementLoading && !statementError && statement ? (
              <CustomerStatementContent
                statement={statement}
                productCodeById={
                  new Map(
                    (selectedAccount?.productBalances ?? []).map((product) => [
                      product.productId,
                      product.productCode,
                    ]),
                  )
                }
                loadMoreLoading={loadMoreLoading}
                loadMoreError={loadMoreError}
                onLoadMore={() => void loadMore()}
              />
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

function CustomerStatementContent({
  statement,
  productCodeById,
  loadMoreLoading,
  loadMoreError,
  onLoadMore,
}: {
  statement: SerializedCustomerStatement;
  productCodeById: ReadonlyMap<string, string>;
  loadMoreLoading: boolean;
  loadMoreError: string | null;
  onLoadMore: () => void;
}) {
  return (
    <div aria-live="polite">
      <div className="metric-grid">
        <Card className="metric-card">
          <span className="metric-label">Balance</span>
          <strong className="metric-value numeric">
            {statementBalanceLabel(statement.balance, productCodeById)}
          </strong>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Statement basis</span>
          <strong className="metric-value">
            {statement.asOf ? formatDateTime(statement.asOf) : 'Current posted balance'}
          </strong>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Entries shown</span>
          <strong className="metric-value numeric">{statement.lines.length}</strong>
        </Card>
      </div>
      {statement.lines.length === 0 ? (
        <EmptyState
          title="No entries for this statement"
          message={
            statement.asOf
              ? 'No ledger entries were posted on or before the selected date and time.'
              : 'No ledger entries have been posted for this account.'
          }
        />
      ) : (
        <TableScrollRegion label="Customer account statement">
          <table className="responsive-table">
            <caption className="visually-hidden">Customer account statement</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Entry</th>
                <th scope="col">Value</th>
                <th scope="col">Running balance</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <tr key={line.entry.id}>
                  <td data-label="Date">
                    {formatDate(line.entry.occurredAt)}
                    <br />
                    <span className="metric-meta">
                      {formatBusinessDate(line.entry.businessDate)}
                    </span>
                  </td>
                  <td data-label="Entry">{entryTypeLabel(line.entry.entryType)}</td>
                  <td data-label="Value" className="numeric">
                    {statementEntryValue(line.entry)}
                  </td>
                  <td data-label="Running balance" className="numeric">
                    {statementBalanceLabel(line.runningBalance, productCodeById)}
                  </td>
                  <td data-label="Note">{line.entry.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      )}
      {loadMoreError ? (
        <ErrorState
          title="More statement entries unavailable"
          message={loadMoreError}
          action={<Button onClick={onLoadMore}>Retry</Button>}
        />
      ) : null}
      {statement.nextCursor ? (
        <div className="form-actions">
          <Button onClick={onLoadMore} loading={loadMoreLoading}>
            Load older entries
          </Button>
        </div>
      ) : null}
    </div>
  );
}

async function fetchCustomerStatement(input: {
  tenantId: string;
  accountId: string;
  asOf?: string;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<SerializedCustomerStatement> {
  const response = await fetch(customerStatementUrl(input), {
    cache: 'no-store',
    signal: input.signal,
  });
  const body = (await response.json().catch(() => null)) as
    (SerializedCustomerStatement & { message?: string }) | null;
  if (!response.ok) {
    throw new Error(body?.message ?? 'The customer statement could not be loaded');
  }
  if (!body || !Array.isArray(body.lines) || !body.balance) {
    throw new Error('The customer statement response was incomplete');
  }
  return body;
}

function statementEntryValue(entry: SerializedCustomerStatement['lines'][number]['entry']): string {
  return entry.amount
    ? formatMoney(entry.amount.amount, entry.amount.currency)
    : formatLitres(entry.quantityLitres ?? '0');
}

function statementBalanceLabel(
  balance: SerializedCustomerStatementBalance,
  productCodeById: ReadonlyMap<string, string>,
): string {
  if (balance.accountType !== 'PREPAID_LITRES') {
    return formatMoney(balance.amount, balance.currency);
  }
  if (balance.productBalances.length === 0) return formatLitres('0');
  return balance.productBalances
    .map(
      (product) =>
        `${productCodeById.get(product.productId) ?? product.productId.slice(0, 8)}: ${formatLitres(product.litres)}`,
    )
    .join(' · ');
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
