import type { ContextResolution, ContextSelection } from './contracts';
export type PortfolioArea =
  'operations' | 'reconciliations' | 'finance' | 'cash' | 'settlements' | 'valuation';
export function portfolioArea(path: string): PortfolioArea | null {
  if (path === '/operations/daily') return 'operations';
  if (path === '/operations/reconciliations') return 'reconciliations';
  if (path === '/inventory/valuation') return 'valuation';
  if (path === '/finance' || path === '/cash' || path === '/settlements')
    return path.slice(1) as PortfolioArea;
  return null;
}
export function portfolioStations(resolution: ContextResolution) {
  const current = resolution.current;
  if (!current?.allStations) return [];
  const organisation = resolution.available.organisations.find(
    (row) => row.id === current.organisationId,
  );
  return (
    organisation?.legalEntities
      .filter((entity) => !current.legalEntityId || entity.id === current.legalEntityId)
      .flatMap((entity) =>
        entity.stations.map((station) => ({
          station,
          entityName: entity.name,
          selection: {
            organisationId: organisation.id,
            legalEntityId: entity.id,
            stationId: station.id,
            allStations: false,
          } satisfies ContextSelection,
        })),
      ) ?? []
  );
}
/** Bound concurrent station reads without serializing the complete page. */
export function readLimiter(limit = 3) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError('Read concurrency must be a positive integer');
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(load: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try {
      return await load();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}
