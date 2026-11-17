'use client';

import { useUser } from '@clerk/nextjs';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';

import {
  clearDraft,
  draftStorageKey,
  loadDraft,
  purgeExpiredDrafts,
  saveDraft,
} from './local-draft';
import {
  hasOwnDraft,
  restorableSteps,
  snapshotChanges,
  type FieldDescription,
  type PageDraftValues,
} from './page-draft';

/** Sent when a change was saved, so what was typed is no longer a draft. */
const SAVED_EVENT = 'shanda-fuel:saved';

const BASE_VERSION = 'page';
const SAVE_AFTER_MS = 500;
const SAVE_SETTLE_MS = 800;
const OFFER_RETRY_MS = [400, 1200, 3000];

type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function pageFields(): FieldElement[] {
  const roots = document.querySelectorAll('#main-content, dialog, [role="dialog"]');
  const found = new Set<FieldElement>();
  roots.forEach((root) =>
    root.querySelectorAll<FieldElement>('input, textarea, select').forEach((el) => found.add(el)),
  );
  return [...found];
}

function describe(el: FieldElement): FieldDescription {
  const input = el instanceof HTMLInputElement ? el : null;
  const labelText = el.labels?.[0]?.textContent?.trim() ?? el.getAttribute('aria-label') ?? '';
  return {
    tag: el.tagName.toLowerCase() as FieldDescription['tag'],
    type: input ? input.type : el instanceof HTMLSelectElement ? 'select' : 'textarea',
    name: el.name ?? '',
    id: el.id ?? '',
    label: labelText,
    placeholder: 'placeholder' in el ? (el.placeholder ?? '') : '',
    autocomplete: el.getAttribute('autocomplete') ?? '',
    value: el.value,
    defaultValue: el instanceof HTMLSelectElement ? defaultSelectValue(el) : el.defaultValue,
    checked: input?.checked ?? false,
    defaultChecked: input?.defaultChecked ?? false,
    optedOut: el.closest('[data-no-page-draft]') !== null,
    disabled: el.disabled,
  };
}

function defaultSelectValue(el: FieldElement): string {
  if (!(el instanceof HTMLSelectElement)) return '';
  const chosen = [...el.options].find((option) => option.defaultSelected) ?? el.options[0];
  return chosen?.value ?? '';
}

/** React listens for these, so setting `.value` directly would be ignored. */
function applyValue(el: FieldElement, value: string | boolean) {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    if (el.checked !== value) el.click();
    return;
  }
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Announces every successful data-changing request from this app, without touching the feedback
 * layer's own wrapper around fetch.
 */
function useSaveAnnouncements() {
  useEffect(() => {
    const original = window.fetch;
    const wrapped: typeof fetch = async (input, init) => {
      const response = await original(input, init);
      try {
        const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
        const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
        const raw =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(raw, window.location.href);
        if (
          response.ok &&
          method !== 'GET' &&
          method !== 'HEAD' &&
          url.origin === window.location.origin &&
          !url.pathname.startsWith('/api/clerk') &&
          !url.pathname.startsWith('/api/auth')
        ) {
          window.dispatchEvent(new Event(SAVED_EVENT));
        }
      } catch {
        /* announcing is best effort */
      }
      return response;
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = original;
    };
  }, []);
}

const OFFER_STYLE: CSSProperties = {
  position: 'fixed',
  right: 'var(--space-4)',
  bottom: 'var(--space-4)',
  zIndex: 60,
  display: 'grid',
  gap: 'var(--space-3)',
  maxWidth: 'min(26rem, calc(100vw - 2 * var(--space-4)))',
  padding: 'var(--space-4)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-ink)',
  boxShadow: 'var(--shadow-lg)',
  fontSize: '0.9375rem',
  lineHeight: 1.4,
};

function Keeper() {
  useSaveAnnouncements();
  const { user, isLoaded } = useUser();
  const pathname = usePathname();
  const params = useSearchParams();
  const userId = isLoaded && !hasOwnDraft(pathname) ? (user?.id ?? null) : null;
  const key = userId
    ? draftStorageKey([
        'page',
        userId,
        params.get('tenantId'),
        params.get('stationId') ?? (params.get('allStations') ? 'all' : null),
        pathname,
      ])
    : null;
  const [offered, setOffer] = useState<{ key: string; values: PageDraftValues } | null>(null);
  const offer = offered && offered.key === key ? offered.values : null;
  const lastAction = useRef<Element | null>(null);

  useEffect(() => purgeExpiredDrafts(), []);

  // Offer a saved draft back once the page's fields have appeared. Never applied on its own.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timers = OFFER_RETRY_MS.map((delay) =>
      window.setTimeout(() => {
        if (cancelled) return;
        const saved = loadDraft<PageDraftValues>(key, BASE_VERSION)?.data;
        if (!saved) return;
        if (restorableSteps(pageFields().map(describe), saved).length > 0)
          setOffer({ key, values: saved });
      }, delay),
    );
    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
    };
  }, [key]);

  const persist = useCallback(
    (skipWithin: Element | null = null) => {
      if (!key) return;
      const elements = pageFields();
      const values = snapshotChanges(
        elements.map(describe),
        (index) => skipWithin !== null && skipWithin.contains(elements[index]!),
      );
      if (Object.keys(values).length === 0) clearDraft(key);
      else saveDraft(key, BASE_VERSION, values);
    },
    [key],
  );

  useEffect(() => {
    if (!key) return;
    let timer: number | undefined;
    function onEdit(event: Event) {
      if (!event.isTrusted) return;
      const target = event.target;
      if (!(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ))
        return;
      lastAction.current = target.closest('form, dialog, [role="dialog"]');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => persist(), SAVE_AFTER_MS);
    }
    function onAction(event: Event) {
      const target = event.target as Element | null;
      if (event.type === 'submit' || target?.closest?.('button')) {
        lastAction.current = target?.closest?.('form, dialog, [role="dialog"]') ?? null;
      }
    }
    // After a save, drop what was in the form that was saved but keep anything else half-typed.
    function onSaved() {
      const saved = lastAction.current;
      if (key) clearDraft(key);
      window.setTimeout(() => {
        if (saved === null) return;
        persist(saved.isConnected ? saved : null);
      }, SAVE_SETTLE_MS);
    }
    document.addEventListener('input', onEdit, true);
    document.addEventListener('change', onEdit, true);
    document.addEventListener('click', onAction, true);
    document.addEventListener('submit', onAction, true);
    window.addEventListener(SAVED_EVENT, onSaved);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('input', onEdit, true);
      document.removeEventListener('change', onEdit, true);
      document.removeEventListener('click', onAction, true);
      document.removeEventListener('submit', onAction, true);
      window.removeEventListener(SAVED_EVENT, onSaved);
    };
  }, [key, persist]);

  if (!offer || !key) return null;

  function restore() {
    const elements = pageFields();
    for (const step of restorableSteps(elements.map(describe), offer!)) {
      applyValue(elements[step.index]!, step.value);
    }
    setOffer(null);
  }

  return (
    <div className="draft-offer" role="status" aria-live="polite" style={OFFER_STYLE}>
      <p style={{ margin: 0 }}>
        <strong>You have unsaved entries on this page.</strong> They were typed here earlier and
        were never saved.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <button type="button" className="button button-primary" onClick={restore}>
          Restore them
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            clearDraft(key);
            setOffer(null);
          }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/**
 * Keeps unsaved typing on this device so a reload does not lose it (offline drafts, stage 1). It is
 * kept per signed-in person, station and page; offered back, never applied silently; and dropped
 * after 24 hours or once the change is saved. Screens with their own draft are skipped (`hasOwnDraft`), and any area can opt out with
 * `data-no-page-draft`; password, one-time-code and card fields are never kept.
 */
export function PageDraftKeeper() {
  return (
    <Suspense fallback={null}>
      <Keeper />
    </Suspense>
  );
}
