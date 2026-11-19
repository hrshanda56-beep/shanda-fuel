'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/design-system/primitives';
import styles from './sales-documents.module.css';

type Source =
  /** A document that is already saved: shown by its address. */
  | { kind: 'saved'; href: string }
  /** Answers that are not saved yet: sent to the preview route, which draws the same PDF. */
  | { kind: 'draft'; build: () => Record<string, unknown> | null };

const PHONE_WIDTH = 640;

/**
 * Shows a document exactly as it prints: the real PDF, in a frame. On a phone, where browsers do
 * not draw a PDF inside a page, it opens in a new tab instead. Unsaved answers go through a hidden
 * form aimed at the frame (so no script-made files are needed and the page's security rules stay
 * as they are).
 */
export function PrintPreview({
  source,
  label,
  startOpen = false,
}: {
  source: Source;
  label: string;
  /** Show the document straight away (hidden on phones by the style sheet). */
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [version, setVersion] = useState(0);
  const frameName = `print-preview-${useId().replace(/:/g, '')}`;

  const savedHref =
    source.kind === 'saved'
      ? `${source.href}${source.href.includes('?') ? '&' : '?'}inline=1`
      : null;

  // Sends the current answers to the preview route, with the reply aimed at the frame (or a new
  // tab). The form is built outside the page so it is never nested inside the wizard's own form.
  function sendDraft(target: string): boolean {
    if (source.kind !== 'draft') return false;
    const body = source.build();
    if (!body) return false;
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/api/sales-documents/preview';
    form.target = target;
    form.hidden = true;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(body);
    form.append(input);
    document.body.append(form);
    form.submit();
    form.remove();
    return true;
  }

  useEffect(() => {
    if (open && source.kind === 'draft') sendDraft(frameName);
    // Reloads the frame each time "Refresh" is pressed or the panel is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, version]);

  function openInTab() {
    if (source.kind === 'saved') window.open(savedHref!, '_blank', 'noopener');
    else sendDraft('_blank');
  }

  function toggle() {
    if (open) setOpen(false);
    else if (source.kind === 'saved' || source.build()) setOpen(true);
  }

  return (
    <div className={styles.previewBox}>
      <div className={styles.actions}>
        <Button variant="secondary" className={styles.frameOnly} onClick={toggle}>
          {open ? `Hide the printed ${label}` : 'See it as printed'}
        </Button>
        <Button variant="secondary" onClick={openInTab}>
          Open in a new tab
        </Button>
        {open && source.kind === 'draft' ? (
          <Button
            variant="quiet"
            className={styles.frameOnly}
            onClick={() => setVersion((v) => v + 1)}
          >
            Refresh
          </Button>
        ) : null}
      </div>
      {open ? (
        <iframe
          key={source.kind === 'saved' ? 'saved' : version}
          name={frameName}
          title={`The ${label} as it will print`}
          className={styles.previewFrame}
          src={savedHref ?? undefined}
        />
      ) : null}
    </div>
  );
}

/**
 * The saved document as it prints, in a side panel. It is a small preview until the pointer is over
 * it, then it grows over the page so the whole document can be read; moving away shrinks it again.
 * On a phone, where browsers cannot draw a PDF inside a page, only a link to a new tab is shown.
 */
export function PrintPanel({ href, label }: { href: string; label: string }) {
  const join = href.includes('?') ? '&' : '?';
  const view = `${href}${join}inline=1`;
  return (
    <aside className={styles.panelColumn} aria-label={`The ${label} as it will print`}>
      <div className={styles.panelSlot}>
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <strong>Printed {label}</strong>
            <span className={styles.actions}>
              <a className="button button-secondary" href={view} target="_blank" rel="noopener">
                Open
              </a>
              <a className="button button-secondary" href={href} download>
                PDF
              </a>
            </span>
          </header>
          <iframe
            title={`The ${label} as it will print`}
            className={styles.panelFrame}
            src={`${view}#toolbar=0&navpanes=0&view=FitH`}
          />
        </section>
      </div>
      <a
        className={`button button-secondary ${styles.phoneOnly}`}
        href={view}
        target="_blank"
        rel="noopener"
      >
        See it as printed
      </a>
    </aside>
  );
}
