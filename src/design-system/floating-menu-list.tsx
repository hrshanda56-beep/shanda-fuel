'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * The open list of a small menu, drawn on the page itself and placed beside its button, so no card,
 * table or scroll area around the button can cut it off. It opens below the button, or above it when
 * there is not enough room below, and closes when the page scrolls or resizes.
 */
export function FloatingMenuList({
  anchorRef,
  onDismiss,
  as: Tag = 'div',
  onElement,
  className,
  children,
  ...rest
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  as?: 'div' | 'ul';
  /** Hands the list element to the menu, so its outside-click check knows the list is part of it. */
  onElement?: (node: HTMLElement | null) => void;
  className?: string;
  children: ReactNode;
  role?: string;
  id?: string;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
}) {
  const own = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const list = own.current;
    const anchor = anchorRef.current;
    if (!list || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const height = list.offsetHeight;
    const gap = 4;
    const below = window.innerHeight - rect.bottom - gap;
    const up = height > below && rect.top > below;
    list.style.position = 'fixed';
    list.style.insetInlineStart = 'auto';
    list.style.insetInlineEnd = `${Math.max(8, window.innerWidth - rect.right)}px`;
    list.style.top = up ? 'auto' : `${rect.bottom + gap}px`;
    list.style.bottom = up ? `${window.innerHeight - rect.top + gap}px` : 'auto';
    list.style.zIndex = '1000';
  });

  useEffect(() => {
    const close = () => onDismiss();
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [onDismiss]);

  const setRefs = (node: HTMLElement | null) => {
    own.current = node;
    onElement?.(node);
  };

  return createPortal(
    <Tag ref={setRefs as never} className={className} {...rest}>
      {children}
    </Tag>,
    document.body,
  );
}
