'use client';

import { Notice } from '../../../design-system/feedback';
import { StepUpDialog } from '../../setup/ui/step-up-dialog';
import type { ActionStatus } from './use-report-actions';

/** Announces the outcome of a share or export; the region exists before any message. */
export function ReportActionStatus({
  status,
  onDismiss,
  stepUp = null,
}: {
  status: ActionStatus | null;
  onDismiss: () => void;
  stepUp?: { tenantId: string; onVerified: () => void; onCancel: () => void } | null;
}) {
  return (
    <div role="status" aria-live="polite" className="report-action-status">
      {status ? (
        <Notice tone={status.tone} onDismiss={onDismiss}>
          {status.message}
        </Notice>
      ) : null}
      <StepUpDialog
        open={stepUp !== null}
        tenantId={stepUp?.tenantId ?? ''}
        onVerified={stepUp?.onVerified ?? (() => undefined)}
        onCancel={stepUp?.onCancel ?? (() => undefined)}
        description="Exporting a report needs a fresh identity check. Nothing is downloaded until you confirm."
        confirmLabel="Confirm and export"
        cancelledMessage="The check was cancelled or did not pass. Nothing was exported."
      />
    </div>
  );
}
