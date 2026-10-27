'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { Dropdown } from '../../../design-system/dropdown';
import { REPORT_CATEGORIES, reportsFor, reportsInCategory } from '../catalog';
import { categoryHref, parseCategoryParam } from '../rail';
import { applyReportFilters, parseReportFilters, type ReportFilters } from '../filters';
import { ReportFilterBar } from './report-filter-bar';
import { useAvailableStations } from './use-available-stations';

/** Page-level station choice for the Reports list, kept in the URL. Each row picks its own period. */
export function ReportsFilters({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseReportFilters(searchParams), [searchParams]);
  const stations = useAvailableStations(tenantId);

  function change(next: ReportFilters) {
    const params = applyReportFilters(new URLSearchParams(searchParams.toString()), next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="reports-filters">
      <ReportFilterBar stations={stations} filters={filters} onChange={change} showPeriod={false} />
    </div>
  );
}

/** Narrows the report list to one category. Sits beside the station picker as a Filters button. */
export function ReportCategoryFilter({ financeReports = true }: { financeReports?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = parseCategoryParam(searchParams.get('category'));
  const activeLabel = REPORT_CATEGORIES.find((category) => category.id === active)?.label;

  return (
    <Dropdown
      className="category-filter"
      align="end"
      aria-label="Filter reports by category"
      triggerIcon="filter"
      triggerLabel={activeLabel ? `Filters: ${activeLabel}` : 'Filters'}
      value={active ?? ''}
      options={[
        { value: '', label: `All Reports (${reportsFor(financeReports).length})` },
        ...REPORT_CATEGORIES.map((category) => ({
          value: category.id,
          label: `${category.label} (${reportsInCategory(category.id, financeReports).length})`,
        })),
      ]}
      onValueChange={(value) => {
        const next = new URLSearchParams(searchParams.toString());
        router.replace(categoryHref(pathname, next, parseCategoryParam(value || null)), {
          scroll: false,
        });
      }}
    />
  );
}
