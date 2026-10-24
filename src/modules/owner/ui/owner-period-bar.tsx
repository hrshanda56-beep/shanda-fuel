'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { formatBusinessDate } from '@/design-system/formatters';
import { Button } from '@/design-system/primitives';
import {
  applyReportFilters,
  parseReportFilters,
  type ReportFilters,
} from '@/modules/reporting/filters';
import { REPORT_PERIOD_LABELS } from '@/modules/reporting/period';
import { ReportFilterBar } from '@/modules/reporting/ui/report-filter-bar';
import { useAvailableStations } from '@/modules/reporting/ui/use-available-stations';

/**
 * The period and station chooser for the owner screens. It uses the same filter panel and
 * address parameters as the Profit screen, so a chosen period carries between screens.
 */
export function OwnerPeriodBar({
  tenantId,
  range,
  children,
}: {
  tenantId: string;
  range: { fromDate: string; toDate: string } | null;
  children: (state: { pending: boolean }) => ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const filters = useMemo(() => parseReportFilters(search), [search]);
  const stations = useAvailableStations(tenantId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReportFilters>(filters);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active =
    (filters.stationIds.length > 0 ? 1 : 0) + (filters.period !== 'this-month' ? 1 : 0);

  return (
    <>
      <div className="profit-top">
        <p className="profit-period">
          {range ? <strong>{REPORT_PERIOD_LABELS[filters.period]}</strong> : null}
          {range ? (
            <span>
              {formatBusinessDate(range.fromDate)} to {formatBusinessDate(range.toDate)}
            </span>
          ) : null}
        </p>
        <div className="profit-filter-menu" ref={ref}>
          <Button
            variant="secondary"
            aria-expanded={open}
            aria-controls="owner-filter-panel"
            onClick={() => {
              if (!open) setDraft(filters);
              setOpen((value) => !value);
            }}
          >
            Filters{active > 0 ? ` · ${active}` : ''}
          </Button>
          {open ? (
            <div className="profit-filter-panel" id="owner-filter-panel">
              <ReportFilterBar stations={stations} filters={draft} onChange={setDraft} />
              <div className="profit-filter-actions">
                <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    const params = applyReportFilters(
                      new URLSearchParams(search.toString()),
                      draft,
                    );
                    startTransition(() => router.push(`${pathname}?${params.toString()}`));
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {children({ pending })}
    </>
  );
}
