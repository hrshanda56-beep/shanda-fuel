'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import {
  applyReportFilters,
  parseReportFilters,
  resolveReportFilters,
  type ReportFilters,
} from '../filters';
import { businessToday } from '../period';
import { ReportFilterBar } from './report-filter-bar';
import { useAvailableStations } from './use-available-stations';

/** Page-level stations and period for the Reports list, kept in the URL. */
export function ReportsFilters({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseReportFilters(searchParams), [searchParams]);
  const stations = useAvailableStations(tenantId);
  const range = resolveReportFilters(filters, businessToday());

  function change(next: ReportFilters) {
    const params = applyReportFilters(new URLSearchParams(searchParams.toString()), next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="reports-filters">
      <ReportFilterBar stations={stations} filters={filters} onChange={change} />
      {!range ? (
        <p className="field-hint" role="status">
          Choose both dates, with the start on or before the end.
        </p>
      ) : null}
    </div>
  );
}
