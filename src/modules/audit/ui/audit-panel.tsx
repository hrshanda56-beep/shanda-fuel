'use client';

import { useCallback, useEffect, useState } from 'react';

import { Select } from '@/design-system/forms';
import { Icon } from '@/design-system/icons';
import { Button, EmptyState, ErrorState, Field, LoadingState } from '@/design-system/primitives';

import type { AuditItem } from '../audit-view';

type Page = { items: AuditItem[]; next: string | null };

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

/** "Cash: submit cash handover" becomes the area ("Cash") and what happened ("submit cash handover"). */
function splitAction(action: string): { label: string; detail: string } {
  const colon = action.indexOf(': ');
  return colon < 0
    ? { label: action, detail: '' }
    : { label: `${action.slice(0, colon)}:`, detail: action.slice(colon + 2) };
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A readable history of what people changed: who, when, and the values before and after. It is
 * the signed audit log shown for people; it cannot be edited from here.
 */
export function AuditPanel({
  tenantId,
  stationId,
}: Readonly<{ tenantId: string; stationId?: string }>) {
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
        const params = new URLSearchParams({ tenantId, limit: '25' });
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

  return (
    <section aria-labelledby="audit-title" className="pg">
      <h3 id="audit-title" className="sr-only">
        Activity log
      </h3>
      <p className="pg-intro">
        Every change people make is recorded here, with who made it and when. This list can only be
        read, never changed.
      </p>
      <div className="pg-filter">
        <Field id="audit-area" label="Show">
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
        </Field>
      </div>

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
        <ol className="pg-timeline" aria-label="Recent changes">
          {page.items.map((item) => {
            const expanded = open === item.id;
            const { label, detail } = splitAction(item.action);
            return (
              <li key={item.id} className="pg-timeline-item">
                <span
                  className="pg-timeline-mark"
                  data-kind={item.created ? 'created' : 'changed'}
                  aria-hidden="true"
                >
                  <Icon name={item.created ? 'check' : 'tag'} />
                </span>
                <div className="pg-timeline-body">
                  <p className="pg-timeline-line">
                    <span>
                      <span className="pg-timeline-area">{label}</span>
                      {detail ? (
                        <>
                          {' '}
                          <strong>{detail}</strong>
                        </>
                      ) : null}
                    </span>
                    {item.subject ? <strong>{item.subject}</strong> : null}
                    <span className="pg-timeline-meta">
                      by {item.who}
                      <span className="pg-timeline-dot" aria-hidden="true">
                        •
                      </span>
                      {when(item.occurredAt)}
                    </span>
                  </p>
                  {item.reason ? <p className="pg-timeline-meta">Reason: {item.reason}</p> : null}
                  {item.changes.length > 0 ? (
                    <>
                      <Button
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
                      {expanded ? (
                        <dl className="pg-details">
                          {item.changes.map((change) => (
                            <div key={change.field}>
                              <dt>{change.field}</dt>
                              <dd>
                                {item.created ? (
                                  (change.after ?? 'Empty')
                                ) : (
                                  <>
                                    <span>{change.before ?? 'Empty'}</span>
                                    {' → '}
                                    <strong>{change.after ?? 'Empty'}</strong>
                                  </>
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {page?.next ? (
        <Button variant="secondary" disabled={loading} onClick={() => void load(page.next!)}>
          Show older changes
        </Button>
      ) : null}
    </section>
  );
}
