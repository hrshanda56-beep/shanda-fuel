'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { relativeTime, type ReportActivityItem } from '../activity';
import { REPORT_CATEGORIES, reportsInCategory } from '../catalog';
import { parseReportFilters } from '../filters';
import { REPORT_ACTIVITY_CHANGED } from './use-report-actions';
import { QUICK_ACTIONS, categoryHref, parseCategoryParam, quickActionHref } from '../rail';

type ActivityState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: readonly ReportActivityItem[] };

/** The signed-in user's own recent shares and exports; reloads after each new one. */
function RecentActivity({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<ActivityState>({ status: 'loading' });
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/reports/activity?tenantId=${encodeURIComponent(tenantId)}`,
          { credentials: 'same-origin', cache: 'no-store', signal },
        );
        if (!response.ok) throw new Error('unavailable');
        const body = (await response.json()) as { data: ReportActivityItem[] };
        setState({ status: 'ready', items: body.data });
      } catch {
        if (!signal?.aborted) setState({ status: 'error' });
      }
    },
    [tenantId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const first = window.setTimeout(() => void load(controller.signal), 0);
    const reload = () => void load();
    window.addEventListener(REPORT_ACTIVITY_CHANGED, reload);
    return () => {
      window.clearTimeout(first);
      controller.abort();
      window.removeEventListener(REPORT_ACTIVITY_CHANGED, reload);
    };
  }, [load]);

  return (
    <section aria-labelledby="report-activity-title">
      <h2 className="rail-heading" id="report-activity-title">
        Recent activity
      </h2>
      {state.status === 'loading' ? (
        <p className="rail-note" role="status">
          Loading…
        </p>
      ) : state.status === 'error' ? (
        <p className="rail-note">Recent activity is unavailable right now.</p>
      ) : state.items.length === 0 ? (
        <p className="rail-note">Nothing shared or exported yet.</p>
      ) : (
        <ul className="rail-activity">
          {state.items.map((item) => (
            <li key={item.id}>
              <span className="rail-activity-headline">{item.headline}</span>
              <span className="rail-activity-detail">
                {item.detail}
                {item.detail ? ' · ' : ''}
                <time dateTime={item.occurredAt}>{relativeTime(item.occurredAt)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

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
      <RecentActivity tenantId={tenantId} />
    </aside>
  );
}
