/**
 * Page lock shared by every open modal.
 *
 * Each modal used to save and restore `body.style.overflow` and its siblings'
 * `inert`/`aria-hidden` on its own. When two modals overlapped (for example the
 * search palette over the station switcher) and closed out of order, the later
 * cleanup restored a stale snapshot and left the page unscrollable or inert
 * with no modal open. This keeps one stack: the page is locked while any modal
 * is open, only the topmost modal stays interactive, and the original state is
 * restored exactly once, when the last modal closes.
 */

type LockElement = {
  inert?: boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

export type LockBody = {
  readonly children: ArrayLike<LockElement>;
  readonly style: { overflow: string };
};

type OriginalState = { inert: boolean; ariaHidden: string | null };

type LockState = {
  body: LockBody;
  overflow: string;
  originals: Map<LockElement, OriginalState>;
  stack: LockElement[];
};

let current: LockState | null = null;

function remember(state: LockState, element: LockElement) {
  if (!state.originals.has(element)) {
    state.originals.set(element, {
      inert: element.inert ?? false,
      ariaHidden: element.getAttribute('aria-hidden'),
    });
  }
}

function restore(element: LockElement, original: OriginalState) {
  element.inert = original.inert;
  if (original.ariaHidden === null) element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden', original.ariaHidden);
}

function apply(state: LockState) {
  if (state.stack.length === 0) {
    state.originals.forEach((original, element) => restore(element, original));
    state.body.style.overflow = state.overflow;
    current = null;
    return;
  }
  const top = state.stack[state.stack.length - 1];
  state.body.style.overflow = 'hidden';
  for (const element of Array.from(state.body.children)) {
    remember(state, element);
    if (element === top) {
      restore(element, state.originals.get(element)!);
    } else {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    }
  }
}

/**
 * Locks the page for `overlay` (a direct child of `body`) and returns the
 * release function. Releasing is idempotent and order-independent.
 */
export function acquireModalLock(overlay: LockElement, body: LockBody): () => void {
  if (!current || current.body !== body) {
    current = { body, overflow: body.style.overflow, originals: new Map(), stack: [] };
  }
  const state = current;
  state.stack.push(overlay);
  apply(state);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = state.stack.lastIndexOf(overlay);
    if (index >= 0) state.stack.splice(index, 1);
    if (current === state) apply(state);
  };
}
