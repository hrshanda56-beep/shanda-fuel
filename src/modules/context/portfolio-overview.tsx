import 'server-only';
import { Suspense } from 'react';
import Link from 'next/link';
import {
  Card,
  EmptyState,
  ErrorState,
  AccessDeniedState,
  LoadingState,
} from '@/design-system/primitives';
import { withRequestAuthority } from '@/modules/tenancy/request-authority';
import { AppError } from '@/platform/errors';
import { observeError } from '@/platform/observability';
import { buildContextHref } from './routes';
import type { ContextResolution } from './contracts';
import { portfolioStations, readLimiter, type PortfolioArea } from './portfolio';
import { getSupplierSummaryFromRequest } from '@/modules/creditors/queries';
import { PortfolioOperationsTable, PortfolioStationRow } from './portfolio-table';
import { loadPortfolioStation } from './portfolio-data';
const paths: Record<PortfolioArea, string> = {
  operations: '/operations/daily',
  reconciliations: '/operations/reconciliations',
  finance: '/finance',
  cash: '/cash',
  settlements: '/settlements',
  valuation: '/inventory/valuation',
};
export function PortfolioOverview({
  request,
  resolution,
  area,
}: {
  request: Request;
  resolution: ContextResolution;
  area: PortfolioArea;
}) {
  const rows = portfolioStations(resolution);
  const run = readLimiter();
  if (!rows.length)
    return (
      <EmptyState
        title="No stations available"
        message="No authorized stations are available in this organisation."
      />
    );
  if (area === 'operations' || area === 'reconciliations')
    return (
      <section className="portfolio-overview" aria-label="All stations overview">
        <PortfolioOperationsTable count={rows.length}>
          {rows.map((row) => (
            <Suspense
              key={row.station.id}
              fallback={
                <PortfolioStationRow
                  name={row.station.name}
                  entity={row.entityName}
                  href={buildContextHref('/operations/daily', '', row.selection)}
                  message="Loading station…"
                />
              }
            >
              <StationFacts request={request} row={row} area={area} run={run} table />
            </Suspense>
          ))}
        </PortfolioOperationsTable>
      </section>
    );
  return (
    <section className="portfolio-overview" aria-label="All stations overview">
      <p>{rows.length} stations · Open a station to view its records.</p>
      {area === 'finance' ? (
        <p>
          Payables and credit warnings belong to a legal entity and may appear at more than one
          station. They are not added together.
        </p>
      ) : null}
      <div className="portfolio-grid">
        {rows.map((row) => {
          const path =
            area === 'cash' || area === 'settlements'
              ? `/stations/${row.station.id}/${area}`
              : paths[area];
          return (
            <Card as="section" className="panel portfolio-station-card" key={row.station.id}>
              <h2>
                <Link href={buildContextHref(path, '', row.selection)}>{row.station.name}</Link>
              </h2>
              <p>{row.entityName}</p>
              <Suspense fallback={<LoadingState label={`Loading ${row.station.name}…`} />}>
                <StationFacts request={request} row={row} area={area} run={run} />
              </Suspense>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
async function StationFacts({
  request,
  row,
  area,
  run,
  table = false,
}: {
  table?: boolean;
  request: Request;
  row: ReturnType<typeof portfolioStations>[number];
  area: PortfolioArea;
  run: ReturnType<typeof readLimiter>;
}) {
  const stationHref = buildContextHref(
    area === 'reconciliations'
      ? `/stations/${row.station.id}/reconciliations`
      : '/operations/daily',
    '',
    row.selection,
  );
  const rowProps = { name: row.station.name, entity: row.entityName, href: stationHref };
  let facts: Awaited<ReturnType<typeof loadPortfolioStation>>;
  try {
    facts = await run(() =>
      withRequestAuthority(() => loadPortfolioStation(request, row.selection, area)),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === 'FORBIDDEN')
      return table ? (
        <PortfolioStationRow {...rowProps} message="Access restricted" />
      ) : (
        <AccessDeniedState />
      );
    observeError(request, error, 'portfolio.station.read');
    if (table)
      return (
        <PortfolioStationRow
          {...rowProps}
          message="Station data unavailable. Reload to try again."
        />
      );
    return (
      <ErrorState
        title="Station data unavailable"
        message="Reload to try again. Other stations are shown independently."
      />
    );
  }
  if (table) return <PortfolioStationRow {...rowProps} facts={facts} />;
  if (!facts.length) return <p>No records available.</p>;
  return (
    <dl className="portfolio-facts">
      {facts.map((fact, index) => (
        <div key={index}>
          <dt>{fact.label}</dt>
          <dd>{fact.href ? <Link href={fact.href}>{fact.value}</Link> : fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SupplierPortfolio({
  request,
  resolution,
}: {
  request: Request;
  resolution: ContextResolution;
}) {
  const run = readLimiter();
  const current = resolution.current;
  const organisation = resolution.available.organisations.find(
    (row) => row.id === current?.organisationId,
  );
  const entities =
    organisation?.legalEntities.filter(
      (row) => !current?.legalEntityId || row.id === current.legalEntityId,
    ) ?? [];
  return (
    <section aria-label="All legal entities">
      <p>All stations · supplier balances are shown once per legal entity.</p>
      {entities.map((entity) => (
        <Card as="section" className="panel" key={entity.id}>
          <h2>{entity.name}</h2>
          <Suspense fallback={<LoadingState label="Loading suppliers…" />}>
            <EntitySuppliers
              request={request}
              tenantId={organisation!.id}
              entityId={entity.id}
              run={run}
            />
          </Suspense>
        </Card>
      ))}
    </section>
  );
}
async function EntitySuppliers({
  request,
  tenantId,
  entityId,
  run,
}: {
  request: Request;
  tenantId: string;
  entityId: string;
  run: ReturnType<typeof readLimiter>;
}) {
  let rows: Awaited<ReturnType<typeof getSupplierSummaryFromRequest>>;
  try {
    rows = await run(() =>
      withRequestAuthority(() =>
        getSupplierSummaryFromRequest(request, { tenantId, legalEntityId: entityId }),
      ),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === 'FORBIDDEN') return <AccessDeniedState />;
    observeError(request, error, 'portfolio.suppliers.read');
    return <ErrorState title="Supplier data unavailable" message="Reload to try again." />;
  }
  if (!rows.length) return <p>No suppliers available.</p>;
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.supplierId}>
          <Link
            href={`/suppliers/${row.supplierId}?${new URLSearchParams({ tenantId, legalEntityId: entityId, allStations: 'true' })}`}
          >
            {row.legalName}
          </Link>{' '}
          · {row.currency} {row.total}
        </li>
      ))}
    </ul>
  );
}
