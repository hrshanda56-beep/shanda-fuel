'use client';

import { useCallback, useEffect, useState } from 'react';

import type { SetupOverview, SetupStationOption } from '../contracts';

export type CommandResult<T = Record<string, unknown>> =
  { ok: true; data: T } | { ok: false; status: number; message: string };

/** Plain-language message for an API failure; never exposes internals. */
export function friendlyMessage(status: number, serverMessage?: string): string {
  if (status === 401) return 'Your session has ended. Sign in again.';
  if (status === 403) return 'You do not have permission to do this.';
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on our side. Nothing was saved. Try again.';
  if (serverMessage && status !== 400) return serverMessage;
  if (status === 400) return 'Some values are missing or not valid. Check the form and try again.';
  return 'That could not be completed.';
}

export async function sendCommand<T = Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<CommandResult<T>> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: friendlyMessage(response.status, payload?.message),
      };
    }
    return { ok: true, data: (payload ?? {}) as T };
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'Could not reach the server. Check your connection. Nothing was saved.',
    };
  }
}

export const SETUP_COMMANDS = '/api/setup/commands';
export const INVENTORY_COMMANDS = '/api/inventory/commands';
export const FORECOURT_COMMANDS = '/api/forecourt/commands';

export type SetupLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; forbidden: boolean }
  | { status: 'ready'; data: SetupOverview };

export function useSetupOverview(tenantId: string, stationId: string) {
  const [state, setState] = useState<SetupLoad>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/setup/overview?tenantId=${encodeURIComponent(tenantId)}&stationId=${encodeURIComponent(stationId)}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        const payload = (await response.json().catch(() => null)) as {
          data?: SetupOverview;
          message?: string;
        } | null;
        if (!response.ok || !payload?.data) {
          setState({
            status: 'error',
            forbidden: response.status === 403,
            message: friendlyMessage(response.status, payload?.message),
          });
          return;
        }
        setState({ status: 'ready', data: payload.data });
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setState({
          status: 'error',
          forbidden: false,
          message: 'Could not load setup. Check your connection and try again.',
        });
      }
    })();
    return () => controller.abort();
  }, [tenantId, stationId, nonce]);

  const reload = useCallback(() => {
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    setNonce((value) => value + 1);
  }, []);
  return { state, reload };
}

/** Strip insignificant trailing zeros from an exact decimal string (no float maths). */
export function trimDecimal(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

export function formatLitres(value: string | null | undefined): string {
  const trimmed = trimDecimal(value);
  if (!trimmed) return 'Not entered';
  const [whole = '', fraction] = trimmed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${fraction ? `${grouped}.${fraction}` : grouped} L`;
}

export type StationsLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: readonly SetupStationOption[] };

export function useSetupStations(tenantId: string): StationsLoad & { reload: () => void } {
  const [state, setState] = useState<StationsLoad>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/setup/stations?tenantId=${encodeURIComponent(tenantId)}`,
          {
            signal: controller.signal,
            cache: 'no-store',
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          data?: SetupStationOption[];
          message?: string;
        } | null;
        if (!response.ok || !payload?.data) {
          setState({
            status: 'error',
            message: friendlyMessage(response.status, payload?.message),
          });
          return;
        }
        setState({ status: 'ready', data: payload.data });
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setState({ status: 'error', message: 'Could not load stations. Check your connection.' });
      }
    })();
    return () => controller.abort();
  }, [tenantId, nonce]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setNonce((value) => value + 1);
  }, []);
  return { ...state, reload };
}
