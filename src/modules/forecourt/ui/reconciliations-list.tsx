'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatBusinessDate, formatStatusSentence } from '../../../design-system/formatters';
import { Section } from '../../../design-system/layout';
import {
  KpiGrid,
  KpiTile,
  RefreshButton,
  SkeletonCard,
  SkeletonTiles,
} from '../../../design-system/page-kit';
import { Button, EmptyState, ErrorState, StatusBadge } from '../../../design-system/primitives';

import { formatTimestamp, timeRange, tone, type Overview } from './operations-control-room';

type Context = Readonly<{ tenantId: string; stationId: string; businessDayId?: string }>;

const AWAITING = new Set(['SUBMITTED', 'PENDING_APPROVAL']);

/**
 * Reconciliations for one business day, by shift. It reads the same station
 * overview the Daily operations screen uses and only changes how it is shown;
 * reviewing and approving stay in the existing review screen.
 */
export function ReconciliationsList({ context }: { context: Context }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({
      tenantId: context.tenantId,
      stationId: context.stationId,
    });
    if (context.businessDayId) params.set('businessDayId', context.businessDayId);
    return `/api/forecourt/operations/overview?${params.toString()}`;
  }, [context.businessDayId, context.stationId, context.tenantId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const body = (await response.json().catch(() => null)) as
        (Overview & { message?: string }) | null;
      if (response.status === 403) {
        throw new Error('You don’t have access to reconciliations for this station.');
      }
      if (!response.ok || !body) {
        throw new Error(body?.message ?? 'Reconciliations could not be loaded.');
      }
      setOverview(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reconciliations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading && !overview) {
    return (
      <div className="operations-control-room" aria-busy="true">
        <SkeletonTiles count={3} label="Loading reconciliation totals" />
        <SkeletonCard label="Loading reconciliations" lines={3} />
      </div>
    );
  }
  if (error && !overview) {
    return (
      <ErrorState
        title="Reconciliations unavailable"
        message={error}
        action={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  }
  if (!overview) return null;

  const visible = overview.visibility.reconciliations;
  const items = overview.reconciliations;
  const day = overview.selectedBusinessDay;
  const awaiting = items.filter((item) => AWAITING.has(item.state)).length;
  const approved = items.filter((item) => item.state === 'APPROVED').length;
  const returned = items.filter((item) => item.state === 'RETURNED').length;
  const tileState = visible ? 'ready' : 'forbidden';

  const reviewHref = (id: string, shiftId: string, businessDayId: string) =>
    `/operations/reconciliations/${id}/review?${new URLSearchParams({
      tenantId: context.tenantId,
      stationId: context.stationId,
      businessDayId,
      shiftId,
    }).toString()}`;

  return (
    <div className="operations-control-room">
      {error ? (
        <ErrorState
          title="That didn’t work"
          message={error}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : null}

      <div className="kpi-section">
        <KpiGrid label="Reconciliation totals">
          <KpiTile label="Awaiting approval" value={awaiting} state={tileState} icon="clock" />
          <KpiTile label="Approved" value={approved} state={tileState} icon="check-circle" />
          <KpiTile label="Returned" value={returned} state={tileState} icon="alert" />
        </KpiGrid>
      </div>

      <Section
        title={day ? `Reconciliations · ${formatBusinessDate(day.date)}` : 'Reconciliations'}
        headingId="reconciliations-title"
        action={<RefreshButton onClick={() => void load()} disabled={loading} />}
      >
        {!visible ? (
          <EmptyState
            title="No access"
            message="You don’t have access to reconciliations for this station."
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No reconciliations yet"
            message="They appear here when a shift is closed."
          />
        ) : (
          <div className="operations-list">
            {items.map((item) => {
              const shift = overview.shifts.find((candidate) => candidate.id === item.shiftId);
              const href =
                item.shiftId && day ? reviewHref(item.id, item.shiftId, day.id) : undefined;
              const row = (
                <>
                  <span>
                    <strong>
                      {shift
                        ? timeRange(
                            shift.plannedStartAt,
                            shift.plannedEndAt,
                            overview.station.timezone,
                          )
                        : 'Shift'}
                    </strong>
                    <small>
                      Updated {formatTimestamp(item.updatedAt, overview.station.timezone)}
                    </small>
                  </span>
                  <StatusBadge tone={tone(item.state)}>
                    {formatStatusSentence(item.state)}
                  </StatusBadge>
                </>
              );
              return href ? (
                <a className="operations-list-row" key={item.id} href={href}>
                  {row}
                </a>
              ) : (
                <div className="operations-list-row" key={item.id}>
                  {row}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
