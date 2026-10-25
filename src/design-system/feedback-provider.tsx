'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ConfirmDialog, type ConfirmTone } from './dialogs';

/* Global feedback --------------------------------------------------------
 * One place that tells people the app heard them:
 *  - a thin progress bar and "Still working…" note while a page or request is in flight,
 *  - toasts for "Saved" / "Could not save",
 *  - a promise-based confirmation dialog that replaces the browser's window.confirm.
 * Mounted once in the root layout; nothing on a page has to opt in for the progress bar.
 */

export type ToastTone = 'success' | 'error' | 'info';
type Toast = { id: number; tone: ToastTone; message: string };

export type ConfirmRequest = {
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  tone?: ConfirmTone;
};

type Feedback = {
  toast: (tone: ToastTone, message: string) => void;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
};

const FeedbackContext = createContext<Feedback | null>(null);

const STANDALONE_FEEDBACK: Feedback = {
  toast: () => {},
  confirm: (request) =>
    Promise.resolve(
      window.confirm(typeof request.consequence === 'string' ? request.consequence : request.title),
    ),
};

function useFeedback(): Feedback {
  // Without a provider (isolated renders, tests) toasts are silent and confirmations
  // fall back to the browser's own question, so a screen never breaks.
  return useContext(FeedbackContext) ?? STANDALONE_FEEDBACK;
}

export function useToast() {
  const { toast } = useFeedback();
  return useMemo(
    () => ({
      success: (message: string) => toast('success', message),
      error: (message: string) => toast('error', message),
      info: (message: string) => toast('info', message),
    }),
    [toast],
  );
}

/** `if (!(await confirm({ ... }))) return;` */
export function useConfirm() {
  return useFeedback().confirm;
}

/** Wait this long before showing anything, so quick changes do not flicker. */
const SHOW_AFTER_MS = 150;
/** After this long, say so out loud. */
const STILL_WORKING_AFTER_MS = 4000;
/** A page change that never reports back must not leave the bar up forever. */
const GIVE_UP_AFTER_MS = 20000;

function isPrefetch(input: RequestInfo | URL, init?: RequestInit): boolean {
  const headers = new Headers(
    init?.headers ??
      (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined),
  );
  return headers.has('next-router-prefetch');
}

function isTrackedRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    // Clerk's session polling is background noise, not something the person asked for.
    if (url.origin !== window.location.origin || url.pathname.startsWith('/api/clerk'))
      return false;
    return !isPrefetch(input, init);
  } catch {
    return false;
  }
}

type SaveOutcome = 'saved' | 'rejected' | 'failed';

/** Only requests that change data are announced; reads stay quiet. */
function saveRequestPath(input: RequestInfo | URL, init?: RequestInit): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (
      init?.method ??
      (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (method === 'GET' || method === 'HEAD') return null;
    const path = new URL(raw, window.location.href).pathname;
    // Sign-in and step-up checks have their own screens; uploads report themselves.
    if (path.startsWith('/api/auth') || path.startsWith('/api/documents')) return null;
    return path;
  } catch {
    return null;
  }
}

/** These screens already say exactly what happened, so a generic "Saved" would repeat them. */
const OWN_SUCCESS_MESSAGE_PATHS = ['/api/staff/commands'];

function RouteChangeWatcher({ onSettled }: { onSettled: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    onSettled();
  }, [pathname, search, onSettled]);
  return null;
}

function useBusyTracking(onSave: (outcome: SaveOutcome, path: string) => void) {
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const requests = useRef(0);
  const navigating = useRef(false);
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const slowTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const sync = useCallback(() => {
    const working = requests.current > 0 || navigating.current;
    if (working) {
      showTimer.current ??= setTimeout(() => setBusy(true), SHOW_AFTER_MS);
      slowTimer.current ??= setTimeout(() => setSlow(true), STILL_WORKING_AFTER_MS);
      return;
    }
    clearTimeout(showTimer.current);
    clearTimeout(slowTimer.current);
    clearTimeout(giveUpTimer.current);
    showTimer.current = slowTimer.current = giveUpTimer.current = undefined;
    setBusy(false);
    setSlow(false);
  }, []);

  const startNavigation = useCallback(() => {
    navigating.current = true;
    clearTimeout(giveUpTimer.current);
    giveUpTimer.current = setTimeout(() => {
      navigating.current = false;
      sync();
    }, GIVE_UP_AFTER_MS);
    sync();
  }, [sync]);

  const endNavigation = useCallback(() => {
    navigating.current = false;
    sync();
  }, [sync]);

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (!isTrackedRequest(input, init)) return originalFetch(input, init);
      requests.current += 1;
      sync();
      const savePath = saveRequestPath(input, init);
      try {
        const response = await originalFetch(input, init);
        if (savePath) {
          onSaveRef.current(
            response.ok ? 'saved' : response.status >= 500 ? 'failed' : 'rejected',
            savePath,
          );
        }
        return response;
      } catch (error) {
        if (savePath) onSaveRef.current('failed', savePath);
        throw error;
      } finally {
        requests.current = Math.max(0, requests.current - 1);
        sync();
      }
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [sync]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      startNavigation();
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [startNavigation]);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-busy', busy);
  }, [busy]);

  return { busy, slow, endNavigation };
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const toastRef = useRef<(tone: ToastTone, message: string) => void>(() => {});
  const { busy, slow, endNavigation } = useBusyTracking((outcome, path) => {
    if (outcome === 'saved' && !OWN_SUCCESS_MESSAGE_PATHS.includes(path)) {
      toastRef.current('success', 'Saved');
    } else if (outcome === 'failed') {
      toastRef.current('error', 'That did not go through. Check your connection and try again.');
    }
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const [pending, setPending] = useState<
    (ConfirmRequest & { resolve: (answer: boolean) => void }) | null
  >(null);

  const toast = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      tone === 'error' ? 8000 : 4500,
    );
  }, []);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const confirm = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setPending((previous) => {
          previous?.resolve(false);
          return { ...request, resolve };
        });
      }),
    [],
  );

  const answer = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      <Suspense fallback={null}>
        <RouteChangeWatcher onSettled={endNavigation} />
      </Suspense>
      {children}
      <div className="progress-bar" data-active={busy || undefined} aria-hidden="true" />
      <div className="feedback-region" aria-live="polite">
        {slow ? (
          <p className="feedback-slow" role="status">
            <span className="spinner" aria-hidden="true" /> Still working…
          </p>
        ) : null}
        {toasts.map((item) => (
          <p
            key={item.id}
            className="toast"
            data-tone={item.tone}
            role={item.tone === 'error' ? 'alert' : 'status'}
          >
            <span>{item.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== item.id))}
            >
              ×
            </button>
          </p>
        ))}
      </div>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => answer(false)}
        onConfirm={() => answer(true)}
        title={pending?.title ?? ''}
        consequence={pending?.consequence ?? ''}
        confirmLabel={pending?.confirmLabel ?? 'Confirm'}
        tone={pending?.tone ?? 'default'}
      />
    </FeedbackContext.Provider>
  );
}
