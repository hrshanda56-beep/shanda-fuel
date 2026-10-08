'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatBusinessDate } from '@/design-system/formatters';
import { Icon } from '@/design-system/icons';
import { Button, ErrorState, Skeleton, StatusBadge } from '@/design-system/primitives';

import {
  approvalLabel,
  CLOSE_STATUS_PRESENTATION,
  countSuspendedCustomers,
  operationsAttention,
  shiftSummary,
  type AttentionRow,
  type TodayOperations,
} from './today-overview-model';

type Scope = { tenantId?: string; stationId?: string };

type Section<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

async function load<T>(url: string, signal: AbortSignal, failure: string): Promise<Section<T>> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal });
    if (response.status === 403) return { status: 'forbidden' };
    const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!response.ok || !body) {
      return { status: 'error', message: body?.message ?? failure };
    }
    return { status: 'ready', data: body };
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: 'error', message: failure };
  }
}

/**
 * "Today" for the selected station. Everything shown is a server projection:
 * nothing is computed or defaulted here, and nothing appears as zero while a
 * request is still loading.
 */
export function TodayOverview({ tenantId, stationId }: Scope) {
  const [operations, setOperations] = useState<Section<TodayOperations>>({ status: 'loading' });
  const [customers, setCustomers] = useState<Section<{ customers: { status: string }[] }>>({
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController();
    const { signal } = controller;
    const reset = window.setTimeout(() => {
      setOperations({ status: 'loading' });
      setCustomers({ status: 'loading' });
    }, 0);

    if (stationId) {
      const params = new URLSearchParams({ tenantId, stationId });
      load<TodayOperations>(
        `/api/forecourt/operations/overview?${params}`,
        signal,
        'Daily operations could not be loaded.',
      ).then(setOperations, () => {});
    }
    load<{ customers: { status: string }[] }>(
      `/api/customers/summary?${new URLSearchParams({ tenantId })}`,
      signal,
      'Customers could not be loaded.',
    ).then(setCustomers, () => {});

    return () => {
      window.clearTimeout(reset);
      controller.abort();
    };
  }, [tenantId, stationId, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const dailyHref = useMemo(() => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (stationId) params.set('stationId', stationId);
    return `/operations/daily?${params}`;
  }, [tenantId, stationId]);

  if (!tenantId) {
    return (
      <div className="today">
        <p className="today-note">
          Choose a work context from the station selector to see today’s activity.
        </p>
      </div>
    );
  }

  const attention: AttentionRow[] = [];
  if (operations.status === 'ready') {
    const row = operationsAttention(operations.data, dailyHref);
    if (row) attention.push(row);
  }
  if (customers.status === 'ready') {
    const suspended = countSuspendedCustomers(customers.data.customers);
    if (suspended > 0) {
      attention.push({
        id: 'customers-suspended',
        title: suspended === 1 ? '1 customer is suspended' : `${suspended} customers are suspended`,
        detail: 'They cannot start new account transactions.',
        href: `/customers?${new URLSearchParams({ tenantId })}`,
      });
    }
  }
  const attentionLoading = operations.status === 'loading' || customers.status === 'loading';

  return (
    <div className="today">
      <section className="today-section" aria-labelledby="today-ops-heading">
        <h2 id="today-ops-heading">Daily operations</h2>
        {!stationId ? (
          <p className="today-note">Choose a station to see today’s operations.</p>
        ) : operations.status === 'loading' ? (
          <Skeleton lines={2} label="Loading daily operations" />
        ) : operations.status === 'forbidden' ? (
          <p className="today-note">You don’t have access to daily operations for this station.</p>
        ) : operations.status === 'error' ? (
          <ErrorState
            title="Daily operations unavailable"
            message={operations.message}
            action={
              <Button variant="secondary" onClick={retry}>
                Try again
              </Button>
            }
          />
        ) : (
          <OperationsRow operations={operations.data} href={dailyHref} />
        )}
      </section>

      <section className="today-section" aria-labelledby="today-attention-heading">
        <h2 id="today-attention-heading">Needs attention</h2>
        {attentionLoading && attention.length === 0 ? (
          <Skeleton lines={2} label="Checking for items that need attention" />
        ) : attention.length > 0 ? (
          <ul className="today-list">
            {attention.map((row) => (
              <li key={row.id}>
                <Link className="today-row" href={row.href}>
                  <span className="today-row-text">
                    <span className="today-row-title">{row.title}</span>
                    <span className="today-row-detail">{row.detail}</span>
                  </span>
                  <Icon name="chevron-right" className="today-row-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="today-note">Nothing needs attention.</p>
        )}
        {customers.status === 'forbidden' ? (
          <p className="today-note">Customer alerts are hidden because you don’t have access.</p>
        ) : null}
        {operations.status === 'error' || customers.status === 'error' ? (
          <p className="today-note">Some items could not be checked.</p>
        ) : null}
      </section>
    </div>
  );
}

function OperationsRow({ operations, href }: { operations: TodayOperations; href: string }) {
  const close = CLOSE_STATUS_PRESENTATION[operations.status.close];
  const approval = approvalLabel(operations.status.approval);
  return (
    <ul className="today-list">
      <li>
        <Link className="today-row" href={href}>
          <span className="today-row-text">
            <span className="today-row-title">{operations.station.name}</span>
            <span className="today-row-detail">
              {formatBusinessDate(operations.currentBusinessDate)} ·{' '}
              {shiftSummary(operations.shifts)}
              {approval ? ` · ${approval}` : ''}
            </span>
          </span>
          <StatusBadge tone={close.tone}>{close.label}</StatusBadge>
          <Icon name="chevron-right" className="today-row-chevron" />
        </Link>
      </li>
    </ul>
  );
}
