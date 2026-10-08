'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { REPORT_CATEGORIES, reportsInCategory } from '../catalog';
import { parseReportFilters } from '../filters';
import { QUICK_ACTIONS, categoryHref, parseCategoryParam, quickActionHref } from '../rail';

/** Supporting rail: browse by category and jump to common views. */
export function ReportsRail({ tenantId }: { tenantId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stationIds = useMemo(() => parseReportFilters(searchParams).stationIds, [searchParams]);
  const active = parseCategoryParam(searchParams.get('category'));
  const current = new URLSearchParams(searchParams.toString());

  return (
    <aside className="reports-rail" aria-label="Browse reports">
      <section aria-labelledby="report-categories-title">
        <h2 className="rail-heading" id="report-categories-title">
          Categories
        </h2>
        <ul className="rail-list">
          <li>
            <Link
              className="rail-link"
              href={categoryHref(pathname, current, null)}
              aria-current={active ? undefined : 'true'}
            >
              All reports
            </Link>
          </li>
          {REPORT_CATEGORIES.map((category) => (
            <li key={category.id}>
              <Link
                className="rail-link"
                href={categoryHref(pathname, current, category.id)}
                aria-current={active === category.id ? 'true' : undefined}
              >
                <span>{category.label}</span>
                <span className="rail-count">{reportsInCategory(category.id).length}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="report-quick-actions-title">
        <h2 className="rail-heading" id="report-quick-actions-title">
          Quick actions
        </h2>
        <ul className="rail-list">
          {QUICK_ACTIONS.map((action) => (
            <li key={action.id}>
              <Link className="rail-link" href={quickActionHref(action, tenantId, stationIds)}>
                {action.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
