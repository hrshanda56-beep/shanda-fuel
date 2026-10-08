'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '../../../design-system/icons';
import { describeStations, toggleStation, type ReportFilters } from '../filters';
import { REPORT_PERIODS, REPORT_PERIOD_LABELS, type ReportPeriod } from '../period';

export type FilterStation = Readonly<{ id: string; code: string; name: string }>;

/**
 * Stations (one, several or all) and period. Changes are reported straight
 * away; the parent decides how to apply them (the page keeps them in the URL).
 */
export function ReportFilterBar({
  stations,
  filters,
  onChange,
}: {
  stations: readonly FilterStation[];
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
}) {
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const allIds = stations.map((station) => station.id);

  // Close the station list on an outside click or Escape.
  useEffect(() => {
    function close(event: Event) {
      const picker = pickerRef.current;
      if (!picker?.open) return;
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof MouseEvent && picker.contains(event.target as Node)) return;
      picker.open = false;
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  return (
    <div className="report-filter-bar" role="group" aria-label="Report filters">
      <div className="report-filter">
        <span className="field-label" aria-hidden="true">
          Stations
        </span>
        <details className="station-picker" ref={pickerRef}>
          <summary aria-label={`Stations: ${describeStations(filters.stationIds, stations)}`}>
            <span>{describeStations(filters.stationIds, stations)}</span>
            <Icon name="chevron-down" />
          </summary>
          <div className="station-picker-panel">
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
          </div>
        </details>
      </div>

      <div className="report-filter">
        <label className="field-label" htmlFor="report-period">
          Period
        </label>
        <select
          id="report-period"
          value={filters.period}
          onChange={(event) => onChange({ ...filters, period: event.target.value as ReportPeriod })}
        >
          {REPORT_PERIODS.map((period) => (
            <option key={period} value={period}>
              {REPORT_PERIOD_LABELS[period]}
            </option>
          ))}
        </select>
      </div>

      {filters.period === 'custom' ? (
        <>
          <div className="report-filter">
            <label className="field-label" htmlFor="report-from">
              From
            </label>
            <input
              id="report-from"
              type="date"
              value={filters.customFrom}
              max={filters.customTo || undefined}
              onChange={(event) => onChange({ ...filters, customFrom: event.target.value })}
            />
          </div>
          <div className="report-filter">
            <label className="field-label" htmlFor="report-to">
              To
            </label>
            <input
              id="report-to"
              type="date"
              value={filters.customTo}
              min={filters.customFrom || undefined}
              onChange={(event) => onChange({ ...filters, customTo: event.target.value })}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
