'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { formatBusinessDate } from '../../../design-system/formatters';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
} from '../../../design-system/primitives';
import { formatTileLitres } from '../../reporting/format';
import { TankDrum } from './tank-drum';
import { fuelKind, tankLabel, tankLevel, tanksForStation } from './tank-overview-model';

type TankRow = {
  stationId: string;
  tankId: string;
  tankCode: string;
  productId: string;
  productCode: string;
  productName: string;
  capacityLitres: string;
  reorderLevelLitres: string | null;
  expectedLitres: string;
  physicalLitres: string | null;
  varianceLitres: string | null;
};

export type InventoryReport = {
  filters: { toDate: string };
  inventory: { rows: readonly TankRow[] };
};

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; forbidden: boolean }
  | { status: 'ready'; report: InventoryReport };

type Keyed = Load & { key?: string };

async function fetchTanks(
  tenantId: string,
  stationId: string,
  signal: AbortSignal,
): Promise<Load | null> {
  try {
    const params = new URLSearchParams({ tenantId, stationIds: stationId });
    const response = await fetch(`/api/reports/management?${params.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
    if (!response.ok) {
      const forbidden = response.status === 403;
      return {
        status: 'error',
        forbidden,
        message: forbidden
          ? 'You do not have access to tank levels for this station.'
          : 'Tank levels could not be loaded.',
      };
    }
    return { status: 'ready', report: (await response.json()) as InventoryReport };
  } catch (cause) {
    if ((cause as Error).name === 'AbortError') return null;
    return { status: 'error', forbidden: false, message: 'Tank levels could not be loaded.' };
  }
}

/**
 * Tanks for one station (reference 05/16), read from the posted management
 * report: tank code, configured product, capacity, last recorded dip and the
 * expected book quantity as of today. Each tank is drawn as a drum filled to
 * the last dip, or to the book quantity until a dip is recorded; the card says
 * which. A tank at or below its reorder level is flagged. Cards open the tank's
 * valuation stream.
 */
export function TankOverview({
  tenantId,
  stationId,
  contextHref = '',
  report,
}: {
  tenantId: string;
  stationId: string;
  contextHref?: string;
  report?: InventoryReport;
}) {
  const contextQuery = contextHref.split('?')[1];
  const key = `${tenantId}|${stationId}`;
  const [loaded, setLoaded] = useState<Keyed>({ status: 'loading' });
  // A result for another station is never shown while the new one loads.
  const state: Load = useMemo(
    () =>
      report ? { status: 'ready', report } : loaded.key === key ? loaded : { status: 'loading' },
    [loaded, key, report],
  );

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (report) return;
    const controller = new AbortController();
    void fetchTanks(tenantId, stationId, controller.signal).then((next) => {
      if (next) setLoaded({ ...next, key: `${tenantId}|${stationId}` });
    });
    return () => controller.abort();
  }, [tenantId, stationId, attempt, report]);

  const tanks = useMemo(
    () => (state.status === 'ready' ? tanksForStation(state.report.inventory.rows, stationId) : []),
    [state, stationId],
  );

  return (
    <Card as="section" className="panel tank-overview" aria-labelledby="tank-overview-title">
      <div className="panel-heading">
        <div>
          <h2 id="tank-overview-title">Tanks</h2>
          {state.status === 'ready' ? (
            <p className="tank-asof">{formatBusinessDate(state.report.filters.toDate)}</p>
          ) : null}
        </div>
      </div>

      {state.status === 'loading' ? <Skeleton lines={4} label="Loading tanks" /> : null}

      {state.status === 'error' ? (
        <ErrorState
          title={state.forbidden ? 'Tank levels restricted' : 'Tank levels unavailable'}
          message={state.message}
          action={
            state.forbidden ? undefined : (
              <Button
                onClick={() => {
                  setLoaded({ status: 'loading', key });
                  setAttempt((value) => value + 1);
                }}
              >
                Try again
              </Button>
            )
          }
        />
      ) : null}

      {state.status === 'ready' && tanks.length === 0 ? (
        <EmptyState
          title="No tanks recorded"
          message="Tanks appear here once they are set up for this station."
        />
      ) : null}

      {state.status === 'ready' && tanks.length > 0 ? (
        <>
          <ul className="tank-grid">
            {tanks.map((tank) => {
              const level = tankLevel(tank);
              const streamPath = `/inventory/valuation/streams/${tank.tankId}/${tank.productId}`;
              const compact = (value: string | null) => formatTileLitres(value).replace(' L', 'L');
              return (
                <li key={tank.tankId}>
                  <Link
                    href={contextQuery ? `${streamPath}?${contextQuery}` : streamPath}
                    className="tank-card"
                    data-state={level.state}
                    data-source={level.source}
                    data-fuel={fuelKind(tank.productCode, tank.productName)}
                  >
                    <span className="tank-card-head">
                      <span className="tank-card-code">
                        {tankLabel(tank.tankCode)}: {tank.productName}
                      </span>
                      {level.state === 'low' ? <StatusBadge tone="warning">Low</StatusBadge> : null}
                    </span>
                    <span className="tank-figure">
                      <TankDrum level={level} />
                      <span className="tank-percent">
                        {level.percent === null ? (
                          '—'
                        ) : (
                          <>
                            {level.percent}
                            <small>%</small>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="tank-card-body">
                      <span className="tank-card-litres">
                        {level.percent === null ? (
                          <span className="tank-card-capacity">Level not on record</span>
                        ) : (
                          <>
                            <strong>{compact(level.litres)}</strong>
                            <span className="tank-card-capacity">
                              /{compact(tank.capacityLitres)}
                            </span>
                          </>
                        )}
                      </span>
                      {level.source === 'book' ? (
                        <span
                          className="tank-card-note"
                          title="Estimated from book stock; no dip recorded yet"
                        >
                          Estimated
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
