'use client';

import { Notice } from '../../../design-system/feedback';
import type { ActionStatus } from './use-report-actions';

/** Announces the outcome of a share or export; the region exists before any message. */
export function ReportActionStatus({
  status,
  onDismiss,
}: {
  status: ActionStatus | null;
  onDismiss: () => void;
}) {
  return (
    <div role="status" aria-live="polite" className="report-action-status">
      {status ? (
        <Notice tone={status.tone} onDismiss={onDismiss}>
          {status.message}
        </Notice>
      ) : null}
    </div>
  );
}
