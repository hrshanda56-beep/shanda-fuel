'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Render outside the sidebar's scroll container so labels cannot be clipped. */
export function SidebarTooltip({ enabled }: { enabled: boolean }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const sidebar = document;
    const show = (event: Event) => {
      const row =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('.shell-sidebar .nav-row')
          : null;
      setTarget(row?.querySelector('.nav-label') ? row : null);
    };
    const hide = () => setTarget(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    sidebar.addEventListener('mouseover', show);
    sidebar.addEventListener('mousemove', show);
    sidebar.addEventListener('focusin', show);
    sidebar.addEventListener('mouseleave', hide);
    sidebar.addEventListener('focusout', hide);
    sidebar.addEventListener('click', hide);
    document.addEventListener('keydown', escape);
    window.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('touchmove', hide, { passive: true });
    window.addEventListener('resize', hide);
    return () => {
      sidebar.removeEventListener('mouseover', show);
      sidebar.removeEventListener('mousemove', show);
      sidebar.removeEventListener('focusin', show);
      sidebar.removeEventListener('mouseleave', hide);
      sidebar.removeEventListener('focusout', hide);
      sidebar.removeEventListener('click', hide);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('wheel', hide);
      window.removeEventListener('touchmove', hide);
      window.removeEventListener('resize', hide);
    };
  }, [enabled]);
  if (!enabled || !target) return null;
  const bounds = target.getBoundingClientRect();
  return createPortal(
    <div
      className="shell-rail-tooltip"
      role="tooltip"
      style={{
        left:
          Math.max(
            bounds.right,
            target.closest('.shell-sidebar')?.getBoundingClientRect().right ?? 0,
          ) + 12,
        top: Math.max(24, Math.min(window.innerHeight - 24, bounds.top + bounds.height / 2)),
      }}
    >
      {target.querySelector('.nav-label')?.textContent}
    </div>,
    document.body,
  );
}
