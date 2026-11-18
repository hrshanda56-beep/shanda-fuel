'use client';

import { useRef, useState } from 'react';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import { friendlyError, isStepUpMessage } from '../format';

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export type CommandResult = Record<string, unknown>;

/**
 * Sends one document command. A retry of the same request keeps its key, so a dropped connection
 * never records twice. If the server asks for a fresh identity check, the check is shown and the
 * same request is sent again once it passes.
 */
export function useSalesCommand(tenantId: string) {
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);

  async function send(
    body: Record<string, unknown>,
    onDone: (result: CommandResult) => void,
    confirmed = false,
  ): Promise<void> {
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: newKey() };
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/sales-documents/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': attempt.current.key },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as CommandResult;
      if (!response.ok) {
        const nested = (result.error as { message?: unknown } | undefined)?.message;
        const text = typeof result.message === 'string' ? result.message : nested;
        throw new Error(typeof text === 'string' ? text : 'This could not be saved.');
      }
      attempt.current = null;
      onDone(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'This could not be saved.';
      if (!confirmed && isStepUpMessage(message)) {
        setRetry(() => () => void send(body, onDone, true));
      } else {
        setError(friendlyError(message, 'This could not be saved.'));
      }
    } finally {
      setBusy(false);
    }
  }

  const stepUp = (
    <StepUpDialog
      open={retry !== null}
      tenantId={tenantId}
      description="This change needs a fresh identity check first. Nothing is saved until you confirm."
      confirmLabel="Confirm and continue"
      cancelledMessage="The check was cancelled or did not pass. Nothing was saved."
      onVerified={() => {
        const run = retry;
        setRetry(null);
        run?.();
      }}
      onCancel={() => {
        setRetry(null);
        setError('The identity check was cancelled, so nothing was saved.');
      }}
    />
  );

  return { send, busy, error, setError, stepUp };
}
