'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from './icons';
import { acquireModalLock } from './modal-lock';

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions row. Place the primary action last; it renders rightmost on wide screens. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /**
   * `drawer` slides in from the inline start edge (Product Shell menu).
   * `side` is a full-height task sheet at the inline end edge on wider
   * screens and a full-screen sheet on phones (record/receive forms).
   */
  presentation?: 'dialog' | 'sheet' | 'drawer' | 'side' | 'page';
  /**
   * With `presentation="page"` the content replaces the page body, in one centred card under a
   * "← All ..." link, exactly like the quotation and invoice guide. This is the text after the arrow.
   */
  backLabel?: string;
  /** `alertdialog` for confirmations that interrupt a workflow. */
  role?: 'dialog' | 'alertdialog';
  /** When false, Escape and backdrop clicks do nothing (e.g. while a command is pending). */
  dismissible?: boolean;
  /** Element to focus on open. Defaults to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Fallback focus target on close when the opener did not keep focus (e.g. Safari clicks). */
  returnFocus?: () => HTMLElement | null | undefined;
  /** Content leading the title, e.g. a tone icon. */
  leading?: ReactNode;
  hideCloseButton?: boolean;
  className?: string;
};

/**
 * Controlled accessible modal. Moves focus in, contains Tab, closes on
 * Escape, makes the rest of the page inert, locks scroll, and restores focus
 * to the opener. Renders centred on tablet/desktop and bottom-anchored on
 * phones; `presentation="sheet"` always renders as a bottom sheet and
 * `presentation="drawer"` as a full-height panel from the start edge.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  presentation = 'dialog',
  role = 'dialog',
  dismissible = true,
  initialFocusRef,
  returnFocus,
  leading,
  hideCloseButton = false,
  backLabel,
  className = '',
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const instanceId = useId().replace(/:/g, '');
  const titleId = `${slugify(title)}-${instanceId}-title`;
  const descriptionId = description ? `${slugify(title)}-${instanceId}-description` : undefined;

  // Keep latest callbacks without re-running the open/close effect.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const returnFocusRef = useRef(returnFocus);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
    returnFocusRef.current = returnFocus;
  });

  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const active = document.activeElement;
    const restoreTarget =
      active instanceof HTMLElement && active !== document.body
        ? active
        : (returnFocusRef.current?.() ?? null);

    // One shared lock: overlapping modals can close in any order without
    // leaving the page unscrollable or inert.
    // A page-style flow sits inside the page itself, so nothing is locked behind it.
    const releaseLock =
      presentation === 'page' ? () => {} : acquireModalLock(overlay, document.body);

    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel) (initialFocusRef?.current ?? findInitialFocus(panel)).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dismissibleRef.current) onCloseRef.current();
        return;
      }
      const panel = panelRef.current;
      if (event.key !== 'Tab' || !panel) return;

      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      releaseLock();
      const target = restoreTarget?.isConnected ? restoreTarget : returnFocusRef.current?.();
      window.requestAnimationFrame(() => target?.focus());
    };
    // initialFocusRef is a ref object; its identity is stable for the modal's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pageMode = presentation === 'page' && open;
  // A guided flow replaces the page body while it is open; the page behind it stays mounted.
  useEffect(() => {
    if (!pageMode) return;
    const main = document.getElementById('main-content');
    main?.setAttribute('data-wizard-page', 'true');
    return () => main?.removeAttribute('data-wizard-page');
  }, [pageMode]);

  if (!open || typeof document === 'undefined') return null;

  if (presentation === 'page') {
    const host = document.getElementById('main-content') ?? document.body;
    return createPortal(
      <div ref={overlayRef} className="wizard-page" data-modal-overlay="true">
        <div className="wizard-page-back">
          <button
            type="button"
            className="button button-quiet button-sm"
            onClick={() => onCloseRef.current()}
            disabled={!dismissible}
          >
            ← {backLabel ? `All ${backLabel}` : 'Back'}
          </button>
        </div>
        <section
          ref={panelRef}
          className={`card wizard-page-card ${className}`.trim()}
          role={role}
          aria-label={title}
          tabIndex={-1}
        >
          {children}
          {footer ? <div className="dialog-footer">{footer}</div> : null}
        </section>
      </div>,
      host,
    );
  }

  const sheet = presentation === 'sheet';
  const drawer = presentation === 'drawer';
  const side = presentation === 'side';

  return createPortal(
    <div
      ref={overlayRef}
      className={`dialog-backdrop ${sheet ? 'dialog-backdrop-sheet' : ''} ${drawer ? 'dialog-backdrop-drawer' : ''} ${side ? 'dialog-backdrop-side' : ''}`.trim()}
      data-modal-overlay="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissibleRef.current) onCloseRef.current();
      }}
    >
      <section
        ref={panelRef}
        className={`dialog-panel ${size !== 'md' ? `dialog-${size}` : ''} ${sheet ? 'bottom-sheet' : ''} ${drawer ? 'drawer' : ''} ${side ? 'side-sheet' : ''} ${className}`.trim()}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        {sheet ? <span className="sheet-handle" aria-hidden="true" /> : null}
        <div className="dialog-heading">
          <div>
            {leading}
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {hideCloseButton ? null : (
            <button
              className="dialog-close"
              type="button"
              onClick={() => onCloseRef.current()}
              disabled={!dismissible}
              aria-label={`Close ${title}`}
            >
              <Icon name="close" size="md" />
            </button>
          )}
        </div>
        {children !== undefined && children !== null ? (
          <div className="dialog-body">{children}</div>
        ) : null}
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </section>
    </div>,
    document.body,
  );
}

/**
 * Initial focus order: an explicit `data-autofocus` element, then the first
 * control in the body (so forms start where the user types), then the first
 * focusable anywhere (usually Close), then the panel itself.
 */
function findInitialFocus(panel: HTMLElement): HTMLElement {
  return (
    panel.querySelector<HTMLElement>('[data-autofocus]') ??
    panel.querySelector('.dialog-body')?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
    panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
    panel
  );
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
