'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '../../../../design-system/primitives';
import { Select } from '../../../../design-system/forms';
import {
  NARROWING_ALL_LABELS,
  NARROWING_LABELS,
  NARROWING_PARAMS,
  applyNarrowing,
} from '../narrowing';
import type { TableReportFilterKey } from '../definitions';
import type { FilterOptions } from '../read-options';
import { applyReportFilters, parseReportFilters, type ReportFilters } from '../../filters';
import { ReportFiltersMenu } from '../../ui/report-filters-menu';
import { ReportActionStatus } from '../../ui/report-action-status';
import { stepUpIsNeeded } from '../../ui/step-up-needed';
import { useAvailableStations } from '../../ui/use-available-stations';
import type { ActionStatus } from '../../ui/use-report-actions';

type Format = 'xlsx' | 'pdf' | 'csv';

const FORMAT_LABELS: Record<Format, string> = {
  xlsx: 'Download for Excel',
  pdf: 'Download PDF',
  csv: 'Download CSV',
};

/**
 * Choose the stations and dates, then download. Choosing changes the page address, so the
 * table below reloads for the new choice and the link can be shared.
 */
export function TableReportFilteredToolbar({
  tenantId,
  slug,
  period,
  fromDate,
  toDate,
  filterKeys,
  filterOptions,
}: {
  tenantId: string;
  slug: string;
  period: string;
  fromDate: string;
  toDate: string;
  /** The extra filters this report understands. */
  filterKeys: readonly TableReportFilterKey[];
  filterOptions: FilterOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseReportFilters(searchParams), [searchParams]);
  const stations = useAvailableStations(tenantId);
  const [status, setStatus] = useState<ActionStatus | null>(null);
  const [busy, setBusy] = useState<Format | null>(null);
  const [stepUpFor, setStepUpFor] = useState<Format | null>(null);

  function changeFilters(next: ReportFilters) {
    const params = applyReportFilters(new URLSearchParams(searchParams.toString()), next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function changeNarrowing(key: TableReportFilterKey, value: string) {
    const current: Partial<Record<TableReportFilterKey, string>> = {};
    for (const each of filterKeys) {
      const existing = searchParams.get(NARROWING_PARAMS[each]);
      if (existing) current[each] = existing;
    }
    if (value) current[key] = value;
    else delete current[key];
    const params = applyNarrowing(new URLSearchParams(searchParams.toString()), current);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function download(format: Format, afterStepUp = false) {
    setBusy(format);
    setStatus(null);
    const query = new URLSearchParams({ report: slug, period, tenantId, fromDate, toDate, format });
    if (filters.stationIds.length > 0) query.set('stationIds', filters.stationIds.join(','));
    for (const key of filterKeys) {
      const chosen = searchParams.get(NARROWING_PARAMS[key]);
      if (chosen) query.set(NARROWING_PARAMS[key], chosen);
    }
    try {
      const response = await fetch(`/api/reports/export?${query.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) {
        let message = 'The download could not be created.';
        try {
          message = ((await response.json()) as { message?: string }).message || message;
        } catch {
          // Keep the plain message.
        }
        if (!afterStepUp && stepUpIsNeeded(response.status, message)) {
          setStepUpFor(format);
          return;
        }
        setStatus({ tone: 'critical', message });
        return;
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${slug}.${format}`;
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus({ tone: 'positive', message: `Downloaded ${filename}` });
    } catch {
      setStatus({ tone: 'critical', message: 'The download could not be created. Try again.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="table-report-toolbar"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}
    >
      <ReportFiltersMenu stations={stations} filters={filters} onChange={changeFilters} />
      {filterKeys.map((key) => (
        <label
          key={key}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}
        >
          <span className="field-hint">{NARROWING_LABELS[key]}</span>
          <Select
            aria-label={NARROWING_LABELS[key]}
            value={searchParams.get(NARROWING_PARAMS[key]) ?? ''}
            onChange={(event) => changeNarrowing(key, event.target.value)}
            options={[
              { value: '', label: NARROWING_ALL_LABELS[key] },
              ...(filterOptions[key] ?? []).map((option) => ({
                value: option.id,
                label: option.label,
              })),
            ]}
          />
        </label>
      ))}
      <div
        className="table-report-downloads"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
      >
        {(Object.keys(FORMAT_LABELS) as Format[]).map((format) => (
          <Button
            key={format}
            variant={format === 'xlsx' ? 'primary' : 'secondary'}
            loading={busy === format}
            disabled={busy !== null}
            onClick={() => void download(format)}
          >
            {FORMAT_LABELS[format]}
          </Button>
        ))}
      </div>
      <ReportActionStatus
        status={status}
        onDismiss={() => setStatus(null)}
        stepUp={
          stepUpFor
            ? {
                tenantId,
                onVerified: () => {
                  const format = stepUpFor;
                  setStepUpFor(null);
                  void download(format, true);
                },
                onCancel: () => setStepUpFor(null),
              }
            : null
        }
      />
    </div>
  );
}
