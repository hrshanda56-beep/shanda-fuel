'use client';

import { useEffect, useState } from 'react';

import type { AvailableContext, ContextSelection, CurrentContext } from '@/modules/context';
import { shiftLabel } from '@/modules/forecourt/ui/shift-labels';

import { formatBusinessDate } from './formatters';
import { getDisplayStatus } from './status-display';

export type SearchResult = Readonly<{
  id: string;
  group: 'Stations' | 'Shifts' | 'Reconciliations' | 'Customers';
  title: string;
  detail?: string;
  /** Navigate here. */
  href?: string;
  /** Or switch to this station. */
  select?: ContextSelection;
}>;

const MAX_PER_GROUP = 5;

type Overview = {
  station: { timezone: string };
  selectedBusinessDay?: { id: string; date: string };
  shifts: Array<{ id: string; plannedStartAt: string; plannedEndAt: string; businessDate?: string }>;
  reconciliations: Array<{ id: string; shiftId: string | null; state: string }>;
};

type CustomerRow = { customerId: string; displayName: string; accountReference: string };

/**
 * What the search box can find beyond pages: stations, shifts, reconciliations and customers. Each
 * group uses data the person's own screens already load, so what is listed is what they may see; an
 * area they cannot read simply returns nothing.
 */
export function useSearchResults(
  open: boolean,
  query: string,
  context: { available: AvailableContext | null; current: CurrentContext | null },
): readonly SearchResult[] {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [customers, setCustomers] = useState<readonly CustomerRow[]>([]);
  const tenantId = context.current?.organisationId;
  const stationId = context.current?.stationId;

  useEffect(() => {
    if (!open || !tenantId) return;
    const controller = new AbortController();
    const { signal } = controller;
    if (stationId) {
      void fetch(
        `/api/forecourt/operations/overview?${new URLSearchParams({ tenantId, stationId })}`,
        { cache: 'no-store', signal },
      )
        .then((response) => (response.ok ? (response.json() as Promise<Overview>) : null))
        .then((body) => setOverview(body))
        .catch(() => undefined);
    }
    void fetch(`/api/customers/summary?${new URLSearchParams({ tenantId })}`, {
      cache: 'no-store',
      signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { customers?: CustomerRow[] } | null) => setCustomers(body?.customers ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [open, tenantId, stationId]);

  const needle = query.trim().toLowerCase();
  if (needle.length < 2 || !tenantId) return [];
  const matches = (...parts: Array<string | undefined>) =>
    parts.some((part) => part?.toLowerCase().includes(needle));

  const results: SearchResult[] = [];

  for (const organisation of context.available?.organisations ?? []) {
    for (const entity of organisation.legalEntities) {
      for (const station of entity.stations) {
        if (!matches(station.name, station.code)) continue;
        results.push({
          id: `station-${station.id}`,
          group: 'Stations',
          title: station.name,
          detail: station.id === stationId ? 'Current station' : 'Switch to this station',
          select: {
            organisationId: organisation.id,
            legalEntityId: entity.id,
            stationId: station.id,
            allStations: false,
          },
        });
      }
    }
  }

  if (overview && stationId) {
    const timezone = overview.station.timezone;
    const day = overview.selectedBusinessDay;
    const params = (shiftId: string) =>
      new URLSearchParams({ tenantId, stationId, ...(day ? { businessDayId: day.id } : {}), shiftId });
    for (const shift of overview.shifts) {
      const title = shiftLabel(shift.plannedStartAt, shift.plannedEndAt, timezone);
      const dateText = day ? formatBusinessDate(day.date) : '';
      if (!matches(title, dateText, `${dateText} ${title}`)) continue;
      results.push({
        id: `shift-${shift.id}`,
        group: 'Shifts',
        title,
        detail: dateText,
        href: `/operations/daily?${params(shift.id)}`,
      });
    }
    for (const reconciliation of overview.reconciliations) {
      const status = getDisplayStatus(reconciliation.state);
      const shift = overview.shifts.find((item) => item.id === reconciliation.shiftId);
      const title = shift ? shiftLabel(shift.plannedStartAt, shift.plannedEndAt, timezone) : 'Reconciliation';
      const dateText = day ? formatBusinessDate(day.date) : '';
      if (!matches(status.label, title, dateText)) continue;
      if (!reconciliation.shiftId) continue;
      const waiting = ['SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'LOCKED'].includes(
        reconciliation.state,
      );
      results.push({
        id: `reconciliation-${reconciliation.id}`,
        group: 'Reconciliations',
        title: `${title} · ${status.label}`,
        detail: dateText,
        href: waiting
          ? `/operations/reconciliations/${reconciliation.id}/review?${params(reconciliation.shiftId)}`
          : `/operations/daily?${params(reconciliation.shiftId)}&reconciliationId=${reconciliation.id}`,
      });
    }
  }

  for (const customer of customers) {
    if (!matches(customer.displayName, customer.accountReference)) continue;
    results.push({
      id: `customer-${customer.customerId}`,
      group: 'Customers',
      title: customer.displayName,
      detail: customer.accountReference,
      href: `/customers/${customer.customerId}?tenantId=${encodeURIComponent(tenantId)}`,
    });
  }

  const counts = new Map<string, number>();
  return results.filter((result) => {
    const next = (counts.get(result.group) ?? 0) + 1;
    counts.set(result.group, next);
    return next <= MAX_PER_GROUP;
  });
}
