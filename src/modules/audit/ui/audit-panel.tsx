'use client';

import { useCallback, useEffect, useState } from 'react';

import { Select } from '@/design-system/forms';
import { Icon } from '@/design-system/icons';
import { Pagination, pageOf, usePageState, type PageSlice } from '@/design-system/pagination';
import { Button, EmptyState, ErrorState, LoadingState } from '@/design-system/primitives';
import { SectionCard } from '@/design-system/section-card';

import type { AuditItem } from '../audit-view';
import styles from './audit-panel.module.css';

type Page = { items: AuditItem[]; next: string | null };

/** Changes shown on one page of the log. The server is asked for two pages at a time. */
const AUDIT_PAGE_SIZE = 20;
const BATCH_SIZE = AUDIT_PAGE_SIZE * 2;

const AREAS = [
  { value: '', label: 'Everything' },
  { value: 'CASH', label: 'Cash' },
  { value: 'INVENTORY', label: 'Fuel and stock' },
  { value: 'FORECOURT', label: 'Daily operations' },
  { value: 'SUPPLIER', label: 'Suppliers' },
  { value: 'EXPENSE', label: 'Expenses' },
  { value: 'CUSTOMER', label: 'Customers' },
  { value: 'SETTLEMENT', label: 'Card and mobile payments' },
  { value: 'SETUP', label: 'Station setup' },
  { value: 'REPORT', label: 'Reports' },
];

/**
 * "Cash: submit cash handover" becomes the area ("Cash") and what happened ("Submit cash
 * handover"). An action with no area is the whole sentence.
 */
function splitAction(action: string): { area: string; what: string } {
  const colon = action.indexOf(': ');
  const area = colon < 0 ? '' : action.slice(0, colon);
  const what = colon < 0 ? action : action.slice(colon + 2);
  return { area, what: what.charAt(0).toUpperCase() + what.slice(1) };
}

/**
 * The station's own clock when one is chosen. With every station in view there is no single clock,
 * so the time is shown in UTC and says so rather than guessing a zone.
 */
function when(iso: string, timeZone: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const format = (zone: string) =>
    date.toLocaleString('en-GB', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' });
  if (timeZone) {
    try {
      return format(timeZone);
    } catch {
      // An unreadable zone falls through to the explicit UTC time below.
    }
  }
  return `${format('UTC')} UTC`;
}

/**
 * A readable history of what people changed: who, when, and the values before and after. It is
 * the signed audit log shown for people; it cannot be edited from here.
 */
export function AuditPanel({
  tenantId,
  stationId,
  timezone,
}: Readonly<{ tenantId: string; stationId?: string; timezone?: string }>) {
  const [area, setArea] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ tenantId, limit: String(BATCH_SIZE) });
        if (stationId) params.set('stationId', stationId);
        if (area) params.set('area', area);
        if (after) params.set('after', after);
        const response = await fetch(`/api/audit/events?${params}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const result = (await response.json()) as Page & { message?: string };
        if (!response.ok) {
          throw new Error(
            response.status === 403
              ? 'You do not have permission to read the activity log.'
              : (result.message ?? 'The activity log could not be loaded.'),
          );
        }
        setPage((previous) =>
          after && previous
            ? { items: [...previous.items, ...result.items], next: result.next }
            : { items: result.items, next: result.next },
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The activity log could not be loaded.');
      } finally {
        setLoading(false);
      }
    },
    [tenantId, stationId, area],
  );

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  // Pages are cut from what is loaded; asking for the page after the last one loaded fetches the
  // next batch first, so "Next" works for as long as the log has older changes.
  const pageState = usePageState(area);
  const loaded = pageOf(page?.items ?? [], pageState, AUDIT_PAGE_SIZE);
  const pager: PageSlice<AuditItem> = {
    ...loaded,
    more: Boolean(page?.next),
    setPage: (next) => {
      if (next > loaded.pages && page?.next) {
        if (loading) return;
        void load(page.next).then(() => pageState.setRequested(next));
        return;
      }
      pageState.setRequested(next);
    },
  };

  return (
    <SectionCard
      id="audit"
      title="Activity log"
      note="Every change people make is recorded here, with who made it and when. This list can only be read, never changed."
      action={
        <div className={styles.filter}>
          <label htmlFor="audit-area">Show</label>
          <Select
            id="audit-area"
            value={area}
            onChange={(event) => {
              setPage(null);
              setOpen(null);
              setArea(event.target.value);
            }}
            options={AREAS}
          />
        </div>
      }
    >
      {error ? (
        <ErrorState
          message={error}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : null}
      {loading && !page ? <LoadingState label="Loading the activity log" /> : null}
      {page && page.items.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          message="Changes will appear here as they happen."
        />
      ) : null}

      {page && page.items.length > 0 ? (
        <ol className={styles.list} aria-label="Recent changes">
          {loaded.rows.map((item) => {
            const expanded = open === item.id;
            const { area: areaName, what } = splitAction(item.action);
            return (
              <li key={item.id} className={styles.item}>
                <span
                  className={styles.mark}
                  data-kind={item.created ? 'created' : 'changed'}
                  aria-hidden="true"
                >
                  <Icon name={item.created ? 'check' : 'tag'} />
                </span>
                <div className={styles.body}>
                  <span className={styles.title}>
                    {what}
                    {item.subject ? (
                      <span className={styles.subject}> · {item.subject}</span>
                    ) : null}
                  </span>
                  <p className={styles.meta}>
                    {[areaName, `by ${item.who}`, when(item.occurredAt, timezone)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {item.reason ? <p className={styles.meta}>Reason: {item.reason}</p> : null}
                </div>
                {item.changes.length > 0 ? (
                  <Button
                    className={styles.toggle}
                    variant="quiet"
                    size="sm"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : item.id)}
                  >
                    {expanded
                      ? 'Hide the details'
                      : item.created
                        ? 'What was recorded'
                        : 'What changed'}
                  </Button>
                ) : null}
                {expanded ? (
                  <dl className={styles.details}>
                    {item.changes.map((change) => (
                      <div key={change.field}>
                        <dt>{change.field}</dt>
                        <dd>
                          {item.created ? (
                            (change.after ?? 'Empty')
                          ) : (
                            <>
                              <span className={styles.before}>{change.before ?? 'Empty'}</span>
                              {' → '}
                              <strong>{change.after ?? 'Empty'}</strong>
                            </>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      <Pagination slice={pager} label="Activity log pages" noun="changes" />
    </SectionCard>
  );
}
