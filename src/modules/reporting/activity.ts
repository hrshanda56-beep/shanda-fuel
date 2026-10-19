/**
 * Report share and export events, as stored in the existing signed audit log
 * (`platform.security_events`) and as shown in Recent Activity. Only these two
 * actions are recorded; opening a report or changing filters is not. The labels
 * are stored with the event so the list never has to show raw ids.
 * Pure; no UI or database code.
 */
import { findReport } from './catalog';
import { isReportPeriod, REPORT_PERIOD_LABELS } from './period';

export const REPORT_EVENT_CODES = {
  SHARED: 'REPORT.SHARED',
  EXPORTED: 'REPORT.EXPORTED',
} as const;

export type ReportEventKind = keyof typeof REPORT_EVENT_CODES;

export type ReportEventMetadata = Readonly<{
  reportSlug: string;
  reportTitle: string;
  periodLabel: string;
  fromDate: string;
  toDate: string;
  stationLabel: string;
  stationCount: number;
  exportFormat?: 'csv' | 'pdf' | 'xlsx';
}>;

export type ReportActivityItem = Readonly<{
  id: string;
  kind: ReportEventKind;
  reportSlug: string;
  headline: string;
  detail: string;
  occurredAt: string;
}>;

export function periodLabel(period: string | undefined, fromDate: string, toDate: string): string {
  if (period && period !== 'custom' && isReportPeriod(period)) return REPORT_PERIOD_LABELS[period];
  return `${fromDate} to ${toDate}`;
}

/** "All stations", one or two names, or a count. */
export function stationScopeLabel(names: readonly string[]): string {
  if (names.length === 0) return 'All stations';
  if (names.length <= 2) return [...names].sort().join(' and ');
  return `${names.length} stations`;
}

export function buildReportEventMetadata(input: {
  slug: string;
  period?: string;
  fromDate: string;
  toDate: string;
  stationNames: readonly string[];
  exportFormat?: 'csv' | 'pdf' | 'xlsx';
}): ReportEventMetadata {
  const report = findReport(input.slug);
  if (!report) throw new Error(`Unknown report "${input.slug}"`);
  return {
    reportSlug: report.slug,
    reportTitle: report.title,
    periodLabel: periodLabel(input.period, input.fromDate, input.toDate),
    fromDate: input.fromDate,
    toDate: input.toDate,
    stationLabel: stationScopeLabel(input.stationNames),
    stationCount: input.stationNames.length,
    ...(input.exportFormat ? { exportFormat: input.exportFormat } : {}),
  };
}

type StoredEvent = {
  id: string;
  eventCode: string;
  occurredAt: string;
  metadata: Partial<ReportEventMetadata> | null | undefined;
};

/** Turns a stored event into a list item; anything unrecognised is dropped. */
export function toActivityItem(event: StoredEvent): ReportActivityItem | null {
  const kind = (Object.keys(REPORT_EVENT_CODES) as ReportEventKind[]).find(
    (candidate) => REPORT_EVENT_CODES[candidate] === event.eventCode,
  );
  const meta = event.metadata;
  if (!kind || !meta?.reportTitle || !meta.reportSlug) return null;
  return {
    id: event.id,
    kind,
    reportSlug: meta.reportSlug,
    headline: `${meta.reportTitle} ${kind === 'EXPORTED' ? 'exported' : 'link shared'}`,
    detail: [meta.periodLabel, meta.stationLabel].filter(Boolean).join(' · '),
    occurredAt: event.occurredAt,
  };
}

/** Short relative time for the list; falls back to the date for older events. */
export function relativeTime(occurredAt: string, now: Date = new Date()): string {
  const then = new Date(occurredAt);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return then.toISOString().slice(0, 10);
}
