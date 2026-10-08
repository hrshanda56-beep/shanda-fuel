'use client';

import { useEffect, useState } from 'react';
import type { ContextResolution } from '../../context/contracts';
import type { FilterStation } from './report-filter-bar';

/** Stations the signed-in user may report on, for the filter bar. */
export function useAvailableStations(tenantId: string, enabled = true): FilterStation[] {
  const [stations, setStations] = useState<FilterStation[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch('/api/context?pathname=/reports', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => response.json() as Promise<{ data?: ContextResolution }>)
      .then((body) => {
        const organisation = body.data?.available.organisations.find(
          (candidate) => candidate.id === tenantId,
        );
        setStations(
          (organisation?.legalEntities ?? []).flatMap((entity) =>
            entity.stations.map(({ id, code, name }) => ({ id, code, name })),
          ),
        );
      })
      .catch(() => {
        // The filter bar still works as "all stations" when the list is unavailable.
      });
    return () => controller.abort();
  }, [tenantId, enabled]);
  return stations;
}
