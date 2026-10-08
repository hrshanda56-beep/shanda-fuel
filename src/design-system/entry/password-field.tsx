'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  id: string;
  name: string;
};

/**
 * Password input with an icon-only show/hide control (named for assistive tech). The toggle is a real button that
 * follows the input in DOM order (one extra Tab stop, no focus trap); Enter in
 * the input still submits the form because the toggle is `type="button"`.
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ id, name, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="entry-password">
        <input
          {...props}
          ref={ref}
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="entry-password-toggle"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((current) => !current)}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible ? <path d="M4 4l16 16" /> : null}
          </svg>
        </button>
      </div>
    );
  },
);
