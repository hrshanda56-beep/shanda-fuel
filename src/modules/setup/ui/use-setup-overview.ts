'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ConfigurationSetupOverview, SetupOverview } from '../contracts';

type Ready = Extract<SetupOverview, { status: 'ready' }>;
export type SetupOverviewResponse = Ready & { data?: ConfigurationSetupOverview };

export type SetupLoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; overview: SetupOverviewResponse };

/**
 * Load the server-computed setup overview. Context selectors are forwarded from
 * the page URL so the server resolves the same authorised tenant it rendered.
 */
export function useSetupOverview(): {
  state: SetupLoadState;
  reload: () => void;
  refresh: () => void;
} {
  const [state, setState] = useState<SetupLoadState>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/setup/overview${window.location.search}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 403) {
          setState({ kind: 'unavailable' });
          return;
        }
        if (!response.ok) {
          setState({ kind: 'error' });
          return;
        }
        const body = (await response.json()) as SetupOverviewResponse;
        if (body.status === 'ready') setState({ kind: 'ready', overview: body });
        else setState({ kind: body.status === 'error' ? 'error' : 'unavailable' });
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      }
    })();
    return () => controller.abort();
  }, [nonce]);

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    setNonce((value) => value + 1);
  }, []);

  /** Re-read without replacing the screen, so a success message stays visible. */
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return { state, reload, refresh };
}
