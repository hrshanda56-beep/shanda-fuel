'use client';

import { useCallback, useState } from 'react';

import { stepUpIsNeeded } from './step-up-needed';

/** Where a share or export is aimed: one report, its stations and a resolved period. */
export type ReportActionTarget = Readonly<{
  tenantId: string;
  slug: string;
  stationIds: readonly string[];
  period: string;
  fromDate: string;
  toDate: string;
}>;

export type ActionStatus = Readonly<{ tone: 'positive' | 'critical'; message: string }>;

/** Tells the Recent Activity list to reload after a real share or export. */
export const REPORT_ACTIVITY_CHANGED = 'reports:activity-changed';

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message || fallback;
  } catch {
    return fallback;
  }
}

function exportQuery(target: ReportActionTarget): string {
  const params = new URLSearchParams({
    report: target.slug,
    period: target.period,
    tenantId: target.tenantId,
    fromDate: target.fromDate,
    toDate: target.toDate,
  });
  if (target.stationIds.length > 0) params.set('stationIds', target.stationIds.join(','));
  return params.toString();
}

export function useReportActions() {
  const [status, setStatus] = useState<ActionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUpFor, setStepUpFor] = useState<ReportActionTarget | null>(null);

  const dismiss = useCallback(() => setStatus(null), []);

  const share = useCallback(async (target: ReportActionTarget, title: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch('/api/reports/share', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          report: target.slug,
          period: target.period,
          tenantId: target.tenantId,
          fromDate: target.fromDate,
          toDate: target.toDate,
          stationIds: target.stationIds.join(','),
        }),
      });
      if (!response.ok) {
        setStatus({
          tone: 'critical',
          message: await errorMessage(response, 'The link could not be created.'),
        });
        return;
      }
      const { path } = (await response.json()) as { path: string };
      const link = `${window.location.origin}${path}`;
      try {
        await navigator.clipboard.writeText(link);
        setStatus({
          tone: 'positive',
          message: `Private link copied. Only signed-in people who can view ${title} can open it.`,
        });
      } catch {
        setStatus({
          tone: 'positive',
          message: `Copy this private link: ${link}`,
        });
      }
      window.dispatchEvent(new Event(REPORT_ACTIVITY_CHANGED));
    } catch {
      setStatus({ tone: 'critical', message: 'The link could not be created. Try again.' });
    } finally {
      setBusy(false);
    }
  }, []);

  const exportCsv = useCallback(async (target: ReportActionTarget, afterStepUp = false) => {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/reports/export?${exportQuery(target)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) {
        const message = await errorMessage(response, 'The export could not be created.');
        // A missing step-up is recoverable: confirm identity once, then retry the same export.
        if (!afterStepUp && stepUpIsNeeded(response.status, message)) {
          setStepUpFor(target);
          return;
        }
        setStatus({ tone: 'critical', message });
        return;
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${target.slug}.csv`;
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus({ tone: 'positive', message: `Exported ${filename}` });
      window.dispatchEvent(new Event(REPORT_ACTIVITY_CHANGED));
    } catch {
      setStatus({ tone: 'critical', message: 'The export could not be created. Try again.' });
    } finally {
      setBusy(false);
    }
  }, []);

  const stepUp = stepUpFor
    ? {
        tenantId: stepUpFor.tenantId,
        onVerified: () => {
          setStepUpFor(null);
          void exportCsv(stepUpFor, true);
        },
        onCancel: () => setStepUpFor(null),
      }
    : null;

  return { status, busy, dismiss, share, exportCsv, stepUp };
}
