import Image from 'next/image';

/**
 * Payment channel marks. EcoCash uses the logo from ecocash.co.zw; the Visa and
 * Mastercard marks are drawn approximations: swap in licensed files when supplied.
 */
export function EcoCashMark() {
  return (
    <span className="provider-logo provider-logo-badge">
      <Image src="/brands/ecocash.png" alt="EcoCash" width={225} height={76} />
    </span>
  );
}

export function VisaMark() {
  return (
    <svg
      className="provider-logo"
      viewBox="0 0 64 32"
      role="img"
      aria-label="Visa"
      focusable="false"
    >
      <rect width="64" height="32" rx="8" fill="#fff" />
      <text
        x="32"
        y="22.5"
        textAnchor="middle"
        fill="#1a1f71"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="19"
        fontStyle="italic"
        fontWeight="900"
        letterSpacing="0.5"
      >
        VISA
      </text>
    </svg>
  );
}

export function MastercardMark() {
  return (
    <svg
      className="provider-logo"
      viewBox="0 0 64 32"
      role="img"
      aria-label="Mastercard"
      focusable="false"
    >
      <rect width="64" height="32" rx="8" fill="#fff" />
      <circle cx="25" cy="16" r="9.5" fill="#eb001b" />
      <circle cx="39" cy="16" r="9.5" fill="#f79e1b" />
      <path d="M32 8.4a9.5 9.5 0 0 1 0 15.2 9.5 9.5 0 0 1 0-15.2Z" fill="#ff5f00" />
    </svg>
  );
}
