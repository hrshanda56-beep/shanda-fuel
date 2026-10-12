'use client';

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
import { effectiveProduct, tankProducts, tanksForStation } from './tank-overview-model';

type TankRow = {
  stationId: string;
  tankId: string;
  tankCode: string;
  productId: string;
  productCode: string;
  productName: string;
  expectedLitres: string;
  physicalLitres: string | null;
  varianceLitres: string | null;
};

type InventoryReport = {
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
 * report: tank code, configured product, last recorded dip and the expected
 * book quantity as of today. Tank capacity is not part of this contract yet
 * (BE-07), so no fill level is drawn; the silhouette says the level is not
 * on record instead of looking full or empty.
 */
export function TankOverview({ tenantId, stationId }: { tenantId: string; stationId: string }) {
  const key = `${tenantId}|${stationId}`;
  const [loaded, setLoaded] = useState<Keyed>({ status: 'loading' });
  // A result for another station is never shown while the new one loads.
  const state: Load = useMemo(
    () => (loaded.key === key ? loaded : { status: 'loading' }),
    [loaded, key],
  );
  const [product, setProduct] = useState<string>('all');

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchTanks(tenantId, stationId, controller.signal).then((next) => {
      if (next) setLoaded({ ...next, key: `${tenantId}|${stationId}` });
    });
    return () => controller.abort();
  }, [tenantId, stationId, attempt]);

  const tanks = useMemo(
    () => (state.status === 'ready' ? tanksForStation(state.report.inventory.rows, stationId) : []),
    [state, stationId],
  );
  // Products in the order the station's tanks list them; only configured ones.
  const products = useMemo(() => tankProducts(tanks), [tanks]);
  const selected = effectiveProduct(products, product);
  const visible = selected === 'all' ? tanks : tanks.filter((tank) => tank.productId === selected);

  return (
    <Card as="section" className="panel tank-overview" aria-labelledby="tank-overview-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {state.status === 'ready'
              ? `As of ${formatBusinessDate(state.report.filters.toDate)}`
              : 'Fuel in tanks'}
          </p>
          <h2 id="tank-overview-title">Tanks</h2>
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
          {products.length > 1 ? (
            <div className="pill-group" role="group" aria-label="Filter tanks by product">
              <button
                type="button"
                className="pill"
                aria-pressed={selected === 'all'}
                onClick={() => setProduct('all')}
              >
                All
              </button>
              {products.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="pill"
                  aria-pressed={selected === entry.id}
                  onClick={() => setProduct(entry.id)}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          ) : null}
          <ul className="tank-grid">
            {visible.map((tank) => (
              <li key={tank.tankId} className="tank-card">
                <div className="tank-card-head">
                  <h3>{tank.tankCode}</h3>
                  <span className="tank-card-product">{tank.productName}</span>
                </div>
                <div className="tank-figure" aria-hidden="true">
                  <span className="tank-figure-body">
                    <span className="tank-figure-unknown">Level not on record</span>
                  </span>
                </div>
                <dl className="tank-card-figures">
                  <div>
                    <dt>Last dip</dt>
                    <dd>{formatTileLitres(tank.physicalLitres)}</dd>
                  </div>
                  <div>
                    <dt>Expected</dt>
                    <dd>{formatTileLitres(tank.expectedLitres)}</dd>
                  </div>
                  <div>
                    <dt>Difference</dt>
                    <dd>{formatTileLitres(tank.varianceLitres)}</dd>
                  </div>
                </dl>
                {tank.physicalLitres === null ? (
                  <StatusBadge tone="pending">No dip recorded yet</StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="panel-detail">
            Fill levels will show once tank capacities are available here.
          </p>
        </>
      ) : null}
    </Card>
  );
}
