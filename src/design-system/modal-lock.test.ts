import { describe, expect, it } from 'vitest';

import { acquireModalLock, type LockBody } from './modal-lock';

class FakeElement {
  inert = false;
  private attributes = new Map<string, string>();
  constructor(
    readonly name: string,
    ariaHidden?: string,
  ) {
    if (ariaHidden !== undefined) this.attributes.set('aria-hidden', ariaHidden);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

function page() {
  const app = new FakeElement('app');
  const toast = new FakeElement('toast', 'false');
  const children: FakeElement[] = [app, toast];
  const body: LockBody & { children: FakeElement[] } = { children, style: { overflow: 'auto' } };
  const open = (name: string) => {
    const overlay = new FakeElement(name);
    children.push(overlay);
    const release = acquireModalLock(overlay, body);
    return {
      overlay,
      close: () => {
        release();
        children.splice(children.indexOf(overlay), 1);
      },
    };
  };
  return { app, toast, body, open };
}

describe('modal page lock', () => {
  it('locks the page and restores it when the only modal closes', () => {
    const { app, toast, body, open } = page();
    const modal = open('menu');
    expect(body.style.overflow).toBe('hidden');
    expect(app.inert).toBe(true);
    expect(app.getAttribute('aria-hidden')).toBe('true');
    expect(modal.overlay.inert).toBe(false);

    modal.close();
    expect(body.style.overflow).toBe('auto');
    expect(app.inert).toBe(false);
    expect(app.getAttribute('aria-hidden')).toBeNull();
    expect(toast.getAttribute('aria-hidden')).toBe('false');
  });

  it('restores the page when overlapping modals close out of order', () => {
    const { app, body, open } = page();
    const switcher = open('switcher');
    const search = open('search');
    expect(switcher.overlay.inert).toBe(true);
    expect(search.overlay.inert).toBe(false);

    switcher.close();
    expect(body.style.overflow).toBe('hidden');
    expect(app.inert).toBe(true);
    expect(search.overlay.inert).toBe(false);

    search.close();
    expect(body.style.overflow).toBe('auto');
    expect(app.inert).toBe(false);
    expect(app.getAttribute('aria-hidden')).toBeNull();
  });

  it('makes the lower modal interactive again when the top one closes first', () => {
    const { app, body, open } = page();
    const lower = open('lower');
    const upper = open('upper');
    upper.close();
    expect(lower.overlay.inert).toBe(false);
    expect(lower.overlay.getAttribute('aria-hidden')).toBeNull();
    expect(app.inert).toBe(true);
    lower.close();
    expect(body.style.overflow).toBe('auto');
    expect(app.inert).toBe(false);
  });

  it('ignores a repeated release', () => {
    const { body, open } = page();
    const first = open('first');
    const release = acquireModalLock(new FakeElement('ghost'), body);
    release();
    release();
    expect(body.style.overflow).toBe('hidden');
    first.close();
    expect(body.style.overflow).toBe('auto');
  });
});
