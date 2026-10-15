'use client';

import { useCallback, useEffect, useState } from 'react';
import { SkeletonBlock } from '../../../design-system/primitives';
import { relativeTime, type ReportActivityItem } from '../activity';
import { REPORT_ACTIVITY_CHANGED } from './use-report-actions';
import { QuickLook } from './quick-look';

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
    <section className="card panel rail-card" aria-labelledby="report-activity-title">
      <h2 className="rail-heading" id="report-activity-title">
        Recent activity
      </h2>
      {state.status === 'loading' ? (
        <div className="rail-note" role="status" aria-label="Loading recent activity">
          <SkeletonBlock height="0.875rem" />
          <SkeletonBlock width="70%" height="0.875rem" />
        </div>
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

/** Supporting rail: first-glance figures and the signed-in user's recent activity. */
export function ReportsRail({ tenantId }: { tenantId: string }) {
  return (
    <aside className="reports-rail" aria-label="Browse reports">
      <QuickLook tenantId={tenantId} />
      <RecentActivity tenantId={tenantId} />
    </aside>
  );
}
