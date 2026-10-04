import type { Metadata, Viewport } from 'next';

// Design-system foundation first, then app-level styles. Order matters.
import '@/design-system/styles/tokens.css';
import '@/design-system/styles/base.css';
import '@/design-system/styles/components.css';
import '@/design-system/styles/shell.css';
import './globals.css';
import '@/design-system/styles/adr015.css';

import { shellInitScript } from '@/design-system/shell-preferences';
import { themeInitScript } from '@/design-system/theme';

export const metadata: Metadata = {
  title: 'Shanda Fuel',
  description: 'Fuel-station operations and financial control',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f5' },
    { media: '(prefers-color-scheme: dark)', color: '#131312' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The init scripts may set data-theme / data-sidebar before hydration.
    // data-scroll-behavior: in-page anchors scroll smoothly; route changes jump.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript + shellInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
