'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../../design-system/icons';
import { toggleStation, type ReportFilters } from '../filters';
import { REPORT_PERIODS, REPORT_PERIOD_LABELS } from '../period';
import type { FilterStation } from './report-filter-bar';

/**
 * Every report filter (stations, period, custom dates) behind one Filters button, the
 * same button as the Reports list. Changes apply straight away and the menu stays open.
 */
export function ReportFiltersMenu({
  stations,
  filters,
  onChange,
}: {
  stations: readonly FilterStation[];
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const allIds = stations.map((station) => station.id);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="dropdown filters-menu" ref={rootRef} data-open={open || undefined}>
      <button
        type="button"
        className="dropdown-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Report filters"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="filter" size="sm" />
        <span className="dropdown-value">Filters</span>
        <Icon name="chevron-down" size="sm" />
      </button>
      {open ? (
        <div className="filters-panel" role="dialog" aria-label="Report filters">
          <fieldset className="filters-group">
            <legend>Stations</legend>
            <label className="station-option">
              <input
                type="checkbox"
                checked={filters.stationIds.length === 0}
                onChange={() => onChange({ ...filters, stationIds: [] })}
              />
              <span>All stations</span>
            </label>
            {stations.map((station) => (
              <label className="station-option" key={station.id}>
                <input
                  type="checkbox"
                  checked={filters.stationIds.includes(station.id)}
                  onChange={() =>
                    onChange({
                      ...filters,
                      stationIds: toggleStation(
                        filters.stationIds.length === 0 ? allIds : filters.stationIds,
                        station.id,
                        allIds,
                      ),
                    })
                  }
                />
                <span>
                  {station.name} <span className="station-option-code">{station.code}</span>
                </span>
              </label>
            ))}
            {stations.length === 0 ? (
              <p className="station-option-empty">No stations available.</p>
            ) : null}
          </fieldset>

          <fieldset className="filters-group">
            <legend>Period</legend>
            {REPORT_PERIODS.map((period) => (
              <label className="station-option" key={period}>
                <input
                  type="radio"
                  name="report-period"
                  checked={filters.period === period}
                  onChange={() => onChange({ ...filters, period })}
                />
                <span>{REPORT_PERIOD_LABELS[period]}</span>
              </label>
            ))}
            {filters.period === 'custom' ? (
              <div className="filters-dates">
                <label>
                  <span className="field-label">From</span>
                  <input
                    type="date"
                    value={filters.customFrom}
                    max={filters.customTo || undefined}
                    onChange={(event) => onChange({ ...filters, customFrom: event.target.value })}
                  />
                </label>
                <label>
                  <span className="field-label">To</span>
                  <input
                    type="date"
                    value={filters.customTo}
                    min={filters.customFrom || undefined}
                    onChange={(event) => onChange({ ...filters, customTo: event.target.value })}
                  />
                </label>
              </div>
            ) : null}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
