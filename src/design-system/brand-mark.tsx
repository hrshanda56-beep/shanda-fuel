import { useId } from 'react';

/** The ShandaHR sparkle, recoloured to the app's brand palette. */
export function BrandMark() {
  // A unique gradient id per instance: a hidden copy must not own the fill of a visible one.
  const gradientId = `brand-mark-gradient-${useId().replace(/:/g, '')}`;
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={gradientId}
          x1="3"
          y1="8"
          x2="45"
          y2="40"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="var(--palette-brand-400)" />
          <stop offset="100%" stopColor="var(--palette-brand-700)" />
        </linearGradient>
      </defs>
      <path
        d="M 24,8 C 23,14 13,23 3,24 C 13,25 23,34 24,40 C 25,34 35,25 45,24 C 35,23 25,14 24,8 Z"
        fill={`url(#${gradientId})`}
      />
      <circle cx="24" cy="24" r="4.2" fill="#fff" opacity="0.92" />
    </svg>
  );
}
