'use client';

import { useState } from 'react';
import { Dropdown } from '../../../design-system/dropdown';
import { Modal } from '../../../design-system/modal';
import { resolveReportFilters } from '../filters';
import { REPORT_PERIODS, REPORT_PERIOD_LABELS, businessToday, type ReportPeriod } from '../period';

export type RowPeriod = { period: ReportPeriod; customFrom: string; customTo: string };

/**
 * Second step of a report action: the person has already chosen what to do (open, share,
 * download) and now chooses which period it covers. Starts from the period already chosen on the
 * page, so a person who is happy with it only has to confirm.
 */
export function ReportPeriodDialog({
  reportTitle,
  confirmLabel,
  initial,
  onConfirm,
  onClose,
}: {
  reportTitle: string;
  confirmLabel: string;
  initial: RowPeriod;
  onConfirm: (period: RowPeriod) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<RowPeriod>(initial);
  const range = resolveReportFilters(
    {
      stationIds: [],
      period: draft.period,
      customFrom: draft.customFrom,
      customTo: draft.customTo,
    },
    businessToday(),
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Choose a period"
      description={reportTitle}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!range}
            onClick={() => onConfirm(draft)}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="report-period-fields">
        <label className="field-label" htmlFor="report-period-choice">
          Period
        </label>
        <Dropdown
          id="report-period-choice"
          value={draft.period}
          options={REPORT_PERIODS.map((period) => ({
            value: period,
            label: REPORT_PERIOD_LABELS[period],
          }))}
          onValueChange={(period) => setDraft({ ...draft, period: period as ReportPeriod })}
        />
        {draft.period === 'custom' ? (
          <div className="report-row-dates">
            <label className="field-label" htmlFor="report-period-from">
              From
            </label>
            <input
              id="report-period-from"
              type="date"
              value={draft.customFrom}
              max={draft.customTo || undefined}
              onChange={(event) => setDraft({ ...draft, customFrom: event.target.value })}
            />
            <label className="field-label" htmlFor="report-period-to">
              To
            </label>
            <input
              id="report-period-to"
              type="date"
              value={draft.customTo}
              min={draft.customFrom || undefined}
              onChange={(event) => setDraft({ ...draft, customTo: event.target.value })}
            />
          </div>
        ) : null}
        {range ? (
          <p className="report-period-range">
            {range.fromDate === range.toDate
              ? range.fromDate
              : `${range.fromDate} to ${range.toDate}`}
          </p>
        ) : (
          <p className="report-period-range">Choose both dates to continue.</p>
        )}
      </div>
    </Modal>
  );
}
