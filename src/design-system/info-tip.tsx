'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const GAP = 8;
const MARGIN = 12;

/**
 * A small "?" that holds an explanation, so the page itself stays quiet. Hovering or focusing it
 * shows the text at once; tapping it (phones have no hover) pins it open until the next tap
 * elsewhere. The text is drawn in a portal so cards that clip their content cannot cut it off.
 */
export function InfoTip({
  text,
  children,
  label = 'More information',
}: {
  /** The explanation, as plain text. Use children for text with emphasis. */
  text?: string;
  children?: ReactNode;
  label?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const visible = hover || focus || pinned;

  const place = useCallback(() => {
    const anchor = button.current?.getBoundingClientRect();
    const box = bubble.current?.getBoundingClientRect();
    if (!anchor || !box) return;
    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - box.width / 2),
      window.innerWidth - box.width - MARGIN,
    );
    const below = anchor.bottom + GAP;
    const top =
      below + box.height > window.innerHeight - MARGIN ? anchor.top - GAP - box.height : below;
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (visible) place();
  }, [visible, place, text, children]);

  useEffect(() => {
    if (!visible) return;
    const close = () => {
      setHover(false);
      setPinned(false);
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !bubble.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [visible, place]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="info-tip"
        aria-label={label}
        aria-expanded={visible}
        aria-describedby={id}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onClick={() => setPinned((value) => !value)}
      >
        ?
      </button>
      <span id={id} className="visually-hidden">
        {text ?? children}
      </span>
      {visible
        ? createPortal(
            <span
              ref={bubble}
              aria-hidden="true"
              className="info-tip-bubble"
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                visibility: pos ? 'visible' : 'hidden',
              }}
            >
              {text ?? children}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
